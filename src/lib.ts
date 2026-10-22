import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Member } from './types'

/** Rows of one trip-scoped table, kept in sync with every member's edits via realtime. */
export function useTripTable<T>(table: string, tripId: string, order: string = 'created_at') {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    if (error) setError(error.message)
    else {
      setRows(data as T[])
      setError('')
    }
    setLoading(false)
  }, [table, tripId, order])

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

  return { rows, loading, error, reload }
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
