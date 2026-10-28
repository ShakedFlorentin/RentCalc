// What the planner needs to know about a place that the swipe card doesn't say: opening hours, closed days around the
// trip, how long a visit takes, and one short practical line in Hebrew (and the same in English). Looked up once per card with Claude and a
// few web searches; card-facts writes it onto the card's plan columns.
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.1.0/helpers/zod'
import { z } from 'npm:zod@4'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { logCall } from './ai-log.ts'

const MODEL = 'claude-haiku-5-5'

const FactsSchema = z.object({
  address: z.string(),
  line: z.string(),
  baby: z.string(),
  line_en: z.string(),
  baby_en: z.string(),
  opens: z.string(),
  closes: z.string(),
  closed_weekdays: z.array(z.number().int()),
  closed_dates: z.array(z.string()),
  best_time: z.enum(['morning', 'midday', 'afternoon', 'evening', 'night', 'any']),
  hours: z.number(),
  booking: z.enum(['required', 'recommended', 'no']),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
})
export type Facts = {
  key: string
  name: string
  address: string | null
  line_he: string | null
  baby_he: string | null
  line_en: string | null
  baby_en: string | null
  opens: string | null
  closes: string | null
  closed_weekdays: number[]
  closed_dates: string[]
  best_time: string
  hours: number | null
  booking: string
  lat: number | null
  lng: number | null
}

export type PlaceInfo = {
  name: string
  name_ja?: string | null
  city?: string | null
  area?: string | null
  category?: string | null
  tip?: string | null
  baby_notes?: string | null
  hype?: string | null
  reality?: string | null
  time_needed?: string | null
}

/** The same place under small differences in spelling, case or punctuation gets one key. */
export const factKey = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const RESEARCH = `You check practical visiting facts for a place in Japan for travellers there between 12 and 31 December 2026.
Search briefly (in English and Japanese) and report:
- regular opening hours (as of late 2026) and weekly closing days
- closures between 12 and 31 December 2026, especially the year-end holidays (usually from 28-31 December); say clearly when the place is open on those days if you find it
- whether you need to book ahead, and the usual queue
- how long a typical visit takes
- the best time of day to go, if there is one (sunset view, dinner, nightlife, morning before crowds)
- the exact address and coordinates
- anything that makes it hard with a stroller and a milk-only 5-month-old baby (no strollers allowed, stairs only, no children, smoking inside, very cramped)
Only report what you find or what is well known; say "unknown" otherwise. Plain facts, not who said them. Be brief.`

const EXTRACT = `Turn the notes into the fields below.
- address: the street address in English as Google Maps takes it (e.g. "4-2-15 Ginza, Chuo-ku, Tokyo"); for a street or area without one, the best place to navigate to (e.g. "Nishiki Market, Nakagyo-ku, Kyoto").
- line: ONE short practical tip in natural Hebrew, at most 70 characters, the single thing most worth knowing before going (book ahead, cash only, come before opening, buy the sunset slot, closed on Mondays). Not a description of the place. Keep place and brand names as they are. No emoji, no exclamation marks.
- baby: in Hebrew, at most 60 characters, ONLY if something there changes the plan with a milk-only baby (strollers not allowed, stairs only, no children, smoking inside). Otherwise "".
- Hebrew style for line and baby: short, everyday spoken Israeli Hebrew, like a friend texting the useful bit ("כדאי להגיע מוקדם", "אין מקום לעגלה"). No talk about sources ("לפי…", "מבקרים מציינים"), no marketing words or translation-ese, no em dashes; plural or impersonal, never a gendered singular.
- line_en / baby_en: the same two lines in plain, everyday English (same limits; baby_en "" when baby is ""). Short and practical ("Book ahead", "Cash only", "No room for a stroller"), no marketing words, no exclamation marks, no em dashes. baby_en must say the block in words like "no stroller", "stairs only", "smoky", "adults only", "not suitable".
- opens / closes: typical opening and closing time as "HH:MM" (24h); "" if it has no hours (a street, an area) or unknown. A bar open past midnight closes at e.g. "02:00".
- closed_weekdays: weekly closing days as numbers, 0 = Sunday ... 6 = Saturday; [] if none or unknown.
- closed_dates: dates between 2026-12-12 and 2026-12-31 it is closed as "YYYY-MM-DD" (year-end holidays included); [] if none or unknown.
- best_time: when to go if it matters (morning before crowds, midday for lunch, afternoon, evening for dinner or sunset, night for bars and night views); "any" otherwise.
- hours: typical visit length in hours including the usual queue (e.g. 1, 1.5, 3, 8 for a full day trip).
- booking: "required", "recommended" or "no".
- lat / lng: only if stated in the notes, else null.`

