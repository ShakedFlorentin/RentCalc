import { useEffect, useState, type ReactNode } from 'react'
import {
  BedDouble,
  Check,
  ChevronLeft,
  Clock,
  Languages,
  Layers,
  LogOut as LogOutIcon,
  MessageSquareWarning,
  Moon,
  ListChecks,
  Navigation,
  Share2,
  ShieldAlert,
  Sun,
  SunMoon,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react'
import { supabase } from '../supabase'
import {
  BOOKING_TABS,
  itemDone,
  CITY_HE,
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
import { cityPhoto } from '../cities'
import { BOOKING_ICON, Icon } from '../icons'
import type { MoreTab } from './More'
import { dayEntries, fmtUntil, hotelFor, nightLines, stayInJapan, minutesOf, navUrl, ymd, type Entry, type PlanItem } from './planUtils'
import ReportSheet from './Report'
import '../styles/plan.css'

type Props = {
  trip: Trip
  members: Member[]
  me: string
  userId: string
  onOpenDay: (d: number) => void
  /** jump to a section of the "עוד" tab: money, lists, info or baby */
  onOpenMore: (sub: MoreTab) => void
  onOpenPlaces: () => void
  onLeave: () => void
  /** the top bar's avatar asks for trip settings; Home opens them and clears the request */
  settingsAsk: boolean
  onSettingsShown: () => void
  /** where the avatar was tapped, e.g. "עוד › כסף": a problem report says which screen it is about */
  settingsFrom: string
}

export default function Home({ trip, members, me, userId, onOpenDay, onOpenMore, onOpenPlaces, onLeave, settingsAsk, onSettingsShown, settingsFrom }: Props) {
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<PlanItem>('itinerary_items', trip.id, 'sort')
  const { rows: bookings } = useTripTable<Booking>('bookings', trip.id, 'starts_at')
  const { rows: todos } = useTripTable<ChecklistItem>('checklist_items', trip.id)
  const { rows: candidates } = useTripTable<Candidate>('candidates', trip.id)
  const { rows: swipes } = useTripTable<Swipe>('swipes', trip.id)
  const [editing, setEditing] = useState(false)
  const [reporting, setReporting] = useState(false)
  useEffect(() => {
    if (!settingsAsk) return
    setEditing(true)
    onSettingsShown()
  }, [settingsAsk])
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
  const destinations = Object.entries(
    candidates.reduce<Record<string, number>>((acc, c) => ((acc[c.city] = (acc[c.city] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1])
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
          <Icon as={ShieldAlert} /> חירום
        </button>
        <button className="secondary" onClick={() => onOpenMore('say')}>
          <Icon as={Languages} /> תרגום
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

      {cities.some((c) => c.value) ? (
        <section>
          <h3 className="shelf-title">המסלול</h3>
          <div className="city-grid">
            {cities.map((c, i) => (
              <CityTile key={c.from} name={c.value || '—'} i={i} onClick={() => onOpenDay(c.from)}>
                {c.from === c.to ? `יום ${c.from}` : <>ימים <bdi dir="ltr">{c.from}–{c.to}</bdi></>}
              </CityTile>
            ))}
          </div>
        </section>
      ) : (
        destinations.length > 0 && (
          // no day has a city yet: show where the swipe deck's places are instead
          <section>
            <h3 className="shelf-title">היעדים</h3>
            <div className="city-grid">
              {destinations.map(([city, n], i) => (
                <CityTile key={city} name={CITY_HE[city] ?? city} slug={city} i={i} onClick={onOpenPlaces}>
                  {n} מקומות
                </CityTile>
              ))}
            </div>
          </section>
        )
      )}

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

      {editing && (
        <Settings
          trip={trip}
          me={me}
          userId={userId}
          onClose={() => setEditing(false)}
          onLeave={onLeave}
          onReport={() => {
            setEditing(false)
            setReporting(true)
          }}
        />
      )}
      {reporting && <ReportSheet trip={trip} me={me} from={settingsFrom} onClose={() => setReporting(false)} />}
    </div>
  )
}

/** A Music Search-style tile: the destination's photo washed in one colour, or plain colour until it has one. */
function CityTile(props: { name: string; slug?: string; i: number; onClick: () => void; children: ReactNode }) {
  const photo = cityPhoto(props.slug ?? props.name)
  return (
    <button className={'city-tile c' + (props.i % 7) + (photo ? ' has-photo' : '')} onClick={props.onClick}>
      {photo && <img src={photo} alt="" loading="lazy" draggable={false} />}
      <b dir="auto">{props.name}</b>
      <span className="small">{props.children}</span>
    </button>
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

function Settings(props: { trip: Trip; me: string; userId: string; onClose: () => void; onLeave: () => void; onReport: () => void }) {
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
        מאצ׳: כל זוג מצביע יחד, ולייק של אחד מבני הזוג מספיק אם השני לא דילג. מקום נשאל רק אצל הזוגות שישנים לידו, ונכנס
        למסלול כשכולם אהבו אותו.
      </p>
      <Field label="השם שלי">
        <input value={myName} onChange={(e) => setMyName(e.target.value)} />
      </Field>
      <p className="muted small">זה השם שהאחרים רואים. ההתחברות נשארת עם השם המקורי שלך באנגלית או בעברית.</p>
      <button className="primary" onClick={save}>
        שמירה
      </button>
      <ThemePicker />
      <button className="secondary" onClick={props.onReport}>
        <Icon as={MessageSquareWarning} /> דיווח על בעיה או טעות
      </button>
      <button className="link" onClick={props.onLeave}>
        מעבר לטיול אחר / הצטרפות בקוד
      </button>
      <button
        className="secondary signout"
        onClick={() => {
          // this phone only: the others' devices, and this person's other devices, stay logged in
          if (confirm('להתנתק מהטלפון הזה? כדי לחזור צריך שם וסיסמה.')) supabase.auth.signOut({ scope: 'local' })
        }}
      >
        <Icon as={LogOutIcon} /> התנתקות
      </button>
    </Sheet>
  )
}

const THEMES = [
  { id: 'auto', label: 'כמו בטלפון', icon: SunMoon },
  { id: 'light', label: 'בהיר', icon: Sun },
  { id: 'dark', label: 'כהה', icon: Moon },
] as const

/**
 * Light, dark, or following the phone. Kept on this phone only and applied at once: html[data-theme] switches the
 * dark styles (see themeOverride in vite.config.ts), and index.html applies it again before the next load paints.
 */
function ThemePicker() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') ?? 'auto'
    } catch {
      return 'auto'
    }
  })
  const pick = (t: string) => {
    setTheme(t)
    if (t === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
    try {
      if (t === 'auto') localStorage.removeItem('theme')
      else localStorage.setItem('theme', t)
    } catch {
      // private browsing: the choice holds until the app closes
    }
  }
  return (
    <div className="field">
      <span id="theme-label">מראה</span>
      <div className="segmented theme-picker" role="radiogroup" aria-labelledby="theme-label">
        {THEMES.map((t) => (
          <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
            <Icon as={t.icon} /> {t.label}
          </button>
        ))}
      </div>
    </div>
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
