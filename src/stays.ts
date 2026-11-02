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
