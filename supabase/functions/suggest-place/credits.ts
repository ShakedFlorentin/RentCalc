// AI credits for the edge functions (roadmap P3): hold credits before a Claude call, keep the charge when it works,
// give them back when it fails. Off unless the env CREDITS_ON is "1" or "true", so deploying this changes nothing.
// The same file sits in every function that charges (keep the copies identical).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Used only if credit_prices has no row for the function (the table is the source of truth)
const FALLBACK_COST: Record<string, number> = { 'suggest-place': 4, 'parse-booking': 1, translate: 1 }

export const creditsOn = () => ['1', 'true'].includes((Deno.env.get('CREDITS_ON') ?? '').toLowerCase())

/** The trip id from a request body when it is well formed, else null. Membership is checked in reserve_credits. */
export const tripIdOf = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)

export type Hold = { ok: true; opId: string } | { ok: false; status: number; body: Record<string, unknown> }

/**
 * Holds the price of `fn` for this operation. `key` is the operation's own id (a lookup id, or a fresh uuid), made
 * unique per user and function so nobody can reuse another's id for a free ride. The same key twice is one charge.
 * A hold already given back (refunded) by an earlier attempt is replaced by a new one under a numbered key.
 */
export async function hold(admin: SupabaseClient, userId: string, tripId: string | null, fn: string, key: string): Promise<Hold> {
  const { data: price } = await admin.from('credit_prices').select('cost').eq('fn', fn).maybeSingle()
  const cost = (price?.cost as number | undefined) ?? FALLBACK_COST[fn] ?? 1
  for (let attempt = 0; attempt < 5; attempt++) {
    const opId = `${fn}:${userId}:${key}${attempt ? `:r${attempt}` : ''}`
    const { data, error } = await admin.rpc('reserve_credits', { p_op_id: opId, p_user: userId, p_trip: tripId, p_fn: fn, p_cost: cost })
    if (error || !data) {
      console.error('reserve_credits failed', error?.message)
      return { ok: false, status: 503, body: { error: 'credits unavailable, try again' } }
    }
    const r = data as { ok: boolean; repeat?: boolean; state?: string; cost?: number; balance?: number; trip_balance?: number }
    if (!r.ok) return { ok: false, status: 402, body: { needs_credits: true, cost: r.cost ?? cost, balance: r.balance ?? 0, trip_balance: r.trip_balance ?? 0 } }
    if (r.repeat && r.state === 'refunded') continue
    return { ok: true, opId }
  }
  return { ok: false, status: 503, body: { error: 'credits unavailable, try again' } }
}

/** The operation worked: the held credits stay spent. */
export async function settle(admin: SupabaseClient, opId: string) {
  const { error } = await admin.rpc('settle_credits', { p_op_id: opId })
  if (error) console.error('settle_credits failed', error.message)
}

/** The operation gave no useful result: the held credits go back. */
export async function refund(admin: SupabaseClient, opId: string) {
  const { error } = await admin.rpc('refund_credits', { p_op_id: opId })
  if (error) console.error('refund_credits failed', error.message)
}
