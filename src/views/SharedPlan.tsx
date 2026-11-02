import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { CITY_HE } from '../types'
import { errorText } from '../lib'
import { t } from '../i18n'
import { Field } from '../ui'
import { PlanList, type SharedSnapshot } from './Share'

// The public, read-only page behind ?share=<slug>. It runs before the login gate and talks to the database only
// through get_shared_plan, which hands back the published snapshot (or nothing once sharing was stopped).

const PENDING = 'pendingShare'
export const SLUG = /^[a-z0-9]{10}$/

export const slugInUrl = () => {
  const s = new URLSearchParams(location.search).get('share')?.trim().toLowerCase() ?? ''
  return SLUG.test(s) ? s : null
}

export function pendingShare() {
  try {
    const s = localStorage.getItem(PENDING)
    return s && SLUG.test(s) ? s : null
  } catch {
    return null
  }
}

export function forgetPendingShare() {
  try {
    localStorage.removeItem(PENDING)
  } catch {
    // nothing kept
  }
}

/** Back to the app itself, without the share link in the address bar. */
const toApp = () => location.replace(location.origin + location.pathname)

/** What came from the database, cut down to the shape we draw. Anything unexpected is left out. */
function clean(raw: unknown): SharedSnapshot | null {
  const r = raw as Partial<SharedSnapshot> | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.days)) return null
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const days = r.days.slice(0, 60).flatMap((d) => {
    const stops = (Array.isArray(d?.stops) ? d.stops : []).slice(0, 40).flatMap((s) => {
      const name = str(s?.name, 120)
      if (!name) return []
      const lat = num(s.lat)
      const lng = num(s.lng)
      return [{ name, category: str(s.category, 20) ?? 'sight', tip: str(s.tip, 240), tip_en: str(s.tip_en, 240), ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}) }]
    })
    return stops.length ? [{ day: num(d.day) ?? 0, city: str(d.city, 40) ?? null, stops }] : []
  })
  return { v: 1, name: str(r.name, 120), num_days: num(r.num_days) ?? days.length, days }
}

async function load(slug: string) {
  const { data, error } = await supabase.rpc('get_shared_plan', { slug })
  return { snap: error ? null : clean(data), failed: !!error }
}

export default function SharedPlan({ slug }: { slug: string }) {
  const [state, setState] = useState<{ snap: SharedSnapshot | null; failed: boolean } | undefined>()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    load(slug).then(setState)
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null))
  }, [slug])

  const plan = () => {
    if (userId) return setImporting(true)
    // not signed in: remember the plan, sign in, and the app offers to copy it into a new trip
    try {
      localStorage.setItem(PENDING, slug)
    } catch {
      // the plan won't be remembered through sign-in
    }
    toApp()
  }

  if (!state) return <div className="center" role="status">{t('טוען…')}</div>
  if (!state.snap)
    return (
      <div className="center stack" role="alert">
        <p>{state.failed ? t('אין חיבור לשרת. בדקו את האינטרנט.') : t('הקישור הזה כבר לא משותף.')}</p>
        <button className="secondary" onClick={toApp}>{t('לאפליקציה')}</button>
      </div>
    )
  if (importing && userId) return <ImportShared slug={slug} userId={userId} snap={state.snap} onDone={toApp} onSkip={() => setImporting(false)} />

  const snap = state.snap
  return (
    <div className="app shared-plan">
      <header className="topbar">
        <h1 dir="auto">{snap.name || t('מסלול משותף')}</h1>
      </header>
      <main>
        <div className="stack">
          <p className="muted">{t('מסלול משותף, לקריאה בלבד.')}</p>
          <PlanList snap={snap} />
          <button className="primary" onClick={plan}>{t('לתכנן טיול כזה')}</button>
          <button className="link" onClick={toApp}>{t('לאפליקציה')}</button>
        </div>
      </main>
    </div>
  )
}

const cityKey = (heb: string | null) => Object.entries(CITY_HE).find(([, he]) => heb?.includes(he))?.[0] ?? 'daytrip'

/**
 * Offered after signing in with a shared plan waiting: makes a new trip and copies the places as cards to swipe
 * (candidates), with the shared tip. The trip's days, dates and hotels stay the new group's own to plan.
 */
export function ImportShared(props: { slug: string; userId: string; snap?: SharedSnapshot; onDone: (tripId: string) => void; onSkip: () => void }) {
  const [snap, setSnap] = useState<SharedSnapshot | null | undefined>(props.snap)
  const [tripName, setTripName] = useState(props.snap?.name ?? t('טיול חדש'))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!snap) load(props.slug).then((r) => setSnap(r.snap))
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      const given = ((u?.user_metadata?.name as string | undefined) ?? '').trim() || (u?.email ?? '').split('@')[0]
      setName((n) => n || given)
    })
  }, [])

  useEffect(() => {
    if (snap?.name) setTripName((n) => (n === t('טיול חדש') ? snap.name! : n))
  }, [snap?.name])

  if (snap === undefined) return <div className="center" role="status">{t('טוען…')}</div>
  if (!snap)
    return (
      <div className="center stack" role="alert">
        <p>{t('הקישור הזה כבר לא משותף.')}</p>
        <button className="secondary" onClick={props.onSkip}>{t('לא עכשיו')}</button>
      </div>
    )
  const stops = snap.days.flatMap((d) => d.stops.map((s) => ({ ...s, city: d.city })))

  const go = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const made = await supabase.rpc('create_trip', { trip_name: tripName.trim() || t('טיול חדש'), name: name.trim(), start: null })
    if (made.error || !made.data) {
      setBusy(false)
      return setErr(errorText(made.error?.message ?? ''))
    }
    const tripId = made.data as string
    const seen = new Set<string>()
    const rows = stops
      .filter((s) => {
        const k = s.name.toLowerCase() + '|' + cityKey(s.city)
        return !seen.has(k) && !!seen.add(k)
      })
      .map((s) => ({
        trip_id: tripId,
        name: s.name,
        city: cityKey(s.city),
        category: s.category,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        tip: s.tip ?? null,
        added_by: name.trim(),
      }))
    const { error } = rows.length ? await supabase.from('candidates').insert(rows) : { error: null }
    setBusy(false)
    // the trip exists either way; the places can be added again by hand if the copy failed
    if (error) alert(errorText(error.message))
    try {
      localStorage.setItem('tripId', tripId)
    } catch {
      // the app opens on the trip list instead
    }
    forgetPendingShare()
    props.onDone(tripId)
  }

  return (
    <form className="login" onSubmit={go}>
      <h1>{t('לתכנן טיול כזה')}</h1>
      <div className="card stack">
        <p>{t('ניצור טיול חדש ונעתיק אליו {n} מקומות מהמסלול כרשימה להצבעה. התאריכים והלינות נשארים לכם.', { n: stops.length })}</p>
        <Field label={t('שם הטיול')}>
          <input value={tripName} onChange={(e) => setTripName(e.target.value)} required />
        </Field>
        <Field label={t('איך קוראים לך?')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <button className="primary" disabled={busy || !name.trim() || !stops.length}>
          {busy ? t('יוצרים…') : t('יצירת טיול והעתקת המקומות')}
        </button>
        <button type="button" className="link" onClick={props.onSkip}>
          {t('לא עכשיו')}
        </button>
        {err && <p className="msg">{err}</p>}
      </div>
    </form>
  )
}
