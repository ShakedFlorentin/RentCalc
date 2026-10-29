// Turns an Instagram / TikTok / Google Maps link or a place name into a researched place card.
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

const MODEL = 'claude-haiku-5-5'
// Claude calls per user per function in 24 hours; each place lookup costs a few cents
const DAILY_LIMIT = 30

// Structured outputs allow at most 16 nullable/union fields, so text fields come back as "" when there is nothing to
// say (turned into null below); only numbers and enums stay nullable
const PlaceDraft = z.object({
  name: z.string(),
  name_ja: z.string(),
  city: z.enum(['tokyo', 'kyoto', 'osaka', 'nara', 'daytrip']),
  area: z.string(),
  category: z.enum(['food', 'sight', 'shopping', 'nightlife', 'cafe', 'experience']),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  hype: z.string(),
  reality: z.string(),
  verdict: z.enum(['gem', 'worth_it', 'overhyped', 'trap']).nullable(),
  tabelog_score: z.number().nullable(),
  google_score: z.number().nullable(),
  price: z.string(),
  tip: z.string(),
  audience: z.enum(['baby', 'adults']),
  baby_notes: z.string(),
  serves: z.string(),
  dishes: z.array(z.string()),
  todo: z.string(),
  special: z.string(),
  highlights: z.array(z.string()),
  time_needed: z.string(),
  kosher: z.enum(['friendly', 'options', 'hard']).nullable(),
  kosher_note: z.string(),
  sources: z.array(z.string()),
})
const TEXT_FIELDS = ['name_ja', 'area', 'hype', 'reality', 'price', 'tip', 'baby_notes', 'serves', 'todo', 'special', 'time_needed', 'kosher_note'] as const
/** "" back to null, so the app sees the same card shape as before */
type Draft = z.infer<typeof PlaceDraft>
const blanksToNull = (p: Draft) =>
  Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, (TEXT_FIELDS as readonly string[]).includes(k) && typeof v === 'string' && !v.trim() ? null : v]),
  ) as { [K in keyof Draft]: Draft[K] | (K extends (typeof TEXT_FIELDS)[number] ? null : never) }
// a post can be a roundup ("10 ramen spots in Tokyo"), so the answer is a list; empty when nothing was identified
const PlaceList = z.object({ places: z.array(PlaceDraft) })
// what the trip planner needs, asked in the same call so a new card can be planned without another lookup (the
// planner itself never calls Claude). Kept apart: if the API ever rejects the bigger schema, the card still comes back.
const PlanFields = z.object({
  address: z.string(),
  opens: z.string(),
  closes: z.string(),
  closed_weekdays: z.array(z.number().int()),
  closed_dates: z.array(z.string()),
  open_dates: z.array(z.string()),
  best_time: z.enum(['morning', 'midday', 'afternoon', 'evening', 'night', 'any']),
  visit_mins: z.number().int(),
  booking: z.enum(['required', 'recommended', 'no']),
  plan_line: z.string(),
  baby_block: z.string(),
})
// the same card text in English, for the app in English ("" / [] where the Hebrew has nothing)
const EnText = z.object({
  hype: z.string(),
  reality: z.string(),
  tip: z.string(),
  baby_notes: z.string(),
  price: z.string(),
  serves: z.string(),
  dishes: z.array(z.string()),
  todo: z.string(),
  special: z.string(),
  highlights: z.array(z.string()),
  time_needed: z.string(),
  kosher_note: z.string(),
  plan_line: z.string(),
  baby_block: z.string(),
})
type En = z.infer<typeof EnText>
const PlaceListPlanned = z.object({ places: z.array(PlaceDraft.extend(PlanFields.shape).extend({ en: EnText })) })
/** The English as the card's en column keeps it: "" → null. */
const enColumn = (e: En) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]))
type Plan = z.infer<typeof PlanFields>
/** The plan fields as the card columns want them ("" → null, odd values dropped); facts_at marks them checked. */
const planColumns = (p: Plan) => {
  const time = (t: string) => (/^\d{1,2}:\d{2}$/.test(t.trim()) ? t.trim().padStart(5, '0') : null)
  return {
    address: p.address.trim() || null,
    opens: time(p.opens),
    closes: time(p.closes),
    closed_weekdays: [...new Set(p.closed_weekdays.filter((d) => d >= 0 && d <= 6))],
    closed_dates: p.closed_dates.filter((d) => /^2026-12-(1[2-9]|2\d|3[01])$/.test(d)),
    open_dates: p.open_dates.filter((d) => /^2026-12-(1[2-9]|2\d|3[01])$/.test(d)),
    best_time: p.best_time,
    visit_mins: p.visit_mins > 0 && p.visit_mins <= 720 ? p.visit_mins : null,
    booking: p.booking,
    plan_line: p.plan_line.trim() || null,
    baby_block: p.baby_block.trim() || null,
    facts_at: new Date().toISOString().slice(0, 10),
    facts_sure: true,
  }
}
const MAX_PLACES = 10
// slides of a carousel sent along with the caption: roundups often name their places only on the pictures
const MAX_SLIDES = 8