/** Looks a place up; null when the lookup failed. */
export async function lookUp(admin: SupabaseClient, client: Anthropic, p: PlaceInfo): Promise<Facts | null> {
  const known = [
    `Place: ${p.name}${p.name_ja ? ` (${p.name_ja})` : ''}`,
    p.area || p.city ? `Where: ${[p.area, p.city].filter(Boolean).join(', ')}` : '',
    p.category ? `Kind: ${p.category}` : '',
    [p.hype, p.reality, p.tip, p.baby_notes, p.time_needed].filter(Boolean).length
      ? `What the trip's card already says: ${[p.hype, p.reality, p.tip, p.baby_notes, p.time_needed && `time needed: ${p.time_needed}`]
          .filter(Boolean)
          .join(' / ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
  let step = 'facts-research'
  let t = performance.now()
  const log = (r: Anthropic.Message) =>
    logCall(admin, { fn: 'card-facts', step, userId: null, model: MODEL, usage: r.usage, ms: performance.now() - t, stopReason: r.stop_reason })
  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: known }]
    let research: Anthropic.Message | null = null
    for (let i = 0; i < 3; i++) {
      t = performance.now()
      research = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        output_config: { effort: 'low' },
        system: RESEARCH,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages,
      })
      log(research)
      if (research.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: research.content })
    }
    if (!research || research.stop_reason === 'refusal') return null
    const notes = research.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    step = 'facts-extract'
    t = performance.now()
    const r = await client.messages.parse({
      model: MODEL,
      max_tokens: 1500,
      output_config: { effort: 'low', format: zodOutputFormat(FactsSchema) },
      system: EXTRACT,
      messages: [{ role: 'user', content: `${known}\n\nNotes:\n${notes}` }],
    })
    log(r)
    const f = r.parsed_output
    if (!f) return null
    const time = (s: string) => (/^\d{1,2}:\d{2}$/.test(s.trim()) ? s.trim().padStart(5, '0') : null)
    const inJapan = f.lat != null && f.lng != null && f.lat > 24 && f.lat < 46 && f.lng > 122 && f.lng < 146
    return {
      key: factKey(p.name),
      name: p.name,
      address: f.address.trim() || null,
      line_he: f.line.trim() || null,
      baby_he: f.baby.trim() || null,
      line_en: f.line_en.trim() || null,
      baby_en: f.baby_en.trim() || null,
      opens: time(f.opens),
      closes: time(f.closes),
      closed_weekdays: [...new Set(f.closed_weekdays.filter((d) => d >= 0 && d <= 6))],
      closed_dates: f.closed_dates.filter((d) => /^2026-12-(1[2-9]|2\d|3[01])$/.test(d)),
      best_time: f.best_time,
      hours: f.hours > 0 && f.hours <= 12 ? f.hours : null,
      booking: f.booking,
      lat: inJapan ? f.lat : null,
      lng: inJapan ? f.lng : null,
    }
  } catch (error) {
    console.error('facts lookup failed', p.name, error instanceof Error ? error.message : error)
    logCall(admin, { fn: 'card-facts', step, userId: null, model: MODEL, ms: performance.now() - t, error: String(error instanceof Error ? error.message : error) })
    return null
  }
}
