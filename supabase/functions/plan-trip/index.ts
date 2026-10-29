// Plans the trip: puts every matched place on a day its people are near it, close to the day's other plans, on a
// day it is open, around bookings, with a rough time and one short line of what to know. Runs after each swipe,
// match or booking (database triggers via pg_net) and when the plan is opened in the app.
// A plan item a person added, moved or edited is never touched; only the planner's own items (auto) are.
// No AI here: opening hours and the rest come with the card (place_library → candidates, the plan columns), and a
// card without them is planned from its kind and time_needed.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { hhmm, km, plan, type BestTime, type Day, type Fixed, type Point, type Presence, type Unit } from './plan.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-plan-token',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEDIA_URL = 'https://shakedflorentin.github.io/RentCalc/media.json'
const LEASE_MS = 60_000

const BASE_POINT: Record<string, Point> = {
  tokyo: { lat: 35.681, lng: 139.767 },
  yokohama: { lat: 35.444, lng: 139.638 },
  kyoto: { lat: 35.003, lng: 135.759 },
  osaka: { lat: 34.686, lng: 135.502 },
  nara: { lat: 34.685, lng: 135.805 },
}
const CITY_EN: Record<string, string> = { tokyo: 'Tokyo', kyoto: 'Kyoto', osaka: 'Osaka', nara: 'Nara', yokohama: 'Yokohama' }
const CITY_HE: Record<string, string> = { tokyo: 'טוקיו', yokohama: 'יוקוהמה', kyoto: 'קיוטו', osaka: 'אוסקה', nara: 'נארה' }

/** The city a hotel is in, from its name and address (same rules as hotel_base in the database). */
function hotelBase(t: string) {
  if (/osaka/i.test(t)) return 'osaka'
  if (/kyoto/i.test(t)) return 'kyoto'
  if (/yokohama|kanagawa/i.test(t)) return 'yokohama'
  if (/\bnara\b/i.test(t)) return 'nara'
  if (/tokyo|shinjuku|minato|shibuya|chiyoda|taito|shimbashi|ginza|ikebukuro|asakusa|ueno/i.test(t)) return 'tokyo'
  return null
}

const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  const body = (await req.json().catch(() => null)) as { trip_id?: unknown; dry?: unknown; wait?: unknown } | null
  const tid = typeof body?.trip_id === 'string' && UUID.test(body.trip_id) ? body.trip_id : null
  if (!tid) return json({ error: 'trip_id missing' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // the database's own requests carry the planner token; a person must be a member of the trip
  const token = req.headers.get('x-plan-token')
  let trusted = false
  if (token) {
    const { data } = await admin.rpc('get_planner_token')
    trusted = !!data && data === token
    if (!trusted) return json({ error: 'bad token' }, 401)
  } else {
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: auth } = await user.auth.getUser()
    if (!auth.user) return json({ error: 'not signed in' }, 401)
    const { data: member } = await user.rpc('is_trip_member', { tid })
    if (!member) return json({ error: 'not a trip member' }, 403)
  }

  // a dry run (planner token only) returns the plan it would write, for checking
  if (trusted && body?.dry === true) {
    try {
      return json(await run(admin, tid, true))
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.stack : e) }, 500)
    }
  }

  const work = loop(admin, tid)
  edge?.waitUntil(work)
  if (trusted && body?.wait === true) return json(await work)
  return json({ started: true }, 202)
})