// the search words go in a call of their own: in the card's schema they made it too big for structured output
const TagList = z.object({ places: z.array(z.object({ tags: z.array(z.string()) })) })
const Names = z.object({ places: z.array(z.string()) })
const LIST = `List the real places in Japan that the research notes identified, in the order the post lists them (at most 10). Give each one's name as the notes give it, with the branch or area when the notes name one. Return an empty list if no specific real place was identified.`
const TAGS = `For each place below, in the same order, give 10-25 hidden search words for the app's search (never shown): what it sells, serves or makes (each signature dish, product and key ingredient), the kind of place (ramen shop, bakery, temple, market, bar, onsen), cuisine, notable things you see or do there, and the words people would type instead, singular and plural, each in BOTH lowercase English and Hebrew (e.g. "pancake", "pancakes", "hotcake", "פנקייק", "פנקייקים"; "knives", "סכינים"). Japanese dish names in their usual romanization and Hebrew spelling. 1-3 words each; not the place's name, city or area; nothing the notes don't support.`

const RESEARCH = `You help two Israeli couples plan a December trip to Japan (Tokyo, Kyoto, Osaka and day trips). One couple brings a 5-month-old baby who only drinks milk.
A member shared a place (a social-media post, a map link, or just a name). Work out exactly which real place (or places) in Japan it is about, then research it.
If the post names several places (a list or roundup), identify each one (up to 10) and research each briefly; one short paragraph per place is enough. For each place:
- what it is and what people rave about online
- Tabelog score (search in Japanese too) and Google rating; only report numbers you actually see
- full address, neighbourhood and coordinates
- for a restaurant, cafe or bar: what it serves (cuisine, signature dishes or drinks, format such as counter course or street stall)
- for anything else (sight, experience, shopping): what you actually do there, what makes it special, what not to miss, and how long a visit takes
- price level, booking/queue tips
- for food, cafes and bars: whether you can eat there without pork (incl. pork broth, lard, chashu) or seafood (shellfish, shrimp, crab, octopus, squid, eel, sea urchin); fish with fins and scales is fine. Name what to order or what to avoid
- with a milk-only baby: stroller access, a quiet spot or private room to nurse, nursing room nearby, smoking; or why it's better as an adults-only outing
- honest verdict: hidden gem, worth it, overhyped, or tourist trap
- opening hours, weekly closing days, closures between 12 and 31 December 2026 (year-end holidays), for a market or event the dates it runs in that period, whether to book, how long a visit takes and the best time of day
If you only have a link with no caption, search for the post itself (its URL, its code and the account) to find which places it shows.
Write the notes as plain facts (what, where, when, how much), not as what blogs, reviewers or sites say, and state each fact once.
Be concise. If you can't identify any specific place, say so.`

