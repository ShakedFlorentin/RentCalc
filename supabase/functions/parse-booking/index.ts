// Reads a booking confirmation (pasted text, PDF or screenshot) and returns structured bookings.
// The Claude key comes from the ANTHROPIC_API_KEY secret or Supabase Vault (anthropic_api_key).
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.1.0/helpers/zod'
import { z } from 'npm:zod@4'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { logCall } from './ai-log.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BookingList = z.object({
  bookings: z.array(
    z.object({
      kind: z.enum(['flight', 'hotel', 'restaurant', 'train', 'activity', 'insurance', 'other']),
      title: z.string(),
      starts_at: z.string().nullable(),
      ends_at: z.string().nullable(),
      confirmation: z.string().nullable(),
      location: z.string().nullable(),
      url: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
})

const SYSTEM = `You extract travel bookings from confirmation emails, PDFs and screenshots for a group trip to Japan.
Return one entry per separate booking (e.g. an outbound and a return flight are two entries; one hotel stay is one entry).
- kind: flight, hotel, restaurant (a table reservation), train, activity, insurance or other.
- title: short and recognisable, e.g. the hotel name, or "El Al LY91 TLV → NRT".
- starts_at / ends_at: local wall-clock time at the place, formatted YYYY-MM-DDTHH:mm (no timezone). Hotel: check-in and check-out; if only dates are given use 15:00 and 11:00. Restaurant: the reservation time as starts_at, ends_at null. Flight: departure and arrival in their own local times. null when unknown.
- confirmation: the booking/confirmation/PNR number exactly as written.
- location: full street address (hotel, restaurant) or departure airport/station.
- url: a link to manage the booking if present.
- notes: a short Hebrew summary of what matters on the trip: room type or table/course, number of guests, breakfast, cancellation deadline, total price and currency, baggage. Max 3 lines, plain text, no emoji.
Only use information that is in the document. If it is not a booking, return an empty list.`

const MODEL = 'claude-haiku-5-5'
const MAX_BYTES = 15 * 1024 * 1024
// Claude calls per user per function in 24 hours
const DAILY_LIMIT = 30

/** The Claude key: a function secret if one is set, otherwise the copy kept in Supabase Vault. */
async function anthropicKey(admin: SupabaseClient) {
  const env = Deno.env.get('ANTHROPIC_API_KEY')
  if (env) return env
  const { data } = await admin.rpc('get_anthropic_key')
  return (data as string | null) ?? undefined
}

/**
 * Lets a request spend the Claude key only for a signed-in member of a trip who is under today's cap, and records
 * the call. Returns the service client and the user, or the response to send instead.
 */
async function admit(req: Request, fn: string, json: (body: unknown, status?: number) => Response) {
  // the anon key is also a valid JWT, so check there is a signed-in user behind the request
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return json({ error: 'not signed in' }, 401)
  const { count: trips } = await supabase
    .from('members')
    .select('trip_id', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
  if (!trips) return json({ error: 'not a trip member' }, 403)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: used } = await admin
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
    .eq('fn', fn)
    .gte('at', since)
  if ((used ?? 0) >= DAILY_LIMIT) return json({ error: 'daily limit reached' }, 429)
  await admin.from('ai_usage').insert({ user_id: auth.user.id, fn })
  return { admin, userId: auth.user.id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // check the request before admit(), so a malformed one doesn't use up the daily quota
  const body = (await req.json().catch(() => null)) as { text?: unknown; file?: { data?: unknown; media_type?: unknown } } | null
  const text = typeof body?.text === 'string' ? body.text : undefined
  const file =
    body?.file && typeof body.file.data === 'string' && typeof body.file.media_type === 'string'
      ? { data: body.file.data, media_type: body.file.media_type }
      : undefined
  if (!text?.trim() && !file) return json({ error: 'nothing to read' }, 400)
  if ((text?.length ?? 0) > 50_000) return json({ error: 'text too long' }, 413)
  if (file && file.data.length * 0.75 > MAX_BYTES) return json({ error: 'file too large' }, 413)

  const admitted = await admit(req, 'parse-booking', json)
  if (admitted instanceof Response) return admitted
  const { admin, userId } = admitted
  // what was read, so the log shows whether PDFs, screenshots or pasted text cost the most
  const step = file ? (file.media_type === 'application/pdf' ? 'pdf' : 'image') : 'text'

  const content: Anthropic.ContentBlockParam[] = []
  if (file?.media_type === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } })
  } else if (file && /^image\/(jpeg|png|gif|webp)$/.test(file.media_type)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: file.media_type as 'image/jpeg', data: file.data },
    })
  } else if (file) {
    return json({ error: 'unsupported file type' }, 415)
  }
  content.push({ type: 'text', text: text?.trim() ? text : 'Extract the bookings from the attached document.' })

  const client = new Anthropic({ apiKey: await anthropicKey(admin) })
  const t = performance.now()
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: zodOutputFormat(BookingList) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    })
    logCall(admin, { fn: 'parse-booking', step, userId, model: MODEL, usage: response.usage, ms: performance.now() - t, stopReason: response.stop_reason })
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return json({ error: 'could not read this confirmation' }, 422)
    }
    // the reply is shown as a link, so only a real web address may come through
    const bookings = response.parsed_output.bookings.map((b) => ({ ...b, url: b.url && /^https?:\/\//i.test(b.url) ? b.url : null }))
    return json({ bookings })
  } catch (error) {
    logCall(admin, { fn: 'parse-booking', step, userId, model: MODEL, ms: performance.now() - t, error: String(error instanceof Error ? error.message : error) })
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY is missing or invalid' }, 500)
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'busy, try again in a minute' }, 429)
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error ${error.status}` }, 502)
    throw error
  }
})