/** One planner at a time per trip: requests that arrive while it runs mark the trip dirty and it runs once more. */
async function loop(admin: SupabaseClient, tid: string) {
  await admin.from('plan_state').upsert({ trip_id: tid }, { onConflict: 'trip_id', ignoreDuplicates: true })
  const acquire = async () => {
    const now = new Date()
    const { data } = await admin
      .from('plan_state')
      .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), dirty: false })
      .eq('trip_id', tid)
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select('trip_id')
    return !!data?.length
  }
  if (!(await acquire())) {
    await admin.from('plan_state').update({ dirty: true }).eq('trip_id', tid)
    // the running one may have finished in between and missed the flag
    if (!(await acquire())) return { queued: true }
  }
  const results: unknown[] = []
  try {
    for (let round = 0; round < 2; round++) {
      // swipes come in bursts: let the burst settle so one run covers it
      if (round === 0) await new Promise((r) => setTimeout(r, 2000))
      try {
        const r = await run(admin, tid, false)
        results.push(r.stats)
        await admin.from('plan_state').update({ ran_at: new Date().toISOString(), error: null, summary: r.summary }).eq('trip_id', tid)
      } catch (e) {
        console.error('plan failed', e)
        await admin.from('plan_state').update({ error: String(e instanceof Error ? e.message : e).slice(0, 500) }).eq('trip_id', tid)
      }
      const { data } = await admin.from('plan_state').select('dirty').eq('trip_id', tid).single()
      if (!data?.dirty) break
      await admin
        .from('plan_state')
        .update({ dirty: false, lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
        .eq('trip_id', tid)
    }
  } finally {
    await admin.from('plan_state').update({ lease_until: null }).eq('trip_id', tid)
  }
  return { results }
}

type Row = Record<string, unknown>
type Booking = { id: string; kind: string; title: string; starts_at: string | null; ends_at: string | null; who: string | null; location: string | null }
type Item = {
  id: string
  day: number
  time: string | null
  title: string
  location: string | null
  notes: string | null
  notes_en: string | null
  category: string
  sort: number
  place_id: string | null
  who: string | null
  auto: boolean
  done: boolean
}
type Place = {
  id: string
  candidate_id: string
  name: string
  city: string | null
  area: string | null
  lat: number | null
  lng: number | null
  who: string | null
  visited: boolean
  auto_planned: boolean
}
// a card's planning facts (see the plan columns on place_library / candidates); facts_at null = never checked
type Facts = {
  opens: string | null
  closes: string | null
  closed_weekdays: number[] | null
  closed_dates: string[] | null
  open_dates: string[] | null
  best_time: string | null
  visit_mins: number | null
  booking: string | null
  plan_line: string | null
  baby_block: string | null
  facts_at: string | null
}
type Cand = Facts & {
  id: string
  name: string
  address: string | null
  area: string | null
  city: string | null
  category: string | null
  lat: number | null
  lng: number | null
  tip: string | null
  time_needed: string | null
  verdict: string | null
  local_pick: boolean | null
  tabelog_score: number | null
  // the card's text in English (same keys as the Hebrew columns)
  en: { tip?: string | null; plan_line?: string | null; baby_block?: string | null } | null
}
type Media = { lat?: number; lng?: number; hype?: string; reality?: string; tip?: string; baby_notes?: string; time_needed?: string }

const mins = (t: string | null | undefined) => {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const at = (ts: string | null) => (ts ? { date: ts.slice(0, 10), min: mins(ts.slice(11, 16))! } : null)
const hebrew = (s: string | null | undefined) => !!s && /[\u0590-\u05FF]/.test(s)
const JAPAN = /\b(HND|NRT|KIX|ITM|NGO|CTS|FUK|OKA|UKB)\b|Haneda|Narita|Kansai/i
const ROUTE = /→|->|⟶|—|–|\s-\s/

let mediaCache: Record<string, Media> | null = null
async function media() {
  if (mediaCache) return mediaCache
  try {
    const r = await fetch(MEDIA_URL, { signal: AbortSignal.timeout(8000) })
    mediaCache = r.ok ? await r.json() : {}
  } catch {
    mediaCache = {}
  }
  return mediaCache!
}

/** Coordinates for an address or a name, from OpenStreetMap, kept in geo_cache (misses too). */
async function geocode(admin: SupabaseClient, q: string): Promise<Point | null> {
  const key = q.trim().toLowerCase()
  if (!key) return null
  const { data: hit } = await admin.from('geo_cache').select('lat,lng').eq('q', key).maybeSingle()
  if (hit) return hit.lat == null ? null : { lat: hit.lat, lng: hit.lng }
  let p: Point | null = null
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'japan-trip-planner/1.0' }, signal: AbortSignal.timeout(8000) },
    )
    const [first] = r.ok ? await r.json() : []
    if (first) p = { lat: Number(first.lat), lng: Number(first.lon) }
  } catch {
    // no point: the city's middle stands in
  }
  await admin.from('geo_cache').upsert({ q: key, lat: p?.lat ?? null, lng: p?.lng ?? null })
  // OpenStreetMap asks for at most one request a second
  await new Promise((r) => setTimeout(r, 1100))
  return p
}

