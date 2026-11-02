import { useState } from 'react'
import { BedDouble, Lock, Plus } from 'lucide-react'
import { supabase } from '../supabase'
import { TOGETHER, whoOptions, type Booking, type City, type TripStay } from '../types'
import { mutate } from '../lib'
import { t } from '../i18n'
import { Empty, Field, Sheet } from '../ui'
import { Icon } from '../icons'
import { cityName, stayLabel } from './planUtils'

const dayMs = 86400000
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs)
const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * dayMs).toISOString().slice(0, 10)

type Props = {
  tripId: string
  /** the date of the day the sheet was opened from: new stays start there */
  date: string
  couples: string[]
  stays: TripStay[]
  cities: City[]
  bookings: Booking[]
  /** false while the table isn't in the database yet */
  available: boolean
  onClose: () => void
}

/** "Where we sleep": the nights of each party in each city, before and after any hotel is booked. */
export default function StaysSheet({ tripId, date, couples, stays, cities, bookings, available, onClose }: Props) {
  const [edit, setEdit] = useState<Partial<TripStay> | null>(null)
  // everyone first, then each couple, then any other party a stay names
  const parties: (string | null)[] = [null, ...new Set([...whoOptions(couples), ...stays.map((s) => s.party).filter((p): p is string => !!p)])]

  return (
    <>
      <Sheet title={t('איפה ישנים')} onClose={onClose}>
        {!available && <Empty>{t('הלינה לפי עיר תהיה זמינה אחרי עדכון השרת. עד אז התוכנית קוראת את הזמנות המלון.')}</Empty>}
        {available && stays.length === 0 && <Empty>{t('עוד לא הוזנה לינה. הוסיפו עיר ולילות, והתוכנית תסתדר גם לפני שמזמינים מלון.')}</Empty>}
        {available &&
          parties.map((party) => {
            const mine = stays.filter((s) => (s.party ?? null) === party).sort((a, b) => a.check_in.localeCompare(b.check_in))
            return mine.length ? (
              <div key={party ?? 'all'} className="stack">
                <h3 className="plan-owner">
                  {t(party ?? TOGETHER)}
                </h3>
                {mine.map((s) => (
                  <button key={s.id} className="card stay-row" onClick={() => setEdit(s)}>
                    <div className="row spread">
                      <b>
                        <Icon as={BedDouble} /> {cityName(s.city, cities)}
                        {s.area ? ` · ${s.area}` : ''}
                      </b>
                      {s.locked && <Icon as={Lock} className="muted" />}
                    </div>
                    <div className="small muted">
                      {shortDate(s.check_in)} – {shortDate(s.check_out)} · {nights(nightsBetween(s.check_in, s.check_out))}
                    </div>
                    <div className="small">
                      <span className="who-pill">{s.status === 'confirmed' ? t('מאושר') : t('מוצע')}</span>{' '}
                      {s.booking_id && bookings.some((b) => b.id === s.booking_id) ? stayLabel(s, bookings, cities) : t('אין הזמנה עדיין, השעות הן הערכה')}
                    </div>
                  </button>
                ))}
              </div>
            ) : null
          })}
        {available && (
          <button
            className="primary"
            onClick={() => setEdit({ party: null, city: cities[0]?.id ?? 'tokyo', check_in: date || undefined, check_out: date ? addDays(date, 1) : undefined, status: 'proposed', locked: false })}
          >
            <Icon as={Plus} /> {t('הוספת לינה')}
          </button>
        )}
      </Sheet>
      {edit && <StayForm tripId={tripId} couples={couples} cities={cities} bookings={bookings} stay={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

const nights = (n: number) => (n === 1 ? t('לילה אחד') : t('{n} לילות', { n }))

function StayForm(props: { tripId: string; couples: string[]; cities: City[]; bookings: Booking[]; stay: Partial<TripStay>; onClose: () => void }) {
  const { stay, cities } = props
  const [f, setF] = useState<Partial<TripStay>>(stay)
  const set = <K extends keyof TripStay>(k: K, v: TripStay[K] | undefined) => setF((x) => ({ ...x, [k]: v }))
  const hotels = props.bookings.filter((b) => b.kind === 'hotel')

  /** Linking a hotel booking: its dates fill what is empty, and the stay becomes a confirmed one. */
  const link = (id: string) => {
    const b = hotels.find((x) => x.id === id)
    setF((x) => ({
      ...x,
      booking_id: id || null,
      ...(b
        ? {
            check_in: x.check_in ?? b.starts_at?.slice(0, 10),
            check_out: x.check_out ?? b.ends_at?.slice(0, 10),
            party: x.party ?? b.who ?? null,
            status: 'confirmed' as const,
          }
        : {}),
    }))
  }

  const save = async () => {
    if (!f.city || !f.check_in || !f.check_out) return
    if (f.check_out <= f.check_in) return alert(t('הצ׳ק-אאוט חייב להיות אחרי הצ׳ק-אין.'))
    const row = {
      party: f.party || null,
      city: f.city,
      area: f.area?.trim() || null,
      check_in: f.check_in,
      check_out: f.check_out,
      status: f.status ?? 'proposed',
      locked: !!f.locked,
      booking_id: f.booking_id || null,
    }
    const ok = await mutate(
      f.id ? supabase.from('trip_stays').update(row).eq('id', f.id) : supabase.from('trip_stays').insert({ ...row, trip_id: props.tripId, source: 'manual' }),
    )
    if (ok) props.onClose()
  }
  const remove = async () => {
    if (f.id && confirm(t('למחוק?')) && (await mutate(supabase.from('trip_stays').delete().eq('id', f.id)))) props.onClose()
  }

  return (
    <Sheet title={f.id ? t('עריכת לינה') : t('הוספת לינה')} onClose={props.onClose}>
      <Field label={t('של מי')}>
        <select value={f.party ?? ''} onChange={(e) => set('party', e.target.value || null)}>
          <option value="">{t(TOGETHER)}</option>
          {[...new Set([...whoOptions(props.couples), ...(f.party ? [f.party] : [])])].map((c) => (
            <option key={c} value={c}>
              {t('רק {who}', { who: t(c) })}
            </option>
          ))}
        </select>
      </Field>
      <div className="chips scroll" role="group" aria-label={t('עיר')}>
        {cities.map((c) => (
          <button key={c.id} className={'chip' + (f.city === c.id ? ' on' : '')} aria-pressed={f.city === c.id} onClick={() => set('city', c.id)}>
            {cityName(c.id, cities)}
          </button>
        ))}
      </div>
      <Field label={t('אזור או שכונה (לא חובה)')}>
        <input value={f.area ?? ''} onChange={(e) => set('area', e.target.value)} dir="auto" />
      </Field>
      <div className="row">
        <Field label={t('צ׳ק-אין')}>
          <input type="date" value={f.check_in ?? ''} onChange={(e) => set('check_in', e.target.value)} />
        </Field>
        <Field label={t('צ׳ק-אאוט')}>
          <input type="date" value={f.check_out ?? ''} onChange={(e) => set('check_out', e.target.value)} />
        </Field>
      </div>
      {f.check_in && f.check_out && f.check_out > f.check_in && <div className="small muted">{nights(nightsBetween(f.check_in, f.check_out))}</div>}
      <div className="chips" role="group" aria-label={t('סטטוס')}>
        {(['proposed', 'confirmed'] as const).map((s) => (
          <button key={s} className={'chip' + ((f.status ?? 'proposed') === s ? ' on' : '')} aria-pressed={(f.status ?? 'proposed') === s} onClick={() => set('status', s)}>
            {s === 'confirmed' ? t('מאושר') : t('מוצע')}
          </button>
        ))}
        <button className={'chip' + (f.locked ? ' on' : '')} aria-pressed={!!f.locked} onClick={() => set('locked', !f.locked)}>
          <Icon as={Lock} /> {t('נעול')}
        </button>
      </div>
      <div className="small muted">{t('נעול: התוכנית לא תזיז את הלינה הזו.')}</div>
      {hotels.length > 0 && (
        <Field label={t('הזמנת מלון')}>
          <select value={f.booking_id ?? ''} onChange={(e) => link(e.target.value)}>
            <option value="">{t('ללא הזמנה')}</option>
            {hotels.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
                {b.starts_at ? ` · ${shortDate(b.starts_at.slice(0, 10))}` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      <button className="primary" onClick={save}>
        {t('שמירה')}
      </button>
      {f.id && (
        <button className="danger" onClick={remove}>
          {t('מחיקה')}
        </button>
      )}
    </Sheet>
  )
}
