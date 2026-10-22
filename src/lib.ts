import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/** Rows of one trip-scoped table, kept in sync with every member's edits via realtime. */
export function useTripTable<T>(table: string, tripId: string, order: string = 'created_at') {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('trip_id', tripId)
      .order(order)
    if (!error) setRows(data as T[])
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
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, tripId, reload])

  return { rows, loading, reload }
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

/** Today's trip day (1-based), or null when not currently on the trip. */
export function currentDay(start: string | null, numDays: number): number | null {
  if (!start) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000)
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
