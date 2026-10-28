// Logs each Claude call to the ai_calls table: tokens, web searches, list-price cost and time.
// The same file sits in every function folder (keep the copies identical).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// USD per million tokens. Haiku 5.5 has two rate cards, picked by the prompt's size: up to 100K tokens, and above
const PRICES: Record<string, { in: number; out: number; inLong: number; outLong: number }> = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5, inLong: 0.5, outLong: 2.5 },
}
const LONG_PROMPT = 100_000
// USD per web search ($10 per 1,000)
const WEB_SEARCH = 0.01

/** The usage block of a Messages API response (only the fields priced here). */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number | null } | null
}

/** List price of one call; cache writes are 1.25x and cache reads 0.1x the input rate. */
export function costOf(model: string, u: Usage) {
  const p = PRICES[model]
  if (!p) return 0
  const write = u.cache_creation_input_tokens ?? 0
  const read = u.cache_read_input_tokens ?? 0
  const long = u.input_tokens + write + read > LONG_PROMPT
  const rateIn = long ? p.inLong : p.in
  const rateOut = long ? p.outLong : p.out
  const tokens = u.input_tokens * rateIn + write * rateIn * 1.25 + read * rateIn * 0.1 + u.output_tokens * rateOut
  return tokens / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH
}

export type Call = {
  fn: string
  step: string
  userId: string
  lookupId?: string
  model?: string
  usage?: Usage
  ms?: number
  stopReason?: string | null
  error?: string
}

// Supabase's runtime finishes a promise after the response is sent: logging never delays the answer
const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime

/** Records one call without making the user wait for it; a failed log never fails the request. */
export function logCall(admin: SupabaseClient, c: Call) {
  const u = c.usage
  const row = {
    fn: c.fn,
    step: c.step,
    user_id: c.userId,
    lookup_id: c.lookupId ?? null,
    model: c.model ?? null,
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_read_tokens: u?.cache_read_input_tokens ?? 0,
    cache_write_tokens: u?.cache_creation_input_tokens ?? 0,
    web_searches: u?.server_tool_use?.web_search_requests ?? 0,
    cost_usd: c.model && u ? Number(costOf(c.model, u).toFixed(6)) : 0,
    ms: c.ms == null ? null : Math.round(c.ms),
    stop_reason: c.stopReason ?? null,
    error: c.error?.slice(0, 500) ?? null,
  }
  const done = Promise.resolve(admin.from('ai_calls').insert(row)).then(
    ({ error }) => error && console.error('ai_calls log failed', error.message),
    (e) => console.error('ai_calls log failed', e),
  )
  edge?.waitUntil(done)
  return done
}
