// One-off upkeep: swipe cards whose text is still in English (the scouts' research) get a Hebrew translation, in the
// library and in every trip's copy of the card. Run with the planner token: { trip_id, translate_cards: true }.
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.1.0/helpers/zod'
import { z } from 'npm:zod@4'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { logCall } from './ai-log.ts'

const MODEL = 'claude-haiku-5-5'
const TEXT = ['hype', 'reality', 'tip', 'baby_notes', 'price', 'serves', 'todo', 'special', 'time_needed', 'kosher_note'] as const
const LISTS = ['dishes', 'highlights'] as const
const PER_CALL = 20

const Card = z.object({
  hype: z.string(),
  reality: z.string(),
  tip: z.string(),
  baby_notes: z.string(),
  price: z.string(),
  serves: z.string(),
  todo: z.string(),
  special: z.string(),
  time_needed: z.string(),
  kosher_note: z.string(),
  dishes: z.array(z.string()),
  highlights: z.array(z.string()),
})

const SYSTEM = `Translate a travel card about a place in Japan into natural, casual Hebrew for Israeli travellers.
Keep place names, brand names (Tabelog, Google), prices and numbers as they are. Keep each field about as short as the
original or shorter; no emoji, no exclamation marks. A field that is empty stays "". dishes and highlights stay short labels.`

type Row = Record<string, unknown> & { id: string; name: string }
const english = (v: unknown) =>
  (typeof v === 'string' && /[A-Za-z]{3}/.test(v) && !/[֐-׿]/.test(v)) ||
  (Array.isArray(v) && v.some((x) => typeof x === 'string' && /[A-Za-z]{3}/.test(x) && !/[֐-׿]/.test(x)))

/** Translates up to PER_CALL cards that still have English text; returns how many are left after this call. */
export async function translateCards(admin: SupabaseClient, client: Anthropic) {
  const { data, error } = await admin.from('place_library').select(['id', 'name', ...TEXT, ...LISTS].join(','))
  if (error) throw new Error(error.message)
  const todo = (data as unknown as Row[]).filter((r) => [...TEXT, ...LISTS].some((k) => english(r[k])))
  const batch = todo.slice(0, PER_CALL)
  const done = await Promise.all(
    batch.map(async (r) => {
      const t = performance.now()
      try {
        const src = Object.fromEntries([...TEXT, ...LISTS].map((k) => [k, r[k] ?? (LISTS.includes(k as never) ? [] : '')]))
        const res = await client.messages.parse({
          model: MODEL,
          max_tokens: 2500,
          output_config: { effort: 'low', format: zodOutputFormat(Card) },
          system: SYSTEM,
          messages: [{ role: 'user', content: `Place: ${r.name}\n\n${JSON.stringify(src, null, 1)}` }],
        })
        logCall(admin, { fn: 'plan-trip', step: 'translate-card', userId: null, model: MODEL, usage: res.usage, ms: performance.now() - t, stopReason: res.stop_reason })
        const out = res.parsed_output
        if (!out) return false
        // only the fields that were English change; a field someone already wrote in Hebrew stays
        const patch: Record<string, unknown> = {}
        for (const k of TEXT) if (english(r[k])) patch[k] = out[k].trim() || null
        for (const k of LISTS) if (english(r[k])) patch[k] = out[k]
        const { error } = await admin.from('place_library').update(patch).eq('id', r.id)
        if (error) throw new Error(error.message)
        // every trip's copy of the card, where it still holds the library's English text
        for (const [k, v] of Object.entries(patch)) {
          const old = r[k]
          const q = admin.from('candidates').update({ [k]: v }).eq('library_id', r.id)
          await (Array.isArray(old) ? q.contains(k, old as string[]).containedBy(k, old as string[]) : q.eq(k, old as string))
        }
        // a matched place's note was the card's tip plus its baby line, copied in English: now the Hebrew tip alone
        if (patch.tip !== undefined) {
          const was = [r.tip, r.baby_notes && 'עם התינוק: ' + r.baby_notes].filter(Boolean).join('\n')
          const { data: copies } = await admin.from('candidates').select('id').eq('library_id', r.id)
          const ids = (copies ?? []).map((c) => c.id as string)
          if (ids.length && was) await admin.from('places').update({ notes: patch.tip }).in('candidate_id', ids).eq('notes', was)
        }
        return true
      } catch (e) {
        console.error('translate failed', r.name, e instanceof Error ? e.message : e)
        logCall(admin, { fn: 'plan-trip', step: 'translate-card', userId: null, model: MODEL, ms: performance.now() - t, error: String(e instanceof Error ? e.message : e) })
        return false
      }
    }),
  )
  return { translated: done.filter(Boolean).length, failed: done.filter((x) => !x).length, left: todo.length - done.filter(Boolean).length }
}
