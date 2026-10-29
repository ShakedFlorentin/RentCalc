// Changes made with no connection: a swipe, a ticked task, a new expense. Every write to a table goes through
// outboxFetch (the Supabase client's fetch). When there is no network it is kept here, in order, the app answers as if
// it was saved, and screens show it at once (useTripTable lays the pending changes over the rows it has). When the
// phone is back online the changes are sent in the order they were made, then the screens reload.
// Only table writes wait here; AI lookups, translation and file uploads need a connection.

type Pending = {
  id: string
  table: string
  method: 'POST' | 'PATCH' | 'DELETE'
  /** the PostgREST path and query, e.g. "/rest/v1/swipes?on_conflict=..." */
  path: string
  prefer: string | null
  body: string | null
  at: number
}

const KEY = 'outbox'
const WRITES = new Set(['POST', 'PATCH', 'DELETE'])
// tables whose rows have a uuid `id`: a row added offline gets its id here, so a later edit or delete of it, made
// before it reached the server, points at the same row
const HAS_ID = new Set(['itinerary_items', 'places', 'expenses', 'checklist_items', 'bookings', 'essentials', 'candidates', 'reports'])
// the columns that make a row unique, for laying an upsert over the rows on screen
const ROW_KEY: Record<string, string[]> = { swipes: ['trip_id', 'candidate_id', 'user_id'], day_info: ['trip_id', 'day'] }

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())

