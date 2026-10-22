import type { Expense, Member } from './types'

export type Cur = Expense['currency']
export type Transfer = { from: string; to: string; amount: number }

// Everything is computed in whole minor units (yen, or agorot) so shares add up exactly and balances sum to zero.
const SCALE: Record<Cur, number> = { JPY: 1, ILS: 100 }
export const SYMBOL: Record<Cur, string> = { JPY: '¥', ILS: '₪' }

/** Minor units of an amount in `cur`: whole yen, or agorot. */
export const toMinor = (amount: number, cur: Cur) => Math.round(amount * SCALE[cur])
export const fromMinor = (minor: number, cur: Cur) => minor / SCALE[cur]

/** `amount` converted between currencies with the trip's rate (shekels per yen), rounded for the target currency. */
export function convert(amount: number, from: Cur, to: Cur, ilsPerJpy: number) {
  if (from === to) return fromMinor(toMinor(amount, to), to)
  const v = from === 'JPY' ? amount * ilsPerJpy : amount / ilsPerJpy
  return fromMinor(toMinor(v, to), to)
}

/** An expense's amount in minor units of `cur`. */
const inCurrency = (e: Expense, cur: Cur, rate: number) => toMinor(convert(Number(e.amount), e.currency, cur, rate), cur)

/** Splits `total` minor units evenly; the leftover units go to the first people in id order, so it is stable. */
export function splitEvenly(total: number, ids: string[]) {
  const sorted = [...ids].sort()
  const base = Math.floor(total / sorted.length)
  const extra = total - base * sorted.length
  return new Map(sorted.map((id, i) => [id, base + (i < extra ? 1 : 0)]))
}

/**
 * Net balance per person in minor units of `cur`: positive means they are owed money. A settlement is the same
 * thing as an expense with one person in the split, so it needs no special case.
 */
export function balances(expenses: Expense[], ids: string[], cur: Cur, rate: number) {
  const bal: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]))
  for (const e of expenses) {
    const total = inCurrency(e, cur, rate)
    bal[e.paid_by] = (bal[e.paid_by] ?? 0) + total
    for (const [id, share] of splitEvenly(total, e.split_among)) bal[id] = (bal[id] ?? 0) - share
  }
  return bal
}

/** Fewest-ish payments that settle everyone: the biggest debtor pays the biggest creditor, repeatedly. */
export function simplify(bal: Record<string, number>): Transfer[] {
  const debtors = Object.entries(bal).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }))
  const creditors = Object.entries(bal).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }))
  const out: Transfer[] = []
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
    creditors.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
    const d = debtors[0]
    const c = creditors[0]
    const amount = Math.min(d.v, c.v)
    out.push({ from: d.id, to: c.id, amount })
    d.v -= amount
    c.v -= amount
    if (!d.v) debtors.shift()
    if (!c.v) creditors.shift()
  }
  return out
}

/** Per couple: net balance, and what they put in (settlements don't count as spending). */
export function coupleTotals(expenses: Expense[], members: Member[], bal: Record<string, number>, cur: Cur, rate: number) {
  const coupleOf = new Map(members.map((m) => [m.user_id, m.couple]))
  const out: Record<string, { net: number; paid: number }> = {}
  const row = (c: string) => (out[c] ??= { net: 0, paid: 0 })
  for (const [id, v] of Object.entries(bal)) {
    const c = coupleOf.get(id)
    if (c) row(c).net += v
  }
  for (const e of expenses) {
    const c = coupleOf.get(e.paid_by)
    if (c && e.kind === 'expense') row(c).paid += inCurrency(e, cur, rate)
  }
  return out
}

/** "¥1,200" or "₪120.50"; whole shekels drop the agorot. */
export function fmtMoney(minor: number, cur: Cur) {
  const v = Math.abs(fromMinor(minor, cur))
  const digits = cur === 'ILS' && minor % 100 ? 2 : 0
  return SYMBOL[cur] + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
