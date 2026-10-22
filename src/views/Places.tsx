import { useCallback, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { AUDIENCES, CATEGORIES, VERDICTS, type DayInfo, type ItineraryItem, type Member, type Place, type Trip } from '../types'
import { couplesOf, mapsUrl, mutate, useMediaIndex, useTripTable, withMedia } from '../lib'
import { Empty, Field, LoadNote, Sheet, Tabs, useRemembered } from '../ui'
import { MediaActions, Thumb } from '../media'
import PlacesMap from './PlacesMap'
import AddPlace from './AddPlace'

const PLACE_TABS: Record<string, string> = {
  '': '✨ הכל',
  food: '🍜 אוכל',
  sight: '⛩️ אטרקציות',
  shopping: '🛍️ קניות',
  transport: '🚄 תחבורה',
  other: '📌 אחר',
}

const CITY_ORDER = ['טוקיו', 'קיוטו', 'נארה', 'אוסקה', 'טיולי יום', 'טיול יום']

type Props = { trip: Trip; me: string; userId: string; members: Member[] }

export default function Places({ trip, me, userId, members }: Props) {
  const { rows: rawRows, loading, error, reload } = useTripTable<Place>('places', trip.id)
  const media = useMediaIndex()
  // places with neither a match nor an author were pre-seeded with the trip, before anyone chose anything
  const rows = useMemo(
    () => rawRows.filter((p) => p.candidate_id || p.added_by).map((p) => withMedia(p, media)),
    [rawRows, media],
  )
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<ItineraryItem>('itinerary_items', trip.id, 'sort')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [city, setCity] = useState('')
  const [cat, setCat] = useRemembered('placesTab', '')
  const [aud, setAud] = useState('')
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  // whose places: 'all', 'together' = the group's only, or a couple's name = that couple's plus the group's,
  // since a place both couples liked is on each couple's trip too
  const [whose, setWhose] = useState(myCouple ?? 'all')
  const whoOk = (p: Place) =>
    whose === 'all' || (whose === 'together' ? !p.who : !p.who || p.who.split(' + ').includes(whose))
  const [edit, setEdit] = useState<Partial<Place> | null>(null)
  const [adding, setAdding] = useState(false)
  const [planning, setPlanning] = useState<Place | null>(null)
  // keep the id, not the row, so the card under the map shows live data (visited, edits, deletion)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const onPick = useCallback((p: Place) => setPickedId(p.id), [])
  const picked = rows.find((p) => p.id === pickedId) ?? null

  const cities = [...new Set(rows.map((p) => p.city).filter(Boolean))] as string[]
  cities.sort((a, b) => rank(a) - rank(b))
  const filtered = rows.filter((p) => whoOk(p) && (!city || p.city === city) && (!aud || p.audience === aud))
  // one tab per kind of place; transport only once something is filed under it
  const tabs = Object.fromEntries(
    Object.entries(PLACE_TABS).filter(([k]) => k !== 'transport' || rows.some((p) => p.category === k)),
  )
  const counts = Object.fromEntries(Object.keys(tabs).map((k) => [k, filtered.filter((p) => !k || p.category === k).length]))
  const shown = filtered.filter((p) => !cat || p.category === cat)
  const plannedIds = new Set(items.map((i) => i.place_id).filter(Boolean))

  // city → area → places
  const groups = new Map<string, Map<string, Place[]>>()
  for (const p of [...shown].sort((a, b) => rank(a.city) - rank(b.city) || Number(a.visited) - Number(b.visited))) {
    const c = p.city || 'אחר'
    if (!groups.has(c)) groups.set(c, new Map())
    const areas = groups.get(c)!
    const a = p.area || '—'
    areas.set(a, [...(areas.get(a) ?? []), p])
  }

  const planBusy = useRef(false)
  const autoPlan = async () => {
    // a second tap before the itinerary reloads would plan the same places again
    if (planBusy.current) return
    planBusy.current = true
    try {
      await runAutoPlan()
    } finally {
      planBusy.current = false
    }
  }
  const runAutoPlan = async () => {
    const { data: planned } = await supabase.from('itinerary_items').select('place_id').eq('trip_id', trip.id)
    const done = new Set((planned ?? []).map((i) => i.place_id))
    const plan = buildPlan(rows.filter((p) => !done.has(p.id)), days)
    if (!plan.rows.length) {
      alert('אין מקומות חדשים לשבץ' + (plan.skipped ? ` (${plan.skipped} בלי יום מתאים לעיר שלהם)` : ''))
      return
    }
    if (!confirm(`לשבץ ${plan.rows.length} מקומות בימים לפי עיר ושכונה?`)) return
    const ok = await mutate(supabase.from('itinerary_items').insert(plan.rows.map((r) => ({ ...r, trip_id: trip.id }))))
    if (ok) alert(`שובצו ${plan.rows.length} מקומות 🗓️` + (plan.skipped ? `\n${plan.skipped} לא שובצו – אין יום בעיר שלהם` : ''))
  }

  return (
    <div className="stack">
      <Tabs label="סוג מקום" tabs={tabs} current={tabs[cat] ? cat : ''} counts={counts} onPick={setCat} />
      <div className="segmented">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          📋 רשימה
        </button>
        <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
          🗺️ מפה
        </button>
      </div>
      {/* whose list, who it suits and which city, in one scrollable row */}
      <div className="chips scroll filters-row">
        {couples.length > 1 && (
          <>
            {/* my couple first */}
            {[...couples].sort((a, b) => Number(b === myCouple) - Number(a === myCouple)).map((c) => (
              <button key={c} className={'chip' + (whose === c ? ' on' : '')} onClick={() => setWhose(c)}>
                💑 {c === myCouple ? 'שלנו' : c}
              </button>
            ))}
            <button className={'chip' + (whose === 'together' ? ' on' : '')} onClick={() => setWhose('together')}>
              👥 רק של כולם
            </button>
            <button className={'chip' + (whose === 'all' ? ' on' : '')} onClick={() => setWhose('all')}>
              כל הזוגות
            </button>
            <span className="chip-sep" aria-hidden="true" />
          </>
        )}
        {Object.entries(AUDIENCES).map(([k, v]) => (
          <button key={k} className={'chip' + (aud === k ? ' on' : '')} onClick={() => setAud(aud === k ? '' : k)} aria-pressed={aud === k}>
            {v}
          </button>
        ))}
        <span className="chip-sep" aria-hidden="true" />
        {cities.map((c) => (
          <button key={c} className={'chip' + (city === c ? ' on' : '')} onClick={() => setCity(city === c ? '' : c)} aria-pressed={city === c}>
            {c}
          </button>
        ))}
      </div>

      {view === 'map' ? (
        <>
          <PlacesMap places={shown} onPick={onPick} />
          {picked && (
            <PlaceRow p={picked} planned={plannedIds.has(picked.id)} onEdit={setEdit} onPlan={setPlanning} />
          )}
          <p className="small muted">
            {shown.filter((p) => p.lat == null).length > 0 &&
              `${shown.filter((p) => p.lat == null).length} מקומות בלי מיקום לא מופיעים במפה · `}
            המיקומים מהסקאוטים משוערים – בדקו בגוגל מפות לפני שיוצאים
          </p>
        </>
      ) : (
        <>
          <button className="secondary" onClick={autoPlan}>
            🪄 סדרו לי את המקומות בימים
          </button>
          {error && <LoadNote onRetry={reload} />}
          {!loading && !error && shown.length === 0 && <Empty>אין עדיין מקומות – החליקו במשחק 🔥 כדי לקבל מאצ׳ים</Empty>}
          {[...groups].map(([c, areas]) => (
            <section key={c} className="stack">
              <h2 className="group-title">{c}</h2>
              {[...areas].map(([a, ps]) => (
                <div key={a} className="stack">
                  {a !== '—' && <div className="area-title" dir="auto">📍 {a}</div>}
                  {ps.map((p) => (
                    <PlaceRow key={p.id} p={p} planned={plannedIds.has(p.id)} onEdit={setEdit} onPlan={setPlanning} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      <button className="fab" aria-label="הוספת מקום" onClick={() => setAdding(true)}>
        ＋
      </button>
      {adding && <AddPlace tripId={trip.id} userId={userId} me={me} defaultTo="list" onClose={() => setAdding(false)} />}
      {edit && <PlaceForm tripId={trip.id} me={me} place={edit} onClose={() => setEdit(null)} />}
      {planning && <AddToDay trip={trip} place={planning} onClose={() => setPlanning(null)} />}
    </div>
  )
}

function PlaceRow(props: { p: Place; planned: boolean; onEdit: (p: Place) => void; onPlan: (p: Place) => void }) {
  const { p } = props
  const mapLink = p.url || (p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : mapsUrl(p.name + ' ' + (p.city ?? '')))
  return (
    <div className={'item card place-row' + (p.visited ? ' done' : '')}>
      <button
        className="check"
        aria-label="היינו"
        aria-pressed={p.visited}
        onClick={() => mutate(supabase.from('places').update({ visited: !p.visited }).eq('id', p.id))}
      >
        {p.visited ? '✓' : ''}
      </button>
      <Thumb photos={p.photos} emoji={CATEGORIES[p.category]?.split(' ')[0] ?? '📍'} />
      <div className="item-body" onClick={() => props.onEdit(p)}>
        <div className="item-title" dir="auto">
          {p.name}
        </div>
        <div className="muted small meta">
          {CATEGORIES[p.category]?.split(' ')[0]} {p.audience && AUDIENCES[p.audience].split(' ')[0]}{' '}
          {p.verdict && VERDICTS[p.verdict]?.label}
          {p.added_by && <> · <bdi>{p.added_by}</bdi></>}
          {p.who && <> · 💑 <bdi>{p.who}</bdi></>}
          {props.planned && ' · 🗓️ במסלול'}
        </div>
        {p.notes && (
          <div className="notes" dir="auto">
            {p.notes}
          </div>
        )}
        <MediaActions name={p.name} maps={p.url || null} m={{ ...p, lat: p.url ? null : p.lat, lng: p.url ? null : p.lng }} compact />
        {!p.url && p.lat == null && (
          <a className="action compact-link" href={mapLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            📍 <span>חיפוש במפות</span>
          </a>
        )}
      </div>
      <button className="icon" onClick={() => props.onPlan(p)} aria-label="הוספה למסלול">
        🗓️
      </button>
    </div>
  )
}

/**
 * Spread places over the days spent in their city: areas are ordered west→east so
 * neighbouring areas share a day, then cut into roughly equal per-day chunks.
 */
function buildPlan(places: Place[], days: DayInfo[]) {
  const rows: Partial<ItineraryItem>[] = []
  let skipped = 0
  const byCity = new Map<string, Place[]>()
  for (const p of places) byCity.set(p.city ?? '', [...(byCity.get(p.city ?? '') ?? []), p])

  for (const [city, ps] of byCity) {
    // Nara is a day trip: use the day whose notes mention it
    const inCity = days.filter((d) => d.city === city || (city === 'נארה' && d.notes?.includes('נארה')))
    for (const [who, wps] of groupBy(ps, (p) => p.who ?? '')) {
      // a group place needs everyone there; a couple's place fits any day that couple is in Japan
      const fits = (d: DayInfo) => !d.who || (!!who && who.split(' + ').every((c) => c === d.who))
      planCity(wps, inCity.filter(fits).map((d) => d.day))
    }
  }
  return { rows, skipped }

  function planCity(ps: Place[], cityDays: number[]) {
    if (!cityDays.length) {
      skipped += ps.length
      return
    }
    const areaLng = new Map<string, number>()
    for (const p of ps) if (p.lng != null && !areaLng.has(p.area ?? '')) areaLng.set(p.area ?? '', p.lng)
    const sorted = [...ps].sort(
      (a, b) =>
        (areaLng.get(a.area ?? '') ?? 999) - (areaLng.get(b.area ?? '') ?? 999) ||
        (a.area ?? '').localeCompare(b.area ?? ''),
    )
    const per = Math.ceil(sorted.length / cityDays.length)
    sorted.forEach((p, i) => {
      rows.push({
        day: cityDays[Math.min(Math.floor(i / per), cityDays.length - 1)],
        title: p.name,
        location: p.lat != null ? `${p.lat},${p.lng}` : `${p.name} ${p.city ?? ''}`,
        notes: p.notes,
        category: p.category,
        place_id: p.id,
        sort: 100 + i,
      })
    })
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}

function rank(city: string | null) {
  const i = CITY_ORDER.indexOf(city ?? '')
  return i === -1 ? 99 : i
}

function PlaceForm(props: { tripId: string; me: string; place: Partial<Place>; onClose: () => void }) {
  const [f, setF] = useState<Partial<Place>>(props.place)
  const set = (k: keyof Place) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.name?.trim()) return
    const row = {
      trip_id: props.tripId,
      name: f.name.trim(),
      city: f.city || null,
      area: f.area || null,
      category: f.category ?? 'other',
      audience: f.audience || null,
      url: f.url || null,
      notes: f.notes || null,
    }
    const ok = await mutate(
      f.id
        ? supabase.from('places').update(row).eq('id', f.id)
        : supabase.from('places').insert({ ...row, added_by: props.me }),
    )
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (f.id && confirm('למחוק?') && (await mutate(supabase.from('places').delete().eq('id', f.id)))) props.onClose()
  }

  return (
    <Sheet title={f.id ? 'עריכת מקום' : 'מקום חדש'} onClose={props.onClose}>
      <Field label="שם">
        <input value={f.name ?? ''} onChange={set('name')} dir="auto" autoFocus />
      </Field>
      <div className="row">
        <Field label="עיר">
          <input value={f.city ?? ''} onChange={set('city')} list="cities" />
        </Field>
        <Field label="שכונה">
          <input value={f.area ?? ''} onChange={set('area')} dir="auto" />
        </Field>
      </div>
      <Field label="סוג">
        <select value={f.category} onChange={set('category')}>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <datalist id="cities">
        {['טוקיו', 'קיוטו', 'אוסקה', 'נארה', 'הקונה', 'ניקו', 'הירושימה'].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Field label="למי זה מתאים?">
        <select value={f.audience ?? ''} onChange={set('audience')}>
          <option value="">—</option>
          {Object.entries(AUDIENCES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="קישור (Google Maps / אתר / טיקטוק)">
        <input type="url" value={f.url ?? ''} onChange={set('url')} dir="ltr" />
      </Field>
      <Field label="הערות">
        <textarea value={f.notes ?? ''} onChange={set('notes')} rows={3} />
      </Field>
      <button className="primary" onClick={save}>
        שמירה
      </button>
      {f.id && (
        <button className="danger" onClick={remove}>
          מחיקה
        </button>
      )}
    </Sheet>
  )
}

function AddToDay(props: { trip: Trip; place: Place; onClose: () => void }) {
  const [day, setDay] = useState(1)
  const [time, setTime] = useState('')
  const { rows: days } = useTripTable<DayInfo>('day_info', props.trip.id, 'day')

  const add = async () => {
    const p = props.place
    // a place on one couple's list is theirs; otherwise a day only one couple is in Japan is theirs, else everyone's
    const who = p.who ?? days.find((d) => d.day === day)?.who ?? null
    const ok = await mutate(
      supabase.from('itinerary_items').insert({
        trip_id: props.trip.id,
        day,
        time: time || null,
        title: p.name,
        location: p.lat != null ? `${p.lat},${p.lng}` : p.name + ' ' + (p.city ?? ''),
        notes: p.notes,
        category: p.category,
        place_id: p.id,
        who,
      }),
    )
    if (ok) props.onClose()
  }

  return (
    <Sheet title={`הוספת "${props.place.name}" למסלול`} onClose={props.onClose}>
      <div className="row">
        <Field label="יום">
          <select value={day} onChange={(e) => setDay(+e.target.value)}>
            {Array.from({ length: props.trip.num_days }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                יום {i + 1}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שעה (לא חובה)">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <button className="primary" onClick={add}>
        הוספה
      </button>
    </Sheet>
  )
}
