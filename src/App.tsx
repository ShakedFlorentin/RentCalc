import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Member, Trip } from './types'
import { currentDay } from './lib'
import Login from './views/Login'
import TripPicker from './views/TripPicker'
import Home from './views/Home'
import Itinerary from './views/Itinerary'
import Bookings from './views/Bookings'
import Places from './views/Places'
import Lists from './views/Lists'
import SwipeGame from './views/Swipe'

const TABS = [
  { id: 'home', label: 'בית', d: 'M3 11.5 12 4l9 7.5M5.5 10v10h4.5v-6h4v6h4.5V10' },
  { id: 'swipe', label: 'משחק', d: 'M12 21c-4 0-7-2.8-7-6.6 0-2.6 1.5-4.4 3-6 .500 1.5 1.3 2.2 2.2 2.5C10 8 11 5.5 13 3c.5 3 4 5.5 4 9.5 0 .800-.100 1.5-.300 2 1.2-.600 1.8-1.5 2-2.5 .600 5.8-2.7 9-7.7 9Z' },
  { id: 'plan', label: 'מסלול', d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4' },
  { id: 'bookings', label: 'הזמנות', d: 'M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2 2 0 0 0 0 3.8V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.2a2 2 0 0 0 0-3.8ZM14 7v10' },
  { id: 'places', label: 'מקומות', d: 'M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { id: 'lists', label: 'רשימות', d: 'M9 6h11M9 12h11M9 18h11M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center" role="status">טוען…</div>
  if (!session) return <Login />
  return <TripGate userId={session.user.id} />
}

function TripGate({ userId }: { userId: string }) {
  const [tripId, setTripId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    supabase
      .from('members')
      .select('trip_id')
      .eq('user_id', userId)
      .then(({ data }) => {
        const ids = (data ?? []).map((m) => m.trip_id as string)
        const saved = localStorage.getItem('tripId')
        setTripId(saved && ids.includes(saved) ? saved : (ids[0] ?? null))
      })
  }, [userId])

  const choose = (id: string | null) => {
    if (id) localStorage.setItem('tripId', id)
    else localStorage.removeItem('tripId')
    setTripId(id)
  }

  if (tripId === undefined) return <div className="center" role="status">טוען…</div>
  if (!tripId) return <TripPicker onPick={choose} />
  return <TripApp tripId={tripId} userId={userId} onLeave={() => choose(null)} />
}

function TripApp(props: { tripId: string; userId: string; onLeave: () => void }) {
  const { tripId } = props
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [tab, setTab] = useState<Tab>('home')
  const [day, setDay] = useState(1)

  useEffect(() => {
    const load = async () => {
      const [t, m] = await Promise.all([
        supabase.from('trips').select('*').eq('id', tripId).single(),
        supabase.from('members').select('*').eq('trip_id', tripId).order('joined_at'),
      ])
      if (t.data) setTrip(t.data as Trip)
      if (m.data) setMembers(m.data as Member[])
    }
    load()
    const channel = supabase
      .channel(`trip:${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `trip_id=eq.${tripId}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])

  useEffect(() => {
    if (trip) setDay(currentDay(trip.start_date, trip.num_days) ?? 1)
  }, [trip?.start_date, trip?.num_days])

  if (!trip) return <div className="center" role="status">טוען…</div>
  const me = members.find((m) => m.user_id === props.userId)?.display_name ?? ''
  const openDay = (d: number) => {
    setDay(d)
    setTab('plan')
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="dot" aria-hidden="true" />
        <div className="topbar-text">
          <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
          <span className="small muted" dir="auto">
            {trip.name}
          </span>
        </div>
      </header>
      <main className={'tab-' + tab}>
        {tab === 'home' && (
          <Home trip={trip} members={members} me={me} userId={props.userId} onOpenDay={openDay} onLeave={props.onLeave} />
        )}
        {tab === 'swipe' && <SwipeGame trip={trip} userId={props.userId} members={members} />}
        {tab === 'plan' && <Itinerary trip={trip} day={day} setDay={setDay} />}
        {tab === 'bookings' && <Bookings trip={trip} />}
        {tab === 'places' && <Places trip={trip} me={me} />}
        {tab === 'lists' && <Lists tripId={tripId} members={members} />}
      </main>
      <nav className="tabbar" aria-label="ניווט ראשי">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d={t.d} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
