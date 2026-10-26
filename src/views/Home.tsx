import { useEffect, useState } from 'react'
import {
  BedDouble,
  Check,
  ChevronLeft,
  Clock,
  Layers,
  LifeBuoy,
  ListChecks,
  LogOut,
  Navigation,
  Settings as SettingsIcon,
  Share2,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react'
import { supabase } from '../supabase'
import {
  BOOKING_TABS,
  itemDone,
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
import { BOOKING_ICON, Icon } from '../icons'
import type { MoreTab } from './More'
import { dayEntries, fmtUntil, hotelFor, nightLines, stayInJapan, minutesOf, navUrl, ymd, type Entry, type PlanItem } from './planUtils'
import '../styles/plan.css'

type Props = {
  trip: Trip
  members: Member[]
  me: string
  userId: string
  onOpenDay: (d: number) => void
  /** jump to a section of the "עוד" tab: money, lists, info or baby */
  onOpenMore: (sub: MoreTab) => void
  onLeave: () => void
}

export default function Home({ trip, members, me, userId, onOpenDay, onOpenMore, onLeave }: Props) {
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<PlanItem>('itinerary_items', trip.id, 'sort')
  const { rows: bookings } = useTripTable<Booking>('bookings', trip.id, 'starts_at')
  const { rows: todos } = useTripTable<ChecklistItem>('checklist_items', trip.id)
  const { rows: candidates } = useTripTable<Candidate>('candidates', trip.id)
  const { rows: swipes } = useTripTable<Swipe>('swipes', trip.id)
  const [editing, setEditing] = useState(false)
  const now = useNow()

  const today = currentDay(trip.start_date, trip.num_days)
  // count on Tokyo's calendar, not the phone's: abroad the local date can differ from Japan's
  const tokyoDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  const daysLeft = trip.start_date ? Math.round((Date.parse(trip.start_date) - Date.parse(tokyoDate)) / 86400000) : null
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
  const tonight = today
    ? hotelFor(nightLines(todayInfo?.hotel ?? null, bookings, ymd(dayDate(trip.start_date, today)!), couples), myCouple)
    : []
  const cities = runs(days, 'city')
  const together = runs(days, 'who')

  return (
    <div className="stack">
      <section className={'hero card' + (today ? ' trip-line' : '')}>
        {today ? (
          <>
            <div className="muted hero-date">{fmtDay(dayDate(trip.start_date, today))}</div>
            <div className="big">
              יום {today}
              {todayInfo?.city && ` · ${todayInfo.city}`}
            </div>
          </>
        ) : daysLeft !== null && daysLeft > 0 ? (
          <>
            <div className="big">{daysLabel(daysLeft)}</div>
            <div className="muted">להמראה</div>
          </>
        ) : daysLeft !== null ? (
          <div className="big">הטיול הסתיים</div>
        ) : (
          <>
            <div className="muted">עוד אין תאריך יציאה</div>
            <button className="link" onClick={() => setEditing(true)}>
              קבעו תאריך התחלה
            </button>
          </>
        )}
        <div className="clock">
          <Icon as={Clock} /> עכשיו ביפן: {tokyoTime}
        </div>
      </section>

      {today && (
        <>
          <NextCard next={next} nowHM={nowHM} hasPlan={entries.length > 0} leftCount={rest.length} onOpenDay={() => onOpenDay(today)} />

          {tonight.length > 0 && (
            <section className="card">
              <h3>
                <Icon as={BedDouble} /> הלילה במלון
              </h3>
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
                לתוכנית המלאה <Icon as={ChevronLeft} />
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
          open={() => onOpenMore('lists')}
          swipesLeft={candidates.filter((c) => !swipes.some((s) => s.user_id === userId && s.candidate_id === c.id)).length}
        />
      )}

      <div className="shortcuts">
        <button className="secondary" onClick={() => onOpenMore('info')}>
          <Icon as={LifeBuoy} /> מידע חשוב
        </button>
        <button className="secondary" onClick={() => onOpenMore('money')}>
          <Icon as={Wallet} /> הוצאות
        </button>
      </div>

      {together.some((t) => t.value) && (
        <section className="card">
          <h3>ביחד ולחוד</h3>
          <div className="route">
            {together.map((t) => (
              <button key={t.from} className={'route-stop' + (t.value ? ' apart' : ' together')} onClick={() => onOpenDay(t.from)}>
                <b>
                  {t.value ? (
                    `רק ${t.value}`
                  ) : (
                    <>
                      <Icon as={Users} /> {TOGETHER}
                    </>
                  )}
                </b>
                <span className="muted small">
                  {fmtDay(dayDate(trip.start_date, t.from))}
                  {t.to !== t.from && ` – ${fmtDay(dayDate(trip.start_date, t.to))}`} · {daysLabel(t.to - t.from + 1)}
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
                {c.from === c.to ? `יום ${c.from}` : <>ימים <bdi dir="ltr">{c.from}–{c.to}</bdi></>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>משתתפים</h3>
        <div className="chips">
          {members.map((m) => (
            <span key={m.user_id} className="chip">
              {m.display_name}
              {m.user_id === userId && ' (אני)'}
            </span>
          ))}
        </div>
        <p className="muted small">
          להזמנה: שלחו את הקישור לאפליקציה ואת קוד הטיול{' '}
          <b className="code" dir="ltr">{trip.join_code}</b>
        </p>
        <button
          className="secondary"
          onClick={() => {
            const text = `הצטרפו לתכנון הטיול ליפן\n${location.href}\nקוד טיול: ${trip.join_code}`
            if (navigator.share) navigator.share({ text }).catch(() => {})
            else navigator.clipboard.writeText(text).then(() => alert('הועתק'))
          }}
        >
          <Icon as={Share2} /> שיתוף הזמנה
        </button>
      </section>

      <div className="row">
        <button className="secondary" onClick={() => setEditing(true)}>
          <Icon as={SettingsIcon} /> הגדרות טיול
        </button>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          <Icon as={LogOut} /> התנתקות
        </button>
      </div>

      {editing && (
        <Settings trip={trip} me={me} userId={userId} onClose={() => setEditing(false)} onLeave={onLeave} />
      )}
    </div>
  )
}

/** Hero for trip days: what is next, how long until it, and a one-tap route there. */
function NextCard(props: { next?: Entry; nowHM: string; hasPlan: boolean; leftCount: number; onOpenDay: () => void }) {
  const { next, nowHM } = props
  if (!next)
    return (
      <section className="card">
        <h3>{!props.hasPlan ? 'אין עדיין תוכנית להיום' : props.leftCount ? 'אין עוד פעילויות עם שעה' : 'סיימתם להיום'}</h3>
        <p className="muted">
          {props.hasPlan
            ? props.leftCount
              ? `נשארו ${props.leftCount === 1 ? 'פעילות אחת' : `${props.leftCount} פעילויות`} שלא סומנו כבוצעו.`
              : 'אין עוד פעילויות להיום.'
            : 'אפשר לבחור מקום בלשונית מקומות ולהוסיף אותו למסלול, או לכתוב פעילות בתוכנית.'}
        </p>
        <button className="link" onClick={props.onOpenDay}>
          לתוכנית של היום <Icon as={ChevronLeft} />
        </button>
      </section>
    )
  const i = next.item
  return (
    <section className="card next-card">
      <div className="next-label">הבא{next.time && ` · ${fmtUntil(minutesOf(next.time) - minutesOf(nowHM))}`}</div>
      {next.time && <div className="next-time">{next.time}</div>}
      <div className="next-title">
        <Icon as={next.icon} /> {next.title}
      </div>
      {next.sub && <div className="muted">{next.sub}</div>}
      {next.location && (
        <a className="primary" href={navUrl(next.location)} target="_blank" rel="noreferrer">
          <Icon as={Navigation} /> ניווט
        </a>
      )}
      {i && (
        <button className="secondary" onClick={() => mutate(supabase.from('itinerary_items').update({ done: true }).eq('id', i.id))}>
          <Icon as={Check} /> בוצע
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
        <Icon as={e.icon} /> {e.title}
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
  const left = todo.filter((t) => !itemDone(t, props.myCouple)).length
  const counts = ['flight', 'hotel', 'restaurant', 'activity'].map((k) => ({ k, n: bookings.filter((b) => b.kind === k).length }))
  const mine = props.myCouple

  // each couple needs a roof for its own nights in Japan: from landing to the night before its flight out. Without
  // both flights, fall back to the trip's days minus the other couple's days alone (and not the last day)
  const missing = [...couples]
    .sort((a, b) => Number(b === mine) - Number(a === mine))
    .map((c) => {
      const stay = stayInJapan(bookings, c)
      const nights = Array.from({ length: Math.max(props.numDays - (stay ? 0 : 1), 0) }, (_, i) => i + 1)
        .map((day) => ({ day, date: props.start ? ymd(dayDate(props.start, day)!) : '', info: days.find((d) => d.day === day) }))
        .filter(({ date, info }) => (stay ? date >= stay.from && date < stay.to : !info?.who || info.who === c))
      const uncovered = nights.filter(
        ({ date, info }) => !hotelFor(nightLines(info?.hotel ?? null, bookings, date, couples), c).length,
      )
      return { c, n: uncovered.length, of: nights.length }
    })
    .filter((m) => m.n > 0)
  const noFlight = couples.filter((c) => !bookings.some((b) => b.kind === 'flight' && (!b.who || b.who === c)))
  const gaps = [
    ...noFlight.map((c) => `אין טיסה ל${c}`),
    ...(missing.length ? [`חסרה לינה: ${missing.map((m) => `${m.c} ${m.n} מתוך ${m.of} לילות`).join(' · ')}`] : []),
  ]

  if (!todo.length && !bookings.length && !gaps.length && !props.swipesLeft) return null
  return (
    <section className="card">
      <h3>לפני הטיול</h3>
      {todo.length > 0 && (
        <button className="todo-row" onClick={props.open}>
          <span className="tile orange"><Icon as={ListChecks} /></span>
          <span>
            <b>{left ? `${left} משימות לפני הטיסה` : 'כל המשימות הושלמו'}</b>
            <span className="muted small">
              {todo.length - left}/{todo.length} הושלמו
            </span>
          </span>
        </button>
      )}
      <div className="todo-row">
        <span className="tile indigo"><Icon as={Ticket} /></span>
        <span>
          <b className="count-chips">
            {counts.map(({ k, n }) => (
              <span key={k} className="count-chip">
                <Icon as={BOOKING_ICON[k]} /> {n} {BOOKING_TABS[k]}
              </span>
            ))}
          </b>
          <span className="muted small">{gaps.length ? gaps.join(' · ') : 'טיסות ולינה סגורות'}</span>
        </span>
      </div>
      {props.swipesLeft > 0 && (
        <div className="todo-row">
          <span className="tile red"><Icon as={Layers} /></span>
          <span>
            <b>עוד {props.swipesLeft} מקומות בגילוי</b>
            <span className="muted small">כל לייק או פאס משפיע על המאצ׳ים של הזוגות</span>
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
        מאצ׳: מקום נכנס לרשימה של זוג כששניהם אוהבים אותו, ולרשימה של כולם כששני הזוגות אוהבים.
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

/** "יום אחד" / "יומיים" / "5 ימים" */
function daysLabel(n: number) {
  return n === 1 ? 'יום אחד' : n === 2 ? 'יומיים' : `${n} ימים`
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