const EXTRACT = `Turn the research notes into place cards, one per real place the notes identified, in the order the post lists them (at most 10). Return an empty list if no specific real place was identified. Rules for each card:
- city: tokyo, kyoto, osaka, nara, or daytrip for anywhere else.
- hype, reality, tip, baby_notes, price: one short sentence each in natural, casual Hebrew; keep place names, brand names (Tabelog, Google) and numbers as they are.
- serves: for a restaurant, cafe or bar, one or two short Hebrew sentences on what it serves, explaining Japanese dish names in plain words (e.g. "אוקונומיאקי (פנקייק כרוב על הפלנצ׳ה)"); "" for other places. dishes: 2-4 signature items as short Hebrew labels, or [].
- todo / special / highlights / time_needed: for sights, experiences and shopping ("" / [] for restaurants, cafes and bars). todo: 2-3 Hebrew sentences on what you actually do there, as a visit plays out. special: 1-2 Hebrew sentences on what sets it apart, specific rather than generic praise. highlights: 2-4 short Hebrew labels of what not to miss. time_needed: e.g. "שעה-שעתיים" or "חצי יום".
- kosher / kosher_note: for a restaurant, cafe or bar only (kosher null and kosher_note "" for other places). kosher is "friendly" when most of the menu has no pork or seafood (fish with fins and scales is fine), "options" when there are good dishes without them but you must choose, "hard" when the core of the place is pork or seafood. kosher_note: one short Hebrew sentence on what to order or avoid. Never claim kosher certification.
- tabelog_score / google_score / lat / lng: only if stated in the notes, else null.
- audience: "baby" if it works with the baby, otherwise "adults".
- sources: the URLs the notes relied on.
- address (when asked for): the street address in English as Google Maps takes it (e.g. "4-2-15 Ginza, Chuo-ku, Tokyo"); for a street or area without one, the best place to navigate to.
- opens / closes (when asked for): usual opening and closing time "HH:MM" (24h; a bar past midnight closes e.g. "02:00"); "" if it has no hours or unknown. closed_weekdays: weekly closing days, 0 = Sunday ... 6 = Saturday; [] if none or unknown. closed_dates: dates between 2026-12-12 and 2026-12-31 it is closed, "YYYY-MM-DD"; [] if none or unknown. open_dates: only for something that runs on certain dates only (a market, a festival, an event): the dates between 2026-12-12 and 2026-12-31 it runs, "YYYY-MM-DD"; [] for a place that is simply open on its usual days.
- best_time: morning, midday, afternoon, evening (dinner, sunset) or night (bars, night views) when it matters, else any. visit_mins: a typical visit in minutes including the usual queue. booking: required, recommended or no.
- plan_line: ONE practical Hebrew tip, at most 70 characters, the single thing most worth knowing before going (book ahead, cash only, come before opening); not a description. baby_block: Hebrew, at most 60 characters, only if something blocks a visit with the baby (no strollers, stairs only, no children, smoking inside); otherwise "".
- en (when asked for): the same card in plain, everyday English, field by field (hype, reality, tip, baby_notes, price, serves, dishes, todo, special, highlights, time_needed, kosher_note, plan_line, baby_block): same facts, same length or shorter, like a friend texting the useful bit. No marketing words ("hidden gem", "must-see", "vibrant", "nestled", "experience"), no talk about sources, no exclamation marks, no em dashes. plan_line at most 70 characters; baby_block at most 60 and only when the Hebrew has one, saying the block in words like "no stroller", "stairs only", "smoky", "adults only", "not suitable". "" or [] where the Hebrew field is empty.
- Any other text field with nothing to say is an empty string "".
- Hebrew style for every Hebrew field: short, everyday spoken Israeli Hebrew, like a friend who has been there texting the useful bit ("כדאי להגיע מוקדם", "אין מקום לעגלה", "תור ארוך בצהריים"). Concrete (times, prices, what to eat or do) and each fact once across the card, never repeated in another field. Never talk about sources or who said it ("לפי…", "מבקרים מציינים", "בלוגרים", "מדווחים"): state the fact, or leave out what is too unsure. No translation-ese or marketing words (חוויה, מושלם, בלתי נשכח, פנינה, "לא רק X אלא גם Y", מציע, "ניתן ל"), no em dashes. Address readers in the plural or impersonally, never in a gendered singular.
- Plain text only: no emoji, no exclamation marks.`

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

