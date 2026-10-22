import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { DayInfo, ItineraryItem, Member, Trip } from '../types'
import { currentDay, dayDate, fmtDay, mutate, useTripTable } from '../lib'
import { Field, Sheet } from '../ui'

type Props = {
  trip: Trip
  members: Member[]
  me: string
  userId: string
  onOpenDay: (d: number) => void
  onLeave: () => void
}

export default function Home({ trip, members, me, userId, onOpenDay, onLeave }: Props) {
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<ItineraryItem>('itinerary_items', trip.id, 'sort')
  const [editing, setEditing] = useState(false)
  const now = useNow()

  const today = currentDay(trip.start_date, trip.num_days)
  const daysLeft = trip.start_date
    ? Math.ceil((new Date(trip.start_date + 'T00:00:00').getTime() - now.getTime()) / 86400000)
    : null
  const tokyoTime = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
  const todayItems = today ? items.filter((i) => i.day === today).sort(byTime) : []
  const cities = summarizeCities(days)

  return (
    <div className="stack">
      <section className="hero card">
        {today ? (
          <>
            <div className="big">יום {today}</div>
            <div className="muted">{days.find((d) => d.day === today)?.city ?? ''} · {fmtDay(dayDate(trip.start_date, today))}</div>
          </>
        ) : daysLeft !== null && daysLeft > 0 ? (
          <>
            <div className="big">{daysLeft}</div>
            <div className="muted">ימים להמראה ✈️</div>
          </>
        ) : daysLeft !== null ? (
          <div className="big">הטיול הסתיים 🌸</div>
        ) : (
          <>
            <div className="big">🗾</div>
            <button className="link" onClick={() => setEditing(true)}>
              קבעו תאריך התחלה
            </button>
          </>
        )}
        <div className="clock">🕐 עכשיו ביפן: {tokyoTime}</div>
      </section>

      {today && (
        <section className="card">
          <h3>היום בתוכנית</h3>
          {todayItems.length === 0 && <p className="muted">אין עדיין פריטים להיום</p>}
          {todayItems.map((i) => (
            <div key={i.id} className={'mini-item' + (i.done ? ' done' : '')}>
              <span className="time">{i.time}</span> {i.title}
            </div>
          ))}
          <button className="link" onClick={() => onOpenDay(today)}>
            לתוכנית המלאה ←
          </button>
        </section>
      )}

      <section className="card">
        <h3>המסלול</h3>
        <div className="route">
          {cities.map((c) => (
            <button key={c.from} className="route-stop" onClick={() => onOpenDay(c.from)}>
              <b>{c.city || '—'}</b>
              <span className="muted small">
                {c.from === c.to ? `יום ${c.from}` : `ימים ${c.from}–${c.to}`}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>החבר׳ה</h3>
        <div className="chips">
          {members.map((m) => (
            <span key={m.user_id} className="chip">
              {m.display_name}
              {m.user_id === userId && ' (אני)'}
            </span>
          ))}
        </div>
        <p className="muted small">
          להזמנת חברים: שלחו להם את הקישור לאפליקציה ואת קוד הטיול{' '}
          <b className="code" dir="ltr">{trip.join_code}</b>
        </p>
        <button
          className="secondary"
          onClick={() => {
            const text = `הצטרפו לתכנון הטיול ליפן 🇯🇵\n${location.href}\nקוד טיול: ${trip.join_code}`
            if (navigator.share) navigator.share({ text }).catch(() => {})
            else navigator.clipboard.writeText(text).then(() => alert('הועתק!'))
          }}
        >
          שיתוף הזמנה
        </button>
      </section>

      <div className="row">
        <button className="secondary" onClick={() => setEditing(true)}>
          ⚙️ הגדרות טיול
        </button>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          התנתקות
        </button>
      </div>

      {editing && (
        <Settings trip={trip} me={me} userId={userId} onClose={() => setEditing(false)} onLeave={onLeave} />
      )}
    </div>
  )
}

function Settings(props: { trip: Trip; me: string; userId: string; onClose: () => void; onLeave: () => void }) {
  const [name, setName] = useState(props.trip.name)
  const [start, setStart] = useState(props.trip.start_date ?? '')
  const [numDays, setNumDays] = useState(props.trip.num_days)
  const [myName, setMyName] = useState(props.me)

  const save = async () => {
    const ok = await mutate(
      supabase.from('trips').update({ name, start_date: start || null, num_days: numDays }).eq('id', props.trip.id),
    )
    if (ok && myName.trim() && myName !== props.me) {
      await mutate(
        supabase
          .from('members')
          .update({ display_name: myName.trim() })
          .eq('trip_id', props.trip.id)
          .eq('user_id', props.userId),
      )
    }
    if (ok) props.onClose()
  }

  return (
    <Sheet title="הגדרות טיול" onClose={props.onClose}>
      <Field label="שם הטיול">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="תאריך יום 1">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label="מספר ימים">
        <input type="number" min={1} max={60} value={numDays} onChange={(e) => setNumDays(+e.target.value)} />
      </Field>
      <Field label="השם שלי">
        <input value={myName} onChange={(e) => setMyName(e.target.value)} />
      </Field>
      <button className="primary" onClick={save}>
        שמירה
      </button>
      <button className="link" onClick={props.onLeave}>
        מעבר לטיול אחר / הצטרפות בקוד
      </button>
    </Sheet>
  )
}

function useNow() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function byTime(a: ItineraryItem, b: ItineraryItem) {
  return (a.time || '99').localeCompare(b.time || '99') || a.sort - b.sort
}

function summarizeCities(days: DayInfo[]) {
  const out: { city: string; from: number; to: number }[] = []
  for (const d of [...days].sort((a, b) => a.day - b.day)) {
    const last = out[out.length - 1]
    const city = d.city ?? ''
    if (last && last.city === city && last.to === d.day - 1) last.to = d.day
    else out.push({ city, from: d.day, to: d.day })
  }
  return out
}