function read(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
function write(list: Pending[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage full or blocked: the change stays in memory until the app closes
  }
  memory = list
  changed()
}
let memory: Pending[] = read()

/** The changes still waiting for a connection. */
export const pending = () => memory

/** Calls back whenever the waiting changes do (queued, sent). */
export function onOutbox(f: () => void) {
  listeners.add(f)
  return () => listeners.delete(f)
}

const tableOf = (url: URL) => url.pathname.match(/\/rest\/v1\/([^/]+)$/)?.[1] ?? null

/** The answer PostgREST would have given, made up from the request itself. */
function madeUp(method: string, body: string | null, prefer: string | null, accept: string | null) {
  if (method === 'POST' && prefer?.includes('return=representation') && body) {
    const rows = JSON.parse(body)
    const list = Array.isArray(rows) ? rows : [rows]
    const one = accept?.includes('vnd.pgrst.object')
    return new Response(JSON.stringify(one ? list[0] : list), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(null, { status: method === 'POST' ? 201 : 204 })
}

function enqueue(url: URL, method: string, init: RequestInit, headers: Headers) {
  const table = tableOf(url)!
  let body = typeof init.body === 'string' ? init.body : null
  if (method === 'POST' && body && HAS_ID.has(table)) {
    const rows = JSON.parse(body)
    const withId = (r: Record<string, unknown>) => ({ id: crypto.randomUUID(), ...r })
    body = JSON.stringify(Array.isArray(rows) ? rows.map(withId) : withId(rows))
  }
  const item: Pending = {
    id: crypto.randomUUID(),
    table,
    method: method as Pending['method'],
    path: url.pathname + url.search,
    prefer: headers.get('Prefer'),
    body,
    at: Date.now(),
  }
  write([...memory, item])
  return madeUp(method, body, item.prefer, headers.get('Accept'))
}

const offline = (e: unknown) => e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')

let base = ''
let apiKey = ''
let token: () => Promise<string | null> = async () => null
let flushing: Promise<void> | null = null

/**
 * Sends the waiting changes in order. Stops at the first one the network can't carry (and tries again later);
 * one the server refuses (a duplicate, a row deleted meanwhile) is dropped so it can't block the rest.
 */
export function flush() {
  if (flushing || !memory.length || !base) return flushing ?? Promise.resolve()
  flushing = (async () => {
    let sent = 0
    while (memory.length) {
      const item = memory[0]
      const auth = await token()
      const headers: Record<string, string> = { apikey: apiKey, 'Content-Type': 'application/json' }
      if (auth) headers.Authorization = `Bearer ${auth}`
      if (item.prefer) headers.Prefer = item.prefer.replace('return=representation', 'return=minimal')
      let res: Response
      try {
        res = await realFetch(base + item.path, { method: item.method, headers, body: item.body ?? undefined })
      } catch {
        break
      }
      // signed out or the login lapsed: keep it for when the person is back
      if (res.status === 401) break
      if (res.status >= 500) break
      if (!res.ok) console.warn('outbox: dropped', item.table, item.method, res.status, await res.text().catch(() => ''))
      write(memory.slice(1))
      sent++
    }
    if (sent) window.dispatchEvent(new Event('outbox-sent'))
  })().finally(() => {
    flushing = null
  })
  return flushing
}

const realFetch: typeof fetch = (...args) => fetch(...args)

/** The Supabase client's fetch: table writes wait in the outbox when there is no network. */
export const outboxFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (init.method ?? 'GET').toUpperCase()
  if (!WRITES.has(method) || !tableOf(url)) return realFetch(input, init)
  const headers = new Headers(init.headers)
  // a change made after others that are still waiting goes after them
  if (memory.length && navigator.onLine) await flush()
  if (!navigator.onLine || memory.length) return enqueue(url, method, init, headers)
  try {
    return await realFetch(input, init)
  } catch (e) {
    if (offline(e)) return enqueue(url, method, init, headers)
    throw e
  }
}

/** Points the outbox at the project and the session, and sends what waits whenever the phone is back online. */
export function startOutbox(url: string, key: string, getToken: () => Promise<string | null>) {
  base = url.replace(/\/$/, '')
  apiKey = key
  token = getToken
  const go = () => navigator.onLine && flush()
  window.addEventListener('online', go)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && go())
  setTimeout(go, 1500)
}

// ---- laying the waiting changes over rows on screen

/** PostgREST filters in a query string: col=eq.x, col=in.(a,b), col=is.null. */
function matcher(search: string) {
  const tests: ((r: Record<string, unknown>) => boolean)[] = []
  for (const [col, v] of new URLSearchParams(search)) {
    if (['select', 'on_conflict', 'columns', 'order', 'limit'].includes(col)) continue
    const m = v.match(/^(eq|in|is)\.(.*)$/)
    if (!m) continue
    const [, op, arg] = m
    if (op === 'eq') tests.push((r) => String(r[col]) === arg)
    if (op === 'is') tests.push((r) => (arg === 'null' ? r[col] == null : String(r[col]) === arg))
    if (op === 'in') {
      const set = new Set(arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')))
      tests.push((r) => set.has(String(r[col])))
    }
  }
  return (r: Record<string, unknown>) => tests.length > 0 && tests.every((f) => f(r))
}

/** The rows of a table as they will be once the waiting changes are sent. */
export function withPending<T>(table: string, rows: T[]): T[] {
  const mine = memory.filter((p) => p.table === table)
  if (!mine.length) return rows
  let out = rows as Record<string, unknown>[]
  for (const p of mine) {
    const q = p.path.includes('?') ? p.path.slice(p.path.indexOf('?')) : ''
    if (p.method === 'DELETE') {
      const hit = matcher(q)
      out = out.filter((r) => !hit(r))
      continue
    }
    const body = p.body ? JSON.parse(p.body) : null
    if (p.method === 'PATCH') {
      const hit = matcher(q)
      out = out.map((r) => (hit(r) ? { ...r, ...body } : r))
      continue
    }
    const keys = new URLSearchParams(q).get('on_conflict')?.split(',') ?? ROW_KEY[table] ?? ['id']
    const upsert = p.prefer?.includes('resolution=merge-duplicates')
    for (const row of Array.isArray(body) ? body : [body]) {
      const at = out.findIndex((r) => keys.every((k) => row[k] !== undefined && String(r[k]) === String(row[k])))
      if (at >= 0 && upsert) out = out.map((r, i) => (i === at ? { ...r, ...row } : r))
      else if (at < 0) out = [...out, { created_at: new Date(p.at).toISOString(), ...row }]
    }
  }
  return out as T[]
}