type Post = { text: string; images: string[] }

/**
 * Caption of the shared post, so the model knows what it is about (posts themselves need a login), and its pictures:
 * every slide of an Instagram carousel, or a video's cover.
 */
async function postContext(link: string): Promise<Post> {
  const none = { text: '', images: [] }
  // fetch only real Instagram/TikTok pages, never an address the link merely mentions
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return none
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (url.protocol !== 'https:') return none
  try {
    if (host === 'tiktok.com' || host === 'vm.tiktok.com') {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`, { signal: AbortSignal.timeout(8000) })
      if (r.ok) {
        const o = await r.json()
        return { text: `TikTok post by @${o.author_unique_id ?? o.author_name}: ${o.title ?? ''}`, images: o.thumbnail_url ? [o.thumbnail_url] : [] }
      }
    }
    if (host === 'instagram.com') {
      // Instagram serves Open Graph tags to link-preview crawlers; the public embed page carries the full caption
      const code = url.pathname.match(/^\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1]
      const pages = [
        `https://www.instagram.com${url.pathname}`,
        ...(code ? [`https://www.instagram.com/p/${code}/embed/captioned/`] : []),
      ]
      const parts: string[] = []
      const images: string[] = []
      for (const page of pages) {
        const r = await fetch(page, { headers: { 'User-Agent': 'facebookexternalhit/1.1' }, signal: AbortSignal.timeout(8000) }).catch(
          () => null,
        )
        if (!r?.ok) continue
        const html = await r.text()
        for (const tag of html.match(/<meta[^>]+>/gi) ?? []) {
          if (!/(property|name)="(og:title|og:description|description)"/i.test(tag)) continue
          const c = tag.match(/content="([^"]*)"/i)?.[1]
          if (c) parts.push(decode(c))
        }
        const cap = html.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments/i)?.[1]
        if (cap) parts.push(decode(cap.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')))
        // the embed page's data lists every slide (display_url, inside an escaped JSON string)
        for (const m of html.matchAll(/display_url\\*"\s*:\s*\\*"(https:[^"]+?)\\*"/g)) {
          images.push(m[1].replace(/\\+\//g, '/').replace(/\\+u0026/g, '&'))
        }
      }
      const text = [...new Set(parts.map((x) => x.trim()).filter(Boolean))].join(' — ').slice(0, 4000)
      return { text: text ? `Instagram post: ${text}` : '', images: [...new Set(images)].slice(0, MAX_SLIDES) }
    }
  } catch {
    // fall back to the link alone
  }
  return none
}

/** The Claude key: a function secret if one is set, otherwise the copy kept in Supabase Vault. */
async function anthropicKey(admin: SupabaseClient) {
  const env = Deno.env.get('ANTHROPIC_API_KEY')
  if (env) return env
  const { data } = await admin.rpc('get_anthropic_key')
  return (data as string | null) ?? undefined
}

/** The signed-in trip member behind the request, with a service client; or the response to send instead. */
async function signedIn(req: Request, json: (body: unknown, status?: number) => Response) {
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
  return { userId: auth.user.id, admin }
}

/** Lets the user spend the Claude key only under today's cap, and records the call; or the response to send instead. */
async function charge(admin: SupabaseClient, userId: string, fn: string, json: (body: unknown, status?: number) => Response) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: used } = await admin
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('fn', fn)
    .gte('at', since)
  if ((used ?? 0) >= DAILY_LIMIT) return json({ error: 'daily limit reached' }, 429)
  await admin.from('ai_usage').insert({ user_id: userId, fn })
  return null
}

/**
 * The same post or the same place name gives the same key, whatever tracking bits the share link carries
 * (?igsh=, ?cplk=, a trailing slash, www): a repeat is answered from place_lookups instead of searched again.
 */
function lookupKey(link: string, text: string) {
  if (link) {
    try {
      const u = new URL(link)
      const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
      const ig = host === 'instagram.com' && u.pathname.match(/^\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1]
      if (ig) return 'ig:' + ig
      return 'url:' + host + u.pathname.replace(/\/+$/, '')
    } catch {
      return null
    }
  }
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return t ? 'q:' + t : null
}
// a saved answer is good for a month; places don't move, but scores and hours do
const CACHE_DAYS = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Supabase's runtime keeps a promise running after the response is sent, or after the client has gone
const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // check the request before charging for it, so a malformed one doesn't use up the daily quota
  const body = (await req.json().catch(() => null)) as { link?: unknown; text?: unknown; id?: unknown } | null
  const link = typeof body?.link === 'string' ? body.link : undefined
  const text = typeof body?.text === 'string' ? body.text : undefined
  if (!link?.trim() && !text?.trim()) return json({ error: 'nothing to look up' }, 400)
  if ((link?.length ?? 0) > 500 || (text?.length ?? 0) > 1000) return json({ error: 'too long' }, 413)

  const who = await signedIn(req, json)
  if (who instanceof Response) return who
  const { userId, admin } = who
  const key = lookupKey(link?.trim() ?? '', text ?? '')
  // the app's own id for this lookup, so it can read the result back if it stopped waiting; only ever inserted, so
  // an id that's taken (someone else's lookup) gets a fresh one instead of overwriting it
  let id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : crypto.randomUUID()
  const track = async (row: Record<string, unknown>) => {
    const { error } = await admin.from('place_lookups').insert({ id, user_id: userId, lookup_key: key, ...row })
    if (error?.code === '23505') {
      id = crypto.randomUUID()
      await admin.from('place_lookups').insert({ id, user_id: userId, lookup_key: key, ...row })
    }
  }

  if (key) {
    const since = new Date(Date.now() - CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: hit } = await admin
      .from('place_lookups')
      .select('places')
      .eq('lookup_key', key)
      .eq('status', 'done')
      .gte('finished_at', since)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const places = hit?.places as unknown[] | null
    if (places?.length) {
      console.log('cached', key, places.length)
      await track({ status: 'done', places, finished_at: new Date().toISOString() })
      logCall(admin, { fn: 'suggest-place', step: 'cached', userId, lookupId: id })
      return json({ places, cached: true })
    }
  }

  const refused = await charge(admin, userId, 'suggest-place', json)
  if (refused) return refused
  await track({ status: 'running' })

  // the search runs on its own, so it finishes and saves its result even if the phone stops waiting
  const work = research(admin, link, text, userId, id).then(async (r) => {
    const finished_at = new Date().toISOString()
    await admin
      .from('place_lookups')
      .update('places' in r ? { status: 'done', places: r.places, finished_at } : { status: 'failed', error: r.error, finished_at })
      .eq('id', id)
    return r
  })
  edge?.waitUntil(work)
  const r = await work
  return 'places' in r ? json({ places: r.places }) : json({ error: r.error }, r.status)
})