/** How long a visit takes, in minutes: the card's checked length, else its Hebrew estimate, else by kind. */
function visitMins(f: Facts | undefined, timeNeeded: string | null | undefined, category: string) {
  if (f?.visit_mins) return f.visit_mins
  const t = timeNeeded ?? ''
  if (/יום שלם/.test(t)) return 420
  if (/חצי יום/.test(t)) return 240
  if (/שלוש שעות|שעתיים עד ארבע|שעתיים-שלוש/.test(t)) return 180
  if (/שעתיים/.test(t)) return 120
  if (/שעה וחצי|שעה עד שעה וחצי/.test(t)) return 90
  if (/שעה עד שעתיים|שעה-שעתיים/.test(t)) return 90
  if (/שעה/.test(t)) return 60
  if (/דקות|חצי שעה/.test(t)) return 45
  return { food: 75, cafe: 45, shopping: 90, sight: 120, experience: 120, nightlife: 90 }[category] ?? 90
}

const CAND_COLUMNS =
  'id,name,address,area,city,category,lat,lng,tip,time_needed,verdict,local_pick,tabelog_score,' +
  'opens,closes,closed_weekdays,closed_dates,open_dates,best_time,visit_mins,booking,plan_line,baby_block,facts_at,en'
/** The same place under small differences in spelling, case or punctuation gets one key. */
const factKey = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const VERDICT: Record<string, number> = { gem: 4, worth_it: 3, overhyped: 1.5, trap: 0.5 }

// the baby line only when it changes the plan (no strollers, stairs only, smoke, adults only); "no information on
// strollers" on every place made people stop reading the notes
const BABY_BLOCKER = /אסור|לא מתאים|לא מומלץ|לא נכנס|אין גישה|אין מקום לעגלה|קשה לעגלה|קשה להכניס עגלה|רק מדרגות|מדרגות בלבד|עשן|מעושן|מעשנים|למבוגרים|לא לילדים|מתחת לגיל/
const babyLine = (b: string | null) => (b && BABY_BLOCKER.test(b) ? b : null)
const BABY_BLOCKER_EN = /no stroller|not suitable|not recommended|stairs only|smok|adults only|no children|no kids|under age|not allowed|no access|hard with a stroller/i
const babyLineEn = (b: string | null | undefined) => (b && BABY_BLOCKER_EN.test(b) ? b : null)
// when a card was never checked: when its kind is usually best
const DEFAULT_TIME: Record<string, BestTime> = { nightlife: 'night' }
/** The facts of a card that has them; undefined for one never checked. */
const factsOf = (c: Cand | undefined): Facts | undefined => (c?.facts_at ? c : undefined)

