import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
  // Supabase hands back the existing channel for a name already in use, so two screens watching one table (search
  // over the places list) would share it: adding listeners after subscribe() throws, and the first to close would
  // stop the other's updates. Each screen gets its own channel.
  const instance = useId()

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
      .channel(`${table}:${tripId}:${instance}`)
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
  }, [table, tripId, reload, instance])

  return { rows, loading, error, reload, stale, updatedAt }
}

/**
 * Hebrew text often holds number ranges ("¥500–1,000", "10:00–13:00"). The dash between the numbers is a neutral
 * character, so right-to-left text shows the range reversed ("1,000–¥500"). Isolating each range as left-to-right
 * keeps its order. For display only: the isolate marks must not end up in saved text.
 */
export const keepRanges = (s: string) =>
  s.replace(/[¥$€₪]?\d[\d.,:]*\s?[–—-]\s?[¥$€₪]?\d[\d.,:]*/g, (m) => '\u2066' + m + '\u2069')

/** A save failed: say so in plain Hebrew, and say it's the connection when there's no network. */
export function errorText(message: string) {
  return !navigator.onLine || /failed to fetch|network|load failed/i.test(message)
    ? 'אין חיבור לאינטרנט, לא נשמר. נסו שוב כשיש קליטה.'
    : 'שגיאה: ' + message
}

export async function mutate(promise: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await promise
  if (error) alert(errorText(error.message))
  return !error
}

/** Only real web links become clickable: a stored "javascript:" link would run inside the app. */
export function safeUrl(u: string | null | undefined) {
  const v = u?.trim()
  return v && /^https?:\/\//i.test(v) ? v : undefined
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

/** "יום שלישי, 15.12": how a plan day is named; the trip's day number matters to nobody. */
export function fmtDayLong(d: Date | null) {
  return d ? d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' }) : ''
}

/** A day as a picker option names it: "יום שלישי, 15.12", or "יום 3" for a trip without a start date. */
export function dayOption(start: string | null, day: number) {
  return start ? fmtDayLong(dayDate(start, day)) : `יום ${day}`
}

/** A day chip's two lines: the weekday ("ג׳") and the date ("15.12"). */
export function dayParts(d: Date | null) {
  if (!d) return null
  return {
    weekday: d.toLocaleDateString('he-IL', { weekday: 'narrow' }),
    date: d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
  }
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
  // a booking with a date but no time is stored at midnight; show just the date
  const dateOnly = iso.slice(11, 16) === '00:00'
  return new Date(iso).toLocaleString('he-IL', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit' }),
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

/**
 * Asks the trip planner (edge function plan-trip) to plan the trip again now. It also runs by itself after every swipe,
 * match and booking; this covers what the database can't announce, like a deleted booking.
 */
export function replan(tripId: string) {
  return supabase.functions.invoke('plan-trip', { body: { trip_id: tripId } }).catch(() => null)
}

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

/** Hebrew text for a failed Claude edge-function call, or `fallback` when there is nothing more specific. */
export async function aiError(error: unknown, fallback: string) {
  const res = (error as { context?: Response } | null)?.context
  const status = res?.status
  if (status === 429) {
    // the same status means either today's cap or Claude being busy for a minute
    const body = await res?.clone().json().catch(() => null)
    return /daily limit/.test(body?.error ?? '')
      ? 'הגעתם למגבלה היומית (30 בדיקות ביום לכל אחד). נסו שוב מחר.'
      : 'השירות עמוס כרגע. נסו שוב בעוד דקה.'
  }
  if (status === 413) return 'הטקסט או הקובץ ארוכים מדי.'
  if (!navigator.onLine) return 'אין חיבור לאינטרנט.'
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

const FILLER = new Set(['the', 'and', 'main', 'store', 'shop', 'honten', 'branch', 'sohonten'])
const GENERIC = new Set([
  'aquarium', 'museum', 'temple', 'shrine', 'park', 'market', 'tower', 'station', 'cafe', 'coffee', 'ramen', 'sushi',
  'garden', 'street', 'shopping', 'tempura', 'onsen', 'castle', 'hotel', 'tokyo', 'kyoto', 'osaka', 'nara', 'japan',
  'yokocho', 'depachika', 'food', 'restaurant', 'izakaya', 'kitchen',
])
const nameWords = (s: string) =>
  [...new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !FILLER.has(w)))]

/**
 * Whether two places look like the same one: the same name, every word of one name in the other in any order
 * ("Kaiyukan Aquarium" and "Osaka Aquarium Kaiyukan", "Fuunji" and "Fuunji Shinjuku") as long as the shorter name has
 * a distinctive word of its own (so "Kyoto Aquarium" and "Sumida Aquarium" stay two), or pins within 60 m of each
 * other. Mirrors same_place_name() in the database.
 */
export function samePlace(
  a: { name: string; lat?: number | null; lng?: number | null },
  b: { name: string; lat?: number | null; lng?: number | null },
) {
  const x = normName(a.name)
  const y = normName(b.name)
  if (x && x === y) return 'exact'
  if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) return 'similar'
  const [wa, wb] = [nameWords(a.name), nameWords(b.name)]
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (short.length && short.every((w) => long.includes(w)) && short.some((w) => w.length >= 4 && !GENERIC.has(w))) return 'similar'
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    if (metresBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) < 60) return 'similar'
  }
  return null
}
