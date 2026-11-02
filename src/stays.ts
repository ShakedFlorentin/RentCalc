import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { readCache, useTripTable, writeCache } from './lib'
import type { City, TripStay } from './types'

/**
 * Where each party sleeps (table trip_stays) and the cities to pick from. Until the table exists in the database
 * (its SQL not applied yet) `available` is false and the lists are empty: the app then reads hotel bookings alone.
 */
export function useStays(tripId: string) {
  const { rows: stays, error } = useTripTable<TripStay>('trip_stays', tripId, 'check_in')
  const [cities, setCities] = useState<City[]>(() => readCache<City[]>('cities')?.data ?? [])
  useEffect(() => {
    supabase
      .from('cities')
      .select('*')
      .order('name_en')
      .then(({ data, error: e }) => {
        if (e || !data) return
        setCities(data as City[])
        writeCache('cities', data)
      })
  }, [])
  return { stays, cities, available: !error }
}

/** One suggested split of the open nights (answer of plan-trip with suggest_stays; see plan-trip/split.ts). */
export type SplitAlt = {
  rows: { city: string; nights: number; party: string | null; checkIn: string; checkOut: string }[]
  reason: {
    kind: 'fewer_moves' | 'more_places' | 'balanced'
    moves: number
    coveredPlaces: number
    totalPlaces: number
    dayTrips: { city: string; from: string; places: number }[]
  }
}

/** Asks the planner for 2-3 ways to split the open nights between cities. Writes nothing. Null when it can't answer. */
export async function suggestSplits(tripId: string): Promise<SplitAlt[] | null> {
  const { data, error } = await supabase.functions.invoke('plan-trip', { body: { trip_id: tripId, suggest_stays: true } })
  if (error || !data || !Array.isArray((data as { alternatives?: unknown }).alternatives)) return null
  return (data as { alternatives: SplitAlt[] }).alternatives
}
