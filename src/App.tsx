import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { t } from './i18n'
import type { Member, Trip } from './types'
import { clearCache, currentDay, readCache, writeCache } from './lib'
import { OfflineBanner } from './offline'
import Login from './views/Login'
import TripPicker from './views/TripPicker'
import Home from './views/Home'
import Itinerary from './views/Itinerary'
import Bookings from './views/Bookings'
import Places from './views/Places'
import More, { MORE_TABS, type MoreTab } from './views/More'
import { useRemembered } from './ui'
import SwipeGame from './views/Swipe'
import Search, { type SearchTarget } from './views/Search'

const TABS = [
  { id: 'home', label: t('בית'), d: 'M3 11.5 12 4l9 7.5M5.5 10v10h4.5v-6h4v6h4.5V10' },
  { id: 'swipe', label: t('גילוי'), d: 'M12 21c-4 0-7-2.8-7-6.6 0-2.6 1.5-4.4 3-6 .500 1.5 1.3 2.2 2.2 2.5C10 8 11 5.5 13 3c.5 3 4 5.5 4 9.5 0 .800-.100 1.5-.300 2 1.2-.600 1.8-1.5 2-2.5 .600 5.8-2.7 9-7.7 9Z' },
  { id: 'plan', label: t('מסלול'), d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4' },
  { id: 'bookings', label: t('הזמנות'), d: 'M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2 2 0 0 0 0 3.8V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.2a2 2 0 0 0 0-3.8ZM14 7v10' },
  { id: 'places', label: t('מקומות'), d: 'M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { id: 'more', label: t('עוד'), d: 'M4 6h16M4 12h16M4 18h16' },
] as const
type Tab = (typeof TABS)[number]['id']

// who was signed in, so the app still opens when an expired login can't be refreshed without a network
const UID_KEY = 'userId'

export default function App() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      const id = data.session?.user.id ?? null
      if (id) writeCache(UID_KEY, id)
      // a refresh that failed for lack of network is not a sign-out: carry on as the same user
      const offlineId = !id && error?.name === 'AuthRetryableFetchError' ? readCache<string>(UID_KEY)?.data : null
      setUserId(id ?? offlineId ?? null)
    })
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      // the first event repeats getSession above, which also knows about the offline case
      if (e === 'INITIAL_SESSION') return
      if (e === 'SIGNED_OUT') {
        clearCache()
        window.caches?.delete('docs').catch(() => {})
        try {
          localStorage.removeItem('tripId')
        } catch {
          // nothing remembered to forget
        }
      }
      if (s) writeCache(UID_KEY, s.user.id)
      setUserId(s?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (userId === undefined) return <div className="center" role="status">{t('טוען…')}</div>
  if (!userId) return <Login />
  return <TripGate userId={userId} />
}

function savedTrip() {
  try {
    return localStorage.getItem('tripId')
  } catch {
    return null
  }
}

function TripGate({ userId }: { userId: string }) {
  // open on the last trip at once (no waiting for a network that may not be there); the check below corrects it
  const [tripId, setTripId] = useState<string | null | undefined>(() => savedTrip() ?? undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const choose = (id: string | null) => {
    try {
      // '' remembers that the trip was left on purpose, so the next launch opens the trip list instead of it
      localStorage.setItem('tripId', id ?? '')
    } catch {
      // the choice just won't be remembered
    }
    setTripId(id)
  }

  useEffect(() => {
    setFailed(false)
    supabase
      .from('members')
      .select('trip_id')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        const saved = savedTrip()
        if (saved === '') return setTripId(null)
        // offline or a server hiccup is not "you have no trip": keep the last trip, or offer a retry
        if (error) {
          if (saved) setTripId(saved)
          else setFailed(true)
          return
        }
        const ids = (data ?? []).map((m) => m.trip_id as string)
        choose(saved && ids.includes(saved) ? saved : (ids[0] ?? null))
      })
  }, [userId, attempt])

  if (failed) return <LoadError onRetry={() => setAttempt((a) => a + 1)} />
  if (tripId === undefined) return <div className="center" role="status">{t('טוען…')}</div>
  if (!tripId) return <TripPicker onPick={choose} />
  return <TripApp tripId={tripId} userId={userId} onLeave={() => choose(null)} />
}