/** Finds the place(s) a link or name is about and turns them into cards; or an error with its status. */
async function research(admin: SupabaseClient, link: string | undefined, text: string | undefined, userId: string, lookupId: string): Promise<
  { places: Record<string, unknown>[] } | { error: string; status: number }
> {
  const post = link ? await postContext(link) : { text: '', images: [] }
  const caption = post.text
  const slides = await pictures(post.images)
  console.log('caption', caption.length, 'slides', slides.length, caption.slice(0, 300))
  const ask = [
    link && `Link: ${link}`,
    caption,
    slides.length && `The post's ${slides.length} picture(s) follow: place names, addresses or signs on them identify the places.`,
    text && `Note from the member: ${text}`,
  ]
    .filter(Boolean)
    .join('\n')

  const client = new Anthropic({ apiKey: await anthropicKey(admin) })
  // each Claude call goes to ai_calls with its tokens, searches, cost and time
  let step = 'research'
  let t = performance.now()
  const log = (r: Anthropic.Message) =>
    logCall(admin, { fn: 'suggest-place', step, userId, lookupId, model: MODEL, usage: r.usage, ms: performance.now() - t, stopReason: r.stop_reason })
  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: [{ type: 'text', text: ask }, ...slides] }]
    let research: Anthropic.Message | null = null
    for (let i = 0; i < 4; i++) {
      t = performance.now()
      research = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low' },
        system: RESEARCH,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
        messages,
      })
      log(research)
      if (research.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: research.content })
    }
    if (!research || research.stop_reason === 'refusal') return { error: 'could not research this place', status: 422 }
    const notes = research.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    // each call times and logs itself: the cards below are written side by side
    const timed = async <T extends Anthropic.Message>(name: string, call: () => Promise<T>) => {
      const start = performance.now()
      try {
        const r = await call()
        logCall(admin, { fn: 'suggest-place', step: name, userId, lookupId, model: MODEL, usage: r.usage, ms: performance.now() - start, stopReason: r.stop_reason })
        return r
      } catch (error) {
        logCall(admin, { fn: 'suggest-place', step: name, userId, lookupId, model: MODEL, ms: performance.now() - start, error: String(error instanceof Error ? error.message : error) })
        throw error
      }
    }
    const material = `${ask}\n\nResearch notes:\n${notes}`
    // which places the notes found, first: one call writing every card took 40 s for a five-place roundup, so each card
    // gets a call of its own and they run at the same time, with the search words beside them
    step = 'list'
    const listed = await timed('list', () =>
      client.messages.parse({
        model: MODEL,
        max_tokens: 1000,
        output_config: { effort: 'low', format: zodOutputFormat(Names) },
        system: LIST,
        messages: [{ role: 'user', content: material }],
      }),
    )
    const names = [...new Set((listed.parsed_output?.places ?? []).map((n) => n.trim()).filter(Boolean))].slice(0, MAX_PLACES)
    if (!names.length) {
      console.log('places 0', notes.slice(0, 500))
      return { places: [] }
    }
    step = 'extract'
    const write = (name: string) => {
      const extract = <T extends z.ZodType>(schema: T) =>
        timed('extract', () =>
          client.messages.parse({
            model: MODEL,
            max_tokens: 8000,
            output_config: { effort: 'low', format: zodOutputFormat(schema) },
            system: EXTRACT,
            messages: [{ role: 'user', content: `${material}\n\nWrite the card for this one place only: ${name}` }],
          }),
        )
      // a rejected schema must not cost the card: ask again without the plan fields
      return extract(PlaceListPlanned).catch((error) => {
        if (!(error instanceof Anthropic.BadRequestError)) throw error
        console.error('plan fields rejected, asking without them', error.message)
        return extract(PlaceList)
      }) as Promise<{ parsed_output: { places: (Draft & Partial<Plan> & { en?: En })[] } | null }>
    }
    let failure: unknown = null
    const [cards, tags] = await Promise.all([
      Promise.all(
        names.map((name) =>
          write(name)
            .then((r) => r.parsed_output?.places[0] ?? null)
            .catch((error) => {
              failure ??= error
              console.error('card failed', name, error instanceof Error ? error.message : error)
              return null
            }),
        ),
      ),
      timed('tags', () => searchWords(client, names, notes)).catch(() => null),
    ])
    // every card failed: report why, as one call failing used to
    if (!cards.some(Boolean)) {
      if (failure) throw failure
      return { error: 'could not read the research', status: 422 }
    }
    // the notes are prose, so take the sources from the search itself: cited pages first, then results
    const cited = research.content.flatMap((b) =>
      b.type === 'text' ? (b.citations ?? []).flatMap((c) => ('url' in c && c.url ? [c.url] : [])) : [],
    )
    const results = research.content.flatMap((b) =>
      b.type === 'web_search_tool_result' && Array.isArray(b.content) ? b.content.map((r) => ({ url: r.url, title: r.title ?? '' })) : [],
    )
    // sources become links in the app, so keep real web addresses only
    const web = (urls: string[]) => urls.filter((u) => /^https?:\/\//i.test(u))
    const fallback = web([...new Set([...cited, ...results.map((r) => r.url)])]).slice(0, 5)
    // the search pages about one place of a roundup: their titles carry its name (the post itself is about all of them)
    const about = (name: string) => {
      const named = distinctive(name)
      const need = Math.min(2, named.length)
      return need ? results.filter((r) => named.filter((w) => distinctive(r.title).includes(w)).length >= need).map((r) => r.url) : []
    }
    const lists = (tags?.parsed_output?.places ?? []).map((x) => [...new Set(x.tags.map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 30))
    const places: Record<string, unknown>[] = cards.flatMap((full, i) => {
      if (!full) return []
      const { address, opens, closes, closed_weekdays, closed_dates, open_dates, best_time, visit_mins, booking, plan_line, baby_block, en, ...p } = full
      const plan = { address, opens, closes, closed_weekdays, closed_dates, open_dates, best_time, visit_mins, booking, plan_line, baby_block }
      const own = [...new Set([...web(p.sources), ...web(about(p.name))])].slice(0, 6)
      return [
        {
          ...blanksToNull(p as Draft),
          sources: own.length ? own : fallback,
          // the planner's columns, ready for the card (absent when the plan fields were rejected)
          ...(plan_line !== undefined ? planColumns(plan as Plan) : {}),
          ...(en ? { en: enColumn(en) } : {}),
          ...(lists[i]?.length ? { tags: lists[i] } : {}),
        },
      ]
    })
    console.log('places', places.length, places.map((p) => p.name).join(' | '))
    return { places }
  } catch (error) {
    // the reason goes to the function log: a 502 alone said nothing when the schema was rejected
    if (error instanceof Anthropic.APIError) console.error('claude error', error.status, error.message)
    logCall(admin, { fn: 'suggest-place', step, userId, lookupId, model: MODEL, ms: performance.now() - t, error: String(error instanceof Error ? error.message : error) })
    if (error instanceof Anthropic.AuthenticationError) return { error: 'ANTHROPIC_API_KEY is missing or invalid', status: 500 }
    if (error instanceof Anthropic.RateLimitError) return { error: 'busy, try again in a minute', status: 429 }
    if (error instanceof Anthropic.APIError) return { error: `Claude API error ${error.status}`, status: 502 }
    console.error('lookup failed', error)
    return { error: 'lookup failed', status: 500 }
  }
}

