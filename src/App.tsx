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

const TABS = [
  { id: 'home', label: 'בית', icon: '🏠' },
  { id: 'plan', label: 'מסלול', icon: '🗓️' },
  { id: 'bookings', label: 'הזמנות', icon: '🎫' },
  { id: 'places', label: 'מקומות', icon: '📍' },
  { id: 'lists', label: 'רשימות', icon: '✅' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center">טוען…</div>
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

  if (tripId === undefined) return <div className="center">טוען…</div>
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

  if (!trip) return <div className="center">טוען…</div>
  const me = members.find((m) => m.user_id === props.userId)?.display_name ?? ''
  const openDay = (d: number) => {
    setDay(d)
    setTab('plan')
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="dot" />
        <h1>{trip.name}</h1>
      </header>
      <main>
        {tab === 'home' && (
          <Home trip={trip} members={members} me={me} userId={props.userId} onOpenDay={openDay} onLeave={props.onLeave} />
        )}
        {tab === 'plan' && <Itinerary trip={trip} day={day} setDay={setDay} />}
        {tab === 'bookings' && <Bookings tripId={tripId} />}
        {tab === 'places' && <Places trip={trip} me={me} />}
        {tab === 'lists' && <Lists tripId={tripId} members={members} />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