function TripApp(props: { tripId: string; userId: string; onLeave: () => void }) {
  const { tripId } = props
  // the last good copy opens the app with no network
  const [tripCache] = useState(() => readCache<Trip>('trip:' + tripId))
  const [trip, setTrip] = useState<Trip | null>(tripCache?.data ?? null)
  const [members, setMembers] = useState<Member[]>(() => readCache<Member[]>('members:' + tripId)?.data ?? [])
  const [tab, setTab] = useState<Tab>('home')
  // the avatar asks Home to open trip settings; Home clears the request once it has opened them
  const [settingsAsk, setSettingsAsk] = useState(false)
  // the screen the avatar was tapped on, for a problem report sent from the settings
  const [settingsFrom, setSettingsFrom] = useState(t('בית'))
  const [searching, setSearching] = useState(false)
  // search asked Discover to open its turned-down places on a card
  const [showVetoed, setShowVetoed] = useState<{ id: string; n: number } | null>(null)
  const [day, setDay] = useState(1)
  const [moreSub, setMoreSub] = useRemembered('moreTab', 'money') as [MoreTab, (s: MoreTab) => void]
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // when the trip and members shown were last confirmed by the server; the banner shows while they're a saved copy
  const [syncedAt, setSyncedAt] = useState<number | null>(tripCache?.at ?? null)
  const [stale, setStale] = useState(!!tripCache)

  useEffect(() => {
    const load = async () => {
      const [t, m] = await Promise.all([
        supabase.from('trips').select('*').eq('id', tripId).single(),
        supabase.from('members').select('*').eq('trip_id', tripId).order('joined_at'),
      ])
      if (t.data) {
        setTrip(t.data as Trip)
        writeCache('trip:' + tripId, t.data)
      }
      if (m.data) {
        setMembers(m.data as Member[])
        writeCache('members:' + tripId, m.data)
      }
      setFailed(!!t.error)
      setStale(!!t.error || !!m.error)
      if (!t.error && !m.error) setSyncedAt(Date.now())
    }
    load()
    // catch up after the phone wakes or comes back online, when realtime events may have been missed
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    const channel = supabase
      .channel(`trip:${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `trip_id=eq.${tripId}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [tripId, attempt])

  useEffect(() => {
    if (trip) setDay(currentDay(trip.start_date, trip.num_days) ?? 1)
  }, [trip?.start_date, trip?.num_days])

  if (!trip) return failed ? <LoadError onRetry={() => setAttempt((a) => a + 1)} /> : <div className="center" role="status">{t('טוען…')}</div>
  const me = members.find((m) => m.user_id === props.userId)?.display_name ?? ''
  const openDay = (d: number) => {
    setDay(d)
    setTab('plan')
  }
  const openMore = (s: MoreTab) => {
    setMoreSub(s)
    setTab('more')
  }
  const openResult = (to: SearchTarget) => {
    setSearching(false)
    if (to.tab === 'plan') openDay(to.day)
    else if (to.tab === 'lists') openMore('lists')
    else setTab(to.tab)
    if (to.tab === 'swipe' && to.vetoed) setShowVetoed((v) => ({ id: to.vetoed!, n: (v?.n ?? 0) + 1 }))
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
        <button
          className="avatar"
          aria-label={t('הגדרות טיול, {me}', { me })}
          onClick={() => {
            const here = TABS.find((t) => t.id === tab)?.label ?? tab
            setSettingsFrom(tab === 'more' ? `${here} › ${MORE_TABS.find((t) => t.id === moreSub)?.label ?? moreSub}` : here)
            setTab('home')
            setSettingsAsk(true)
          }}
        >
          {initials(me)}
        </button>
      </header>
      <OfflineBanner since={stale ? syncedAt : null} />
      <main className={'tab-' + tab}>
        {tab === 'home' && (
          <Home
            trip={trip}
            members={members}
            me={me}
            userId={props.userId}
            onOpenDay={openDay}
            onOpenMore={openMore}
            onOpenPlaces={() => setTab('places')}
            onLeave={props.onLeave}
            settingsAsk={settingsAsk}
            onSettingsShown={() => setSettingsAsk(false)}
            settingsFrom={settingsFrom}
          />
        )}
        {tab === 'swipe' && <SwipeGame trip={trip} userId={props.userId} members={members} showVetoed={showVetoed} />}
        {tab === 'plan' && <Itinerary trip={trip} day={day} setDay={setDay} members={members} userId={props.userId} />}
        {tab === 'bookings' && <Bookings trip={trip} members={members} userId={props.userId} />}
        {tab === 'places' && <Places trip={trip} me={me} userId={props.userId} members={members} />}
        {tab === 'more' && <More trip={trip} members={members} userId={props.userId} sub={moreSub} setSub={setMoreSub} />}
      </main>
      <nav className="tabbar glass" aria-label={t('ניווט ראשי')}>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d={t.d} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {/* Music keeps search as its own glass button beside the tab bar */}
      <button className="search-fab glass" aria-label={t('חיפוש')} onClick={() => setSearching(true)}>
        <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM21 21l-5.2-5.2" />
        </svg>
      </button>
      {searching && <Search tripId={trip.id} start={trip.start_date} members={members} onClose={() => setSearching(false)} onPick={openResult} />}
    </div>
  )
}

/** Up to two initials, like the Music avatar: first letter of the first and last word */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0]?.[0] ?? '')
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="center stack" role="alert">
      <p>{t('אין חיבור לשרת. בדקו את האינטרנט.')}</p>
      <button className="primary" onClick={onRetry}>
        {t('נסו שוב')}
      </button>
    </div>
  )
}
