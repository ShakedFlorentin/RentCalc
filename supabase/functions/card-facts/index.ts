// Fills a new swipe card's planning facts (hours, closed days, visit length, best time, one Hebrew line) when it
// arrives without them, e.g. a place added from the Ptitim map. Called by the database (trigger card_needs_facts via
// pg_net, with the planner token) right after the card is inserted, so the trip planner never has to look anything
// up: it only reads the card. One Claude lookup per card; the library card is filled too, for every other trip.
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { lookUp, type PlaceInfo } from './facts.ts'

type Card = PlaceInfo & {
  id: string
  trip_id: string
  library_id: string | null
  lat: number | null
  address: string | null
  facts_at: string | null
  en: Record<string, unknown> | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const body = (await req.json().catch(() => null)) as { candidate_id?: unknown } | null
  const cid = typeof body?.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
  if (!cid) return json({ error: 'candidate_id missing' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // only the database calls this: it sends the planner token
  const token = req.headers.get('x-plan-token')
  const { data: expected } = await admin.rpc('get_planner_token')
  if (!token || token !== expected) return json({ error: 'bad token' }, 401)

  const work = fill(admin, cid, token)
  edge?.waitUntil(work)
  return json(await work)
})

async function fill(admin: SupabaseClient, cid: string, token: string) {
  const { data: c } = await admin
    .from('candidates')
    .select('id,trip_id,library_id,name,name_ja,city,area,category,lat,address,tip,baby_notes,hype,reality,time_needed,facts_at,en')
    .eq('id', cid)
    .maybeSingle<Card>()
  if (!c) return { skipped: 'no card' }
  if (c.facts_at) return { skipped: 'has facts' }

  const key = Deno.env.get('ANTHROPIC_API_KEY') || ((await admin.rpc('get_anthropic_key')).data as string | null) || undefined
  const f = await lookUp(admin, new Anthropic({ apiKey: key }), c)
  if (!f) return { failed: true }
  const columns = {
    opens: f.opens,
    closes: f.closes,
    closed_weekdays: f.closed_weekdays,
    closed_dates: f.closed_dates,
    best_time: f.best_time,
    visit_mins: f.hours ? Math.round(f.hours * 60) : null,
    booking: f.booking,
    plan_line: f.line_he,
    baby_block: f.baby_he,
    facts_at: new Date().toISOString().slice(0, 10),
    facts_sure: true,
  }
  // the English plan line goes into the card's English text, next to whatever English it already has
  const english = { plan_line: f.line_en, baby_block: f.baby_en }
  await admin
    .from('candidates')
    .update({
      ...columns,
      en: { ...(c.en ?? {}), ...english },
      ...(c.address == null && f.address ? { address: f.address } : {}),
      // coordinates are kept in the backend only, for the planner's distances and the map pins
      ...(c.lat == null && f.lat != null ? { lat: f.lat, lng: f.lng } : {}),
    })
    .eq('id', cid)
  // the library card it came from: every other trip's copy gets it on its next sync
  if (c.library_id) {
    const { data: lib } = await admin.from('place_library').select('en').eq('id', c.library_id).maybeSingle<{ en: Record<string, unknown> | null }>()
    await admin
      .from('place_library')
      .update({ ...columns, address: f.address, en: { ...(lib?.en ?? {}), ...english } })
      .eq('id', c.library_id)
      .is('facts_at', null)
  }
  // a card already matched waits in the plan on defaults: plan again with the real hours
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/plan-trip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-plan-token': token },
    body: JSON.stringify({ trip_id: c.trip_id }),
  }).catch(() => null)
  return { filled: c.name }
}
