import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import {
  BOOKING_KINDS,
  TOGETHER,
  type Booking,
  type Candidate,
  type ChecklistItem,
  type DayInfo,
  type ItineraryItem,
  type Member,
  type Swipe,
  type Trip,
} from '../types'
import { couplesOf, currentDay, dayDate, fmtDay, mutate, useTripTable } from '../lib'
import { Field, Sheet } from '../ui'
import { dayEntries, fmtUntil, hotelFor, minutesOf, navUrl, ymd, type Entry, type PlanItem } from './planUtils'
import '../styles/plan.css'

type Props = {
  trip: Trip
  members: Member[]
  me: string
  userId: string
  onOpenDay: (d: number) => void
  onLeave: () => void
  /** jump to a sub-screen of "more" */
  onOpenMore?: (sub: 'money' | 'lists' | 'info' | 'baby') => void
}

export default function Home({ trip, members, me, userId, onOpenDay, onLeave, onOpenMore }: Props) {
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<PlanItem>('itinerary_items', trip.id, 'sort')
  const { rows: bookings } = useTripTable<Booking>('bookings', trip.id, 'starts_at')
  const { rows: todos } = useTripTable<ChecklistItem>('checklist_items', trip.id)
  const { rows: candidates } = useTripTable<Candidate>('candidates', trip.id)
  const { rows: swipes } = useTripTable<Swipe>('swipes', trip.id)
  const [editing, setEditing] = useState(false)
  const now = useNow()

  const today = currentDay(trip.start_date, trip.num_days)
  const daysLeft = trip.start_date
    ? Math.ceil((new Date(trip.start_date + 'T00:00:00').getTime() - now.getTime()) / 86400000)
    : null
  const tokyoTime = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  const todayInfo = days.find((d) => d.day === today)
  const entries = today ? dayEntries(items, bookings, today, ymd(dayDate(trip.start_date, today)!), 'mine', myCouple) : []
  const nowHM = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  // the next thing still ahead today; untimed items wait their turn after the timed ones
  const next = entries.find((e) => !e.done && e.time && e.time >= nowHM) ?? entries.find((e) => !e.done && !e.time)
  const rest = entries.filter((e) => e !== next && e.item && !e.done)
  const todayBookings = entries.filter((e) => e.booking)
  const tonight = hotelFor(todayInfo?.hotel ?? null, couples, myCouple)
  const cities = runs(days, 'city')
  const together = runs(days, 'who')

  return (
    <div className="stack">
      <section className={'hero card' + (today ? ' trip-line' : '')}>
        {today ? (
          <>
            <div className="big">יום {today}</div>
            <div className="muted">{todayInfo?.city ?? ''} · {fmtDay(dayDate(trip.start_date, today))}</div>
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
        <>
          <NextCard next={next} nowHM={nowHM} hasPlan={entries.length > 0} onOpenDay={() => onOpenDay(today)} />

          {tonight.length > 0 && (
            <section className="card">
              <h3>🏨 הלילה ישנים ב…</h3>
              {tonight.map((t) => (
                <div key={t}>{t}</div>
              ))}
            </section>
          )}

          {todayBookings.length > 0 && (
            <section className="card">
              <h3>ההזמנות להיום</h3>
              {todayBookings.map((e) => (
                <TodayRow key={e.key} e={e} past={!!e.time && e.time < nowHM} />
              ))}
            </section>
          )}

          {rest.length > 0 && (
            <section className="card">
              <h3>שאר היום</h3>
              {rest.map((e) => (
                <TodayRow key={e.key} e={e} past={!!e.time && e.time < nowHM} />
              ))}
              <button className="link" onClick={() => onOpenDay(today)}>
                לתוכנית המלאה ←
              </button>
            </section>
          )}
        </>
      )}

      {!today && daysLeft !== null && daysLeft > 0 && (
        <BeforeTrip
          days={days}
          numDays={trip.num_days}
          start={trip.start_date}
          couples={couples}
          myCouple={myCouple}
          bookings={bookings}
          todos={todos}
          open={() => onOpenMore?.('lists')}
          swipesLeft={candidates.filter((c) => !swipes.some((s) => s.user_id === userId && s.candidate_id === c.id)).length}
        />
      )}

      {onOpenMore && (
        <div className="shortcuts">
          <button className="secondary" onClick={() => onOpenMore('info')}>
            🆘 חשוב
          </button>
          <button className="secondary" onClick={() => onOpenMore('money')}>
            💰 הוצאות
          </button>
        </div>
      )}

      {together.some((t) => t.value) && (
        <section className="card">
          <h3>ביחד ולחוד</h3>
          <div className="route">
            {together.map((t) => (
              <button key={t.from} className={'route-stop' + (t.value ? ' apart' : ' together')} onClick={() => onOpenDay(t.from)}>
                <b>{t.value ? `👤 רק ${t.value}` : `👥 ${TOGETHER}`}</b>
                <span className="muted small">
                  {fmtDay(dayDate(trip.start_date, t.from))}
                  {t.to !== t.from && ` – ${fmtDay(dayDate(trip.start_date, t.to))}`} · {t.to - t.from + 1} ימים
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h3>המסלול</h3>
        <div className="route">
          {cities.map((c) => (
            <button key={c.from} className="route-stop" onClick={() => onOpenDay(c.from)}>
              <b>{c.value || '—'}</b>
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

/** Hero for trip days: what is next, how long until it, and a one-tap route there. */
function NextCard(props: { next?: Entry; nowHM: string; hasPlan: boolean; onOpenDay: () => void }) {
  const { next, nowHM } = props
  if (!next)
    return (
      <section className="card">
        <h3>{props.hasPlan ? 'סיימתם להיום 🎉' : 'אין עדיין תוכנית להיום'}</h3>
        <p className="muted">
          {props.hasPlan ? 'אין עוד כלום ביומן להיום.' : 'אפשר לבחור מקום בלשונית מקומות ולהוסיף אותו למסלול, או לכתוב פעילות בתוכנית.'}
        </p>
        <button className="link" onClick={props.onOpenDay}>
          לתוכנית של היום ←
        </button>
      </section>
    )
  const i = next.item
  return (
    <section className="card next-card">
      <div className="next-label">הבא{next.time && ` · ${fmtUntil(minutesOf(next.time) - minutesOf(nowHM))}`}</div>
      {next.time && <div className="next-time">{next.time}</div>}
      <div className="next-title">
        {next.icon} {next.title}
      </div>
      {next.sub && <div className="muted">{next.sub}</div>}
      {next.location && (
        <a className="primary" href={navUrl(next.location)} target="_blank" rel="noreferrer">
          🧭 ניווט
        </a>
      )}
      {i && (
        <button className="secondary" onClick={() => mutate(supabase.from('itinerary_items').update({ done: true }).eq('id', i.id))}>
          ✓ בוצע
        </button>
      )}
    </section>
  )
}

function TodayRow({ e, past }: { e: Entry; past: boolean }) {
  return (
    <div className={'today-row' + (past ? ' past' : '')}>
      <span className="time">{e.time ?? '—'}</span>
      <span>
        {e.icon} {e.title}
      </span>
    </div>
  )
}

/** A few things worth doing before the flight: lists, what's still unbooked, cards left to swipe. */
function BeforeTrip(props: {
  days: DayInfo[]
  numDays: number
  start: string | null
  couples: string[]
  myCouple: string | null
  bookings: Booking[]
  todos: ChecklistItem[]
  swipesLeft: number
  open: () => void
}) {
  const { bookings, couples, days } = props
  const todo = props.todos.filter((t) => t.list === 'todo')
  const left = todo.filter((t) => !t.done).length
  const counts = ['flight', 'hotel', 'restaurant', 'activity'].map(
    (k) => `${BOOKING_KINDS[k].split(' ')[0]} ${bookings.filter((b) => b.kind === k).length}`,
  )
  const mine = props.myCouple

  // a night needs a roof for every couple in Japan that day, except the last day of the trip
  const missing = [...couples]
    .sort((a, b) => Number(b === mine) - Number(a === mine))
    .map((c) => {
      const nights = days.filter((d) => d.day < props.numDays && (!d.who || d.who === c))
      const uncovered = nights.filter((d) => {
        if (hotelFor(d.hotel, couples, c).length) return false
        const date = props.start ? ymd(dayDate(props.start, d.day)!) : ''
        return !bookings.some(
          (b) =>
            b.kind === 'hotel' &&
            (!b.who || b.who === c) &&
            b.starts_at &&
            b.ends_at &&
            b.starts_at.slice(0, 10) <= date &&
            date < b.ends_at.slice(0, 10),
        )
      })
      return { c, n: uncovered.length }
    })
    .filter((m) => m.n > 0)
  const noFlight = couples.filter((c) => !bookings.some((b) => b.kind === 'flight' && (!b.who || b.who === c)))
  const gaps = [
    ...noFlight.map((c) => `אין טיסה ל${c}`),
    ...(missing.length ? [`חסרה לינה: ${missing.map((m) => `${m.c} ${m.n} לילות`).join(' · ')}`] : []),
  ]

  if (!todo.length && !bookings.length && !gaps.length && !props.swipesLeft) return null
  return (
    <section className="card">
      <h3>כדאי לעשות עכשיו</h3>
      {todo.length > 0 && (
        <button className="todo-row" onClick={props.open}>
          <span>📝</span>
          <span>
            <b>{left ? `${left} משימות לפני הטיסה` : 'כל המשימות הושלמו'}</b>
            <span className="muted small">
              {todo.length - left}/{todo.length} הושלמו
            </span>
          </span>
        </button>
      )}
      <div className="todo-row">
        <span>🎫</span>
        <span>
          <b className="count-chips">
            {counts.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </b>
          <span className="muted small">{gaps.length ? gaps.join(' · ') : 'טיסות ולינה סגורות'}</span>
        </span>
      </div>
      {props.swipesLeft > 0 && (
        <div className="todo-row">
          <span>🔥</span>
          <span>
            <b>{props.swipesLeft} מקומות מחכים לך במשחק</b>
            <span className="muted small">כל החלקה עוזרת למצוא מאצ׳ים</span>
          </span>
        </div>
      )}
    </section>
  )
}

function Settings(props: { trip: Trip; me: string; userId: string; onClose: () => void; onLeave: () => void }) {
  const [name, setName] = useState(props.trip.name)
  const [start, setStart] = useState(props.trip.start_date ?? '')
  const [numDays, setNumDays] = useState(props.trip.num_days)
  const [myName, setMyName] = useState(props.me)

  const save = async () => {
    if (!Number.isInteger(numDays) || numDays < 1 || numDays > 60) {
      alert('מספר הימים צריך להיות בין 1 ל-60')
      return
    }
    const ok = await mutate(
      supabase.from('trips').update({ name: name.trim() || props.trip.name, start_date: start || null, num_days: numDays }).eq('id', props.trip.id),
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
      <p className="muted small">
        💘 מאצ׳: מקום נכנס לרשימה של זוג כששניהם אוהבים אותו, ולרשימה של כולם כששני הזוגות אוהבים.
      </p>
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

/** Consecutive days sharing the same value, e.g. the city or who is there. */
function runs(days: DayInfo[], key: 'city' | 'who') {
  const out: { value: string; from: number; to: number }[] = []
  for (const d of [...days].sort((a, b) => a.day - b.day)) {
    const last = out[out.length - 1]
    const value = d[key] ?? ''
    if (last && last.value === value && last.to === d.day - 1) last.to = d.day
    else out.push({ value, from: d.day, to: d.day })
  }
  return out
}
