import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Member } from './types'

const CACHE_PREFIX = 'cache:'

/** The last good copy of some data, kept on the phone so the app opens with no network. */
export function readCache<T>(key: string): { data: T; at: number } | null {
  try {
    const s = localStorage.getItem(CACHE_PREFIX + key)
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

export function writeCache(key: string, data: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, at: Date.now() }))
  } catch {
    // storage full or blocked: the app just won't have this copy offline
  }
}

/** Forget every saved copy (on sign-out, so the next person on this phone doesn't see the old data). */
export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    // nothing to clear
  }
}

/**
 * Rows of one trip-scoped table, kept in sync with every member's edits via realtime. The last good rows are
 * saved on the phone and shown at once; `stale` means what's on screen hasn't been confirmed by the server yet.
 */
export function useTripTable<T>(table: string, tripId: string, order: string = 'created_at') {
  const key = `${table}:${tripId}:${order}`
  const [cached] = useState(() => readCache<T[]>(key))
  const [rows, setRows] = useState<T[]>(cached?.data ?? [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(!!cached)
  const [updatedAt, setUpdatedAt] = useState<number | null>(cached?.at ?? null)
  const haveRows = useRef(!!cached)
  // reloads can overlap when several changes arrive together; only the latest one may write
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const req = ++latest.current
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('trip_id', tripId)
      .order(order)
    if (req !== latest.current) return
    if (error) {
      // offline with a saved copy is expected, and the offline banner says so: don't nag on every screen
      if (!(haveRows.current && navigator.onLine === false)) setError(error.message)
      setStale(true)
    } else {
      setRows(data as T[])
      setError('')
      setStale(false)
      setUpdatedAt(Date.now())
      haveRows.current = true
      writeCache(key, data)
    }
    setLoading(false)
  }, [table, tripId, order, key])

  useEffect(() => {
    reload()
    const channel = supabase
      .channel(`${table}:${tripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` },
        () => reload(),
      )
      // realtime can't filter deletes by column, so listen to every delete on the table
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, () => reload())
      .subscribe()
    // catch up after the phone wakes or comes back online, when realtime events may have been missed
    const refresh = () => document.visibilityState === 'visible' && reload()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [table, tripId, reload])

  return { rows, loading, error, reload, stale, updatedAt }
}

export async function mutate(promise: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await promise
  if (error) alert('שגיאה: ' + error.message)
  return !error
}

export function mapsUrl(query: string) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query)
}

export function dayDate(start: string | null, day: number): Date | null {
  if (!start) return null
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + day - 1)
  return d
}

export function fmtDay(d: Date | null) {
  return d ? d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }) : ''
}

/** Today's trip day (1-based) by the date in Japan, or null when not currently on the trip. */
export function currentDay(start: string | null, numDays: number): number | null {
  if (!start) return null
  // the trip runs on Japan's calendar, whatever timezone the phone is still set to
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  const diff = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000)
  return diff >= 0 && diff < numDays ? diff + 1 : null
}