async function run(admin: SupabaseClient, tid: string, dry: boolean) {
  const q = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return data as T
  }
  const [trip, members, bookings, dayInfo, items, places, votes, mediaIdx] = await Promise.all([
    q<{ start_date: string; num_days: number }>(admin.from('trips').select('start_date,num_days').eq('id', tid).single()),
    q<{ couple: string | null }[]>(admin.from('members').select('couple').eq('trip_id', tid)),
    q<Booking[]>(admin.from('bookings').select('id,kind,title,starts_at,ends_at,who,location').eq('trip_id', tid)),
    q<{ day: number; city: string | null; who: string | null }[]>(admin.from('day_info').select('day,city,who').eq('trip_id', tid)),
    q<Item[]>(admin.from('itinerary_items').select('id,day,time,title,location,notes,notes_en,category,sort,place_id,who,auto,done').eq('trip_id', tid).gt('day', 0)),
    q<Place[]>(
      admin.from('places').select('id,candidate_id,name,city,area,lat,lng,who,visited,auto_planned').eq('trip_id', tid).not('candidate_id', 'is', null),
    ),
    q<{ candidate_id: string; couples: string[]; voted: string[]; yes: string[] }[]>(admin.rpc('plan_place_couples', { tid })),
    media(),
  ])
  const candIds = places.map((p) => p.candidate_id)
  const cands = candIds.length
    ? await q<Cand[]>(
        admin
          .from('candidates')
          .select(CAND_COLUMNS)
          .in('id', candIds)
          .returns<Cand[]>(),
      )
    : []
  const candById = new Map(cands.map((c) => [c.id, c]))
  const voteById = new Map(votes.map((v) => [v.candidate_id, v]))
  const couples = [...new Set(members.map((m) => m.couple).filter((c): c is string => !!c))].sort()
  const start = new Date(trip.start_date + 'T00:00:00Z')
  const dateOf = (day: number) => new Date(start.getTime() + (day - 1) * 86400000).toISOString().slice(0, 10)

  // ---- where everyone sleeps, and the hours each couple has each day
  const hotels = bookings.filter((b) => b.kind === 'hotel' && b.starts_at && b.ends_at)
  const hotelPt = new Map<string, Point>()
  for (const h of hotels) {
    if (hotelPt.has(h.id)) continue
    const base = hotelBase(h.title + ' ' + (h.location ?? ''))
    const same = hotels.find((o) => o.id !== h.id && hotelPt.has(o.id) && o.title.trim().toLowerCase() === h.title.trim().toLowerCase())
    const p =
      (same && hotelPt.get(same.id)) ||
      (await geocode(admin, h.title)) ||
      (h.location ? await geocode(admin, h.location) : null)
    // a geocode that lands outside the hotel's city is wrong; the city's middle is closer to the truth
    hotelPt.set(h.id, p && base && km(p, BASE_POINT[base]) < 40 ? p : base ? BASE_POINT[base] : p ?? BASE_POINT.tokyo)
  }
  const dayWho = new Map(dayInfo.map((d) => [d.day, d.who]))
  const sleepOf = (c: string, date: string, day: number) =>
    hotels.find(
      (h) =>
        h.starts_at!.slice(0, 10) <= date &&
        date < h.ends_at!.slice(0, 10) &&
        (h.who === c || (!h.who && (!dayWho.get(day) || dayWho.get(day) === c))),
    )
  const flights = bookings.filter((b) => b.kind === 'flight')
  const flightOf = (c: string, date: string, way: 'in' | 'out') =>
    flights.find((f) => {
      if (f.who && f.who !== c) return false
      const [from, ...to] = f.title.split(ROUTE)
      if (way === 'in') return JAPAN.test(to.join(' ')) && f.ends_at?.slice(0, 10) === date
      return JAPAN.test(from) && f.starts_at?.slice(0, 10) === date
    })

  const days: Day[] = []
  for (let d = 1; d <= trip.num_days; d++) {
    const date = dateOf(d)
    const atMap = new Map<string, Presence>()
    for (const c of couples) {
      const tonight = sleepOf(c, date, d)
      const last = sleepOf(c, dateOf(d - 1), d - 1)
      if (!tonight && !last) continue
      let s = 9 * 60 + 30
      let e = 21 * 60 + 30
      if (tonight && !last) {
        const f = flightOf(c, date, 'in')
        s = Math.max(s, f ? at(f.ends_at)!.min + 180 : 15 * 60)
      }
      if (!tonight && last) {
        const f = flightOf(c, date, 'out')
        e = Math.min(e, f ? at(f.starts_at)!.min - 210 : 12 * 60)
      }
      const h = (tonight ?? last)!
      if (tonight && last && tonight.title !== last.title) {
        const moved = hotelBase(tonight.title + ' ' + (tonight.location ?? '')) !== hotelBase(last.title + ' ' + (last.location ?? ''))
        s = Math.max(s, moved ? 14 * 60 : 12 * 60)
      }
      const base = hotelBase(h.title + ' ' + (h.location ?? ''))
      if (!base) continue
      atMap.set(c, { base, hotel: hotelPt.get(h.id)!, start: s, end: Math.max(s, e) })
    }
    days.push({ day: d, date, weekday: new Date(date + 'T12:00:00Z').getUTCDay(), at: atMap })
  }
  // each city's middle, from the hotels in it
  const basePt = new Map<string, Point>()
  for (const [b, pts] of groupBy(
    days.flatMap((d) => [...d.at.values()]),
    (p) => p.base,
  )) {
    basePt.set(b, { lat: pts.reduce((s, p) => s + p.hotel.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.hotel.lng, 0) / pts.length })
  }

  const tipOf = (c: Cand) => c.tip
  const fixedItems = items.filter((i) => !i.auto || i.done)
  const autoItems = items.filter((i) => i.auto && !i.done)
  const fixedPlaceIds = new Set(fixedItems.map((i) => i.place_id).filter(Boolean))
  const fixedNames = new Set(fixedItems.map((i) => factKey(i.title)))
  const autoByPlace = groupBy(autoItems.filter((i) => i.place_id), (i) => i.place_id!)

  const want: { p: Place; c: Cand }[] = []
  // city: where it would go, so the plan can offer it on that city's days
  const unplanned: { place_id: string; name: string; reason: string; who: string | null; city?: string }[] = []
  for (const p of places) {
    const c = candById.get(p.candidate_id)
    if (!c || p.visited) continue
    if (fixedPlaceIds.has(p.id) || fixedNames.has(factKey(p.name))) continue
    // the planner put it in once and someone took it out: leave it out
    if (p.auto_planned && !autoByPlace.has(p.id)) continue
    const v = voteById.get(p.candidate_id)
    if (!v?.yes.length) continue
    if (v.couples.some((x) => !v.voted.includes(x))) {
      unplanned.push({ place_id: p.id, name: p.name, reason: 'waiting', who: p.who })
      continue
    }
    want.push({ p, c })
  }

  // ---- the places to plan
  const units: Unit[] = []
  const unitPlace = new Map<string, { p: Place; c: Cand; f?: Facts; point: Point | null; base: string }>()
  for (const { p, c } of want) {
    const f = factsOf(c)
    const m = mediaIdx[c.name]
    const own = m?.lat != null ? { lat: m.lat, lng: m.lng! } : c.lat != null ? { lat: c.lat, lng: c.lng! } : null
    const unitCouples = p.who ? p.who.split(' + ') : couples
    // the nearest city its couples sleep in
    const bases = [...new Set(days.flatMap((d) => unitCouples.map((x) => d.at.get(x)?.base).filter((b): b is string => !!b)))]
    const point = own ?? (c.city && BASE_POINT[c.city] ? BASE_POINT[c.city] : null)
    let base: string | null = null
    let dist = Infinity
    for (const b of bases) {
      const bp = basePt.get(b) ?? BASE_POINT[b]
      const dd = point ? km(point, bp) : c.city === b ? 0 : Infinity
      if (dd < dist) {
        dist = dd
        base = b
      }
    }
    if (!base) {
      unplanned.push({ place_id: p.id, name: p.name, reason: 'no_day', who: p.who })
      continue
    }
    const far = dist > 25
    const category = c.category ?? 'sight'
    let opens = mins(f?.opens)
    let closes = mins(f?.closes)
    if (opens != null && closes != null && closes <= opens) closes = 24 * 60
    const v = voteById.get(p.candidate_id)!
    units.push({
      id: p.id,
      couples: unitCouples,
      base,
      far,
      point,
      mins: Math.min(visitMins(f, c.time_needed, category), 420),
      category,
      best: (f?.best_time as BestTime) ?? DEFAULT_TIME[category] ?? 'any',
      opens,
      closes,
      closedWeekdays: f?.closed_weekdays ?? [],
      closedDates: (f?.closed_dates ?? []).map((d) => d.slice(0, 10)),
      openDates: (f?.open_dates ?? []).map((d) => d.slice(0, 10)),
      priority:
        (VERDICT[c.verdict ?? ''] ?? 2.5) +
        (c.local_pick ? 0.5 : 0) +
        (v.yes.length > 1 ? 1 : 0) +
        ((c.tabelog_score ?? 0) >= 3.6 ? 0.3 : 0),
      current: autoByPlace.get(p.id)?.[0]?.day ?? null,
    })
    unitPlace.set(p.id, { p, c, f, point: own, base })
  }

  // ---- what is already fixed: bookings with a time, and plan items people put in
  const placeById = new Map(places.map((p) => [p.id, p]))
  // a plan item's card, through its place
  const factsOfItem = (i: Item) => {
    const p = i.place_id ? placeById.get(i.place_id) : null
    return factsOf(p ? candById.get(p.candidate_id) : undefined)
  }
  const pointOfItem = (i: Item): Point | null => {
    const m = i.location?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) }
    const p = i.place_id ? placeById.get(i.place_id) : null
    if (p?.lat != null) return { lat: p.lat, lng: p.lng! }
    const md = mediaIdx[i.title]
    return md?.lat != null ? { lat: md.lat, lng: md.lng! } : null
  }
  const whoOf = (who: string | null, day: number) => {
    const present = [...(days[day - 1]?.at.keys() ?? [])]
    return who ? who.split(' + ').filter((x) => present.includes(x)) : present
  }
  const fixed: Fixed[] = []
  for (const i of fixedItems) {
    fixed.push({
      day: i.day,
      couples: whoOf(i.who, i.day),
      point: pointOfItem(i),
      start: mins(i.time),
      mins: visitMins(factsOfItem(i), null, i.category === 'food' ? 'food' : i.category === 'shopping' ? 'shopping' : 'sight'),
    })
  }
  for (const b of bookings) {
    if (['hotel', 'flight', 'insurance'].includes(b.kind)) continue
    const s = at(b.starts_at)
    if (!s) continue
    const day = Math.round((Date.parse(s.date) - start.getTime()) / 86400000) + 1
    if (day < 1 || day > trip.num_days) continue
    const e = at(b.ends_at)
    const len = e && e.date === s.date && e.min > s.min ? e.min - s.min : b.kind === 'restaurant' ? 90 : b.kind === 'train' ? 60 : 120
    // a booked table or ticket at a place we know: plan near it
    const known = places.find((p) => factKey(p.name) === factKey(b.title) || factKey(b.title).includes(factKey(p.name)))
    let point: Point | null = known?.lat != null ? { lat: known.lat, lng: known.lng! } : null
    if (!point && b.kind !== 'train' && b.location) point = await geocode(admin, b.location)
    fixed.push({ day, couples: whoOf(b.who, day), point, start: s.min, mins: len })
  }

  const out = plan(days, units, fixed)

  // ---- the rows the plan wants, against the rows there are
  const noteOf = (u: { c: Cand; f?: Facts }) => {
    if (u.f?.plan_line) return [u.f.plan_line, babyLine(u.f.baby_block)].filter(Boolean).join('\n')
    // never checked: the first sentence of the Hebrew tip, if there is one
    const tip = tipOf(u.c)
    if (!hebrew(tip)) return null
    const first = tip!.split(/(?<=[.!?])\s/)[0]
    return first.length > 90 ? first.slice(0, 88) + '…' : first
  }
  // the same note in English, for the app in English
  const noteOfEn = (u: { c: Cand; f?: Facts }) => {
    const en = u.c.en
    if (!en) return null
    if (u.f && en.plan_line) return [en.plan_line, babyLineEn(en.baby_block)].filter(Boolean).join('\n')
    const first = en.tip?.split(/(?<=[.!?])\s/)[0]
    return first ? (first.length > 90 ? first.slice(0, 88) + '…' : first) : null
  }
  const itemCategory = (cat: string) =>
    cat === 'food' || cat === 'cafe' ? 'food' : cat === 'shopping' ? 'shopping' : cat === 'sight' || cat === 'experience' ? 'sight' : 'other'
  const desired: Row[] = []
  for (const [id, pl] of out.placed) {
    const u = unitPlace.get(id)!
    desired.push({
      trip_id: tid,
      day: pl.day,
      time: hhmm(pl.start),
      title: u.p.name,
      // what people navigate to: the address, else the name where it is; coordinates stay in the backend
      location: u.c.address ?? [u.p.name, u.c.area, CITY_EN[u.c.city ?? '']].filter(Boolean).join(', '),
      notes: noteOf(u),
      notes_en: noteOfEn(u),
      category: itemCategory(u.c.category ?? 'sight'),
      place_id: id,
      who: u.p.who,
      sort: 100 + pl.order,
      auto: true,
    })
  }
  const toInsert: Row[] = []
  const toUpdate: { id: string; row: Row }[] = []
  const toRemove: string[] = []
  const keep = new Set<string>()
  for (const row of desired) {
    const [first, ...extra] = autoByPlace.get(row.place_id as string) ?? []
    toRemove.push(...extra.map((i) => i.id))
    if (!first) {
      toInsert.push(row)
      continue
    }
    keep.add(first.id)
    const changed = (['day', 'time', 'title', 'location', 'notes', 'notes_en', 'category', 'who', 'sort'] as const).some(
      (k) => (first[k] ?? null) !== (row[k] ?? null) && !(k === 'time' && first.time?.slice(0, 5) === row.time),
    )
    if (changed) toUpdate.push({ id: first.id, row })
  }
  for (const i of autoItems) if (!keep.has(i.id) && !toInsert.some((r) => r.place_id === i.place_id) && !toRemove.includes(i.id)) {
    // the planner's own item for a place it no longer plans (or a stray without a place)
    if (!i.place_id || !out.placed.has(i.place_id)) toRemove.push(i.id)
  }

  // ---- warnings on items people fixed: closed that day, or outside opening hours
  // text is the Hebrew; kind and its details let the app word it in English
  const warnings: { item_id: string; text: string; kind: string; weekday?: number; opens?: string; closes?: string }[] = []
  const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  for (const i of fixedItems) {
    if (i.done) continue
    const f = factsOfItem(i)
    const d = days[i.day - 1]
    if (!f || !d) continue
    const runsThatDay = !f.open_dates?.length || f.open_dates.some((x) => x.slice(0, 10) === d.date)
    if (!runsThatDay || (f.closed_dates ?? []).some((x) => x.slice(0, 10) === d.date)) warnings.push({ item_id: i.id, text: 'סגור בתאריך הזה', kind: 'closed_date' })
    else if ((f.closed_weekdays ?? []).includes(d.weekday)) warnings.push({ item_id: i.id, text: `סגור ב${WEEKDAY[d.weekday]}`, kind: 'closed_weekday', weekday: d.weekday })
    else {
      const t = mins(i.time)
      const o = mins(f.opens)
      let c = mins(f.closes)
      if (o != null && c != null && c <= o) c = 24 * 60
      if (t != null && o != null && c != null && (t < o || t >= c)) warnings.push({ item_id: i.id, text: `פתוח רק ${f.opens}–${f.closes}`, kind: 'hours', opens: f.opens!, closes: f.closes! })
    }
  }
  for (const [id, why] of out.unplanned) {
    const u = unitPlace.get(id)!
    unplanned.push({ place_id: id, name: u.p.name, reason: why, who: u.p.who, city: CITY_HE[u.base] })
  }

  // the day's city, where nobody wrote one
  const cityRows: { day: number; city: string }[] = []
  for (const d of days) {
    const info = dayInfo.find((x) => x.day === d.day)
    if (info?.city) continue
    const names = [...new Set([...d.at.values()].map((p) => CITY_HE[p.base]).filter(Boolean))]
    if (names.length) cityRows.push({ day: d.day, city: names.join(' / ') })
  }

  // facts_pending: cards planned from their kind alone, never checked (fill their plan columns to plan them better)
  const summary = { unplanned, warnings, facts_pending: units.filter((u) => !unitPlace.get(u.id)!.f).length }
  const stats = {
    placed: out.placed.size,
    insert: toInsert.length,
    update: toUpdate.length,
    remove: toRemove.length,
    unplanned: unplanned.length,
  }
  if (dry) {
    const byDay = desired
      .map((r) => ({ day: r.day, time: r.time, title: r.title, who: r.who, notes: r.notes }))
      .sort((a, b) => (a.day as number) - (b.day as number) || String(a.time).localeCompare(String(b.time)))
    return {
      stats,
      summary,
      plan: byDay,
      cities: cityRows,
      // the planner's input, to replay it outside the edge runtime
      input: { units, fixed, days: days.map((d) => ({ ...d, at: Object.fromEntries(d.at) })) },
    }
  }

  if (toRemove.length) {
    const gone = autoItems.filter((i) => toRemove.includes(i.id) && i.place_id && !out.placed.has(i.place_id)).map((i) => i.place_id!)
    const { error } = await admin.from('itinerary_items').delete().in('id', toRemove).eq('auto', true)
    if (error) throw new Error(error.message)
    if (gone.length) await admin.from('places').update({ auto_planned: false }).in('id', gone)
  }
  for (const { id, row } of toUpdate) {
    // only while it is still the planner's: a person who edited it a moment ago wins
    const { error } = await admin.from('itinerary_items').update(row).eq('id', id).eq('auto', true)
    if (error) throw new Error(error.message)
  }
  if (toInsert.length) {
    const { error } = await admin.from('itinerary_items').insert(toInsert)
    if (error) throw new Error(error.message)
    await admin.from('places').update({ auto_planned: true }).in('id', toInsert.map((r) => r.place_id as string))
  }
  for (const r of cityRows) {
    await admin.from('day_info').upsert({ trip_id: tid, day: r.day }, { onConflict: 'trip_id,day', ignoreDuplicates: true })
    await admin.from('day_info').update({ city: r.city }).eq('trip_id', tid).eq('day', r.day).is('city', null)
  }
  return { stats, summary }
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}