// words that say what kind of place it is, not which one
const GENERIC = new Set(
  'the and main store shop branch honten restaurant cafe coffee bar izakaya yakiniku ramen sushi tempura temple shrine street market tokyo kyoto osaka nara kobe japan'.split(' '),
)
/** The words of a name that tell this place from others. */
const distinctive = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w))

/** The post's pictures as image blocks for Claude: JPEG, PNG or WebP under 5 MB; the others are left out. */
async function pictures(urls: string[]): Promise<Anthropic.ImageBlockParam[]> {
  const got = await Promise.all(
    urls.map(async (u): Promise<Anthropic.ImageBlockParam | null> => {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) })
        const type = (r.headers.get('content-type') ?? '').split(';')[0].trim()
        if (!r.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) return null
        const bytes = new Uint8Array(await r.arrayBuffer())
        if (bytes.length > 4_500_000) return null
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return { type: 'image', source: { type: 'base64', media_type: type as 'image/jpeg' | 'image/png' | 'image/webp', data: btoa(bin) } }
      } catch {
        return null
      }
    }),
  )
  return got.filter((x): x is Anthropic.ImageBlockParam => !!x)
}

/** Hidden search words for each place the notes found (what it sells, what kind of place, synonyms in Hebrew and English). */
function searchWords(client: Anthropic, names: string[], notes: string) {
  return client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(TagList) },
    system: TAGS,
    messages: [{ role: 'user', content: `Places:\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nWhat the research found about them:\n${notes}` }],
  })
}