// Booking times are stored as wall-clock time at the booking's location (saved as if UTC),
// so a 10:00 Tokyo check-in shows 10:00 whatever timezone the phone is in.
export function toInputDateTime(iso: string | null) {
  return iso ? iso.slice(0, 16) : ''
}
export function fromInputDateTime(v: string) {
  return v ? v + ':00Z' : null
}
export function fmtDateTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('he-IL', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type MediaEntry = {
  maps_url?: string
  website_url?: string
  photos?: string[]
  instagram_url?: string
  tiktok_url?: string
  lat?: number
  lng?: number
  // Hebrew card texts
  hype?: string
  reality?: string
  tip?: string
  baby_notes?: string
  price?: string
  // what a restaurant, cafe or bar serves
  serves?: string
  dishes?: string[]
  // what you do at an attraction and what sets it apart
  todo?: string
  special?: string
  highlights?: string[]
  time_needed?: string
  // how easy it is to eat there without pork or seafood
  kosher?: 'friendly' | 'options' | 'hard'
  kosher_note?: string
}
let mediaCache: Promise<Record<string, MediaEntry>> | null = null

/** Links/photos collected per place name (public/media.json), shipped with the app. */
export function useMediaIndex() {
  const [index, setIndex] = useState<Record<string, MediaEntry>>({})
  useEffect(() => {
    mediaCache ??= fetch('./media.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
    mediaCache.then(setIndex)
  }, [])
  return index
}

/** Fill a row's missing media fields from the index; values already in the database win. */
export function withMedia<T extends { name: string }>(row: T, index: Record<string, MediaEntry>): T {
  const m = index[row.name]
  if (!m) return row
  const r = row as Record<string, unknown>
  const pick = (k: keyof MediaEntry) => (r[k] == null || (Array.isArray(r[k]) && !(r[k] as unknown[]).length) ? m[k] : r[k])
  return {
    ...row,
    maps_url: pick('maps_url'),
    website_url: pick('website_url'),
    photos: pick('photos') ?? [],
    instagram_url: pick('instagram_url'),
    tiktok_url: pick('tiktok_url'),
    // collected coordinates come straight from Google Maps, so they beat the scouts' estimates
    lat: m.lat ?? r.lat,
    lng: m.lng ?? r.lng,
    ...('url' in r ? { url: r.url ?? m.maps_url ?? null } : {}),
    // the Hebrew translation replaces the scouts' English card text
    ...('hype' in r
      ? {
          hype: m.hype ?? r.hype,
          reality: m.reality ?? r.reality,
          tip: m.tip ?? r.tip,
          baby_notes: m.baby_notes ?? r.baby_notes,
          price: m.price ?? r.price,
          serves: m.serves ?? r.serves,
          dishes: m.dishes ?? r.dishes,
          todo: m.todo ?? r.todo,
          special: m.special ?? r.special,
          highlights: m.highlights ?? r.highlights,
          time_needed: m.time_needed ?? r.time_needed,
          kosher: m.kosher ?? r.kosher,
          kosher_note: m.kosher_note ?? r.kosher_note,
        }
      : {}),
  }
}

/** The couples in the trip, in a stable order. */
export function couplesOf(members: Member[]) {
  return [...new Set(members.map((m) => m.couple).filter((c): c is string => !!c))].sort()
}

/**
 * Who a place is matched for, mirroring the on_swipe trigger: both members of a couple liking it puts it on that
 * couple's list, and every couple agreeing makes it the whole group's (who = null). Undefined means no match yet.
 */
export function matchFor(likers: string[], members: Member[], threshold: number): { who: string | null } | undefined {
  const couples = couplesOf(members)
  if (!couples.length) return likers.length >= threshold ? { who: null } : undefined
  const agreed = couples.filter((c) => members.filter((m) => m.couple === c).every((m) => likers.includes(m.user_id)))
  if (!agreed.length) return undefined
  return { who: agreed.length === couples.length ? null : agreed.join(' + ') }
}

/** Hebrew text for a failed Claude edge-function call, or `fallback` when there is nothing more specific. */
export function aiError(error: unknown, fallback: string) {
  const status = (error as { context?: { status?: number } } | null)?.context?.status
  if (status === 429) return 'הגעתם למגבלה היומית (30 בדיקות ביום לכל אחד). אפשר להוסיף ידנית או לנסות מחר.'
  if (status === 413) return 'הטקסט או הקובץ ארוכים מדי.'
  return fallback
}

/** A name for comparing: no case, spaces or punctuation (matches norm_name() in the database). */
export function normName(s: string | null | undefined) {
  return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Metres between two points, near enough for "is this the same place". */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const k = Math.PI / 180
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k)
  const y = (b.lat - a.lat) * k
  return Math.sqrt(x * x + y * y) * 6371000
}

/**
 * Whether two places look like the same one: the same name, one name inside the other ("Fuunji" and
 * "Fuunji Shinjuku"), or pins within 60 m of each other.
 */
export function samePlace(
  a: { name: string; lat?: number | null; lng?: number | null },
  b: { name: string; lat?: number | null; lng?: number | null },
) {
  const x = normName(a.name)
  const y = normName(b.name)
  if (x && x === y) return 'exact'
  if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) return 'similar'
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    if (metresBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) < 60) return 'similar'
  }
  return null
}
