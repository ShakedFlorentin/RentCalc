import { useCallback, useState } from 'react'
import { supabase } from '../supabase'
import { CATEGORIES, VERDICTS, type DayInfo, type ItineraryItem, type Place, type Trip } from '../types'
import { mapsUrl, mutate, useTripTable } from '../lib'
import { Empty, Field, Sheet } from '../ui'
import PlacesMap from './PlacesMap'

const CITY_ORDER = ['טוקיו', 'קיוטו', 'נארה', 'אוסקה', 'טיול יום']

export default function Places({ trip, me }: { trip: Trip; me: string }) {
  const { rows, loading } = useTripTable<Place>('places', trip.id)
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<ItineraryItem>('itinerary_items', trip.id, 'sort')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [city, setCity] = useState('')
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<Partial<Place> | null>(null)
  const [planning, setPlanning] = useState<Place | null>(null)
  const [picked, setPicked] = useState<Place | null>(null)
  const onPick = useCallback((p: Place) => setPicked(p), [])

  const cities = [...new Set(rows.map((p) => p.city).filter(Boolean))] as string[]
  cities.sort((a, b) => rank(a) - rank(b))
  const shown = rows.filter((p) => (!city || p.city === city) && (!cat || p.category === cat))
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

  const autoPlan = async () => {
    const plan = buildPlan(rows.filter((p) => !plannedIds.has(p.id)), days)
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
      <div className="segmented">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          📋 רשימה
        </button>
        <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
          🗺️ מפה
        </button>
      </div>
      <div className="chips scroll">
        <button className={'chip' + (!city ? ' on' : '')} onClick={() => setCity('')}>
          כל הערים
        </button>
        {cities.map((c) => (
          <button key={c} className={'chip' + (city === c ? ' on' : '')} onClick={() => setCity(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="chips scroll">
        <button className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>
          הכל
        </button>
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <button key={k} className={'chip' + (cat === k ? ' on' : '')} onClick={() => setCat(k)}>
            {v}
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
          {!loading && shown.length === 0 && <Empty>אין עדיין מקומות – החליקו במשחק 🔥 כדי לקבל מאצ׳ים</Empty>}
          {[...groups].map(([c, areas]) => (
            <section key={c} className="stack">
              <h2 className="group-title">{c}</h2>
              {[...areas].map(([a, ps]) => (
                <div key={a} className="stack">
                  <div className="area-title">📍 {a}</div>
                  {ps.map((p) => (
                    <PlaceRow key={p.id} p={p} planned={plannedIds.has(p.id)} onEdit={setEdit} onPlan={setPlanning} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      <button className="fab" onClick={() => setEdit({ category: 'food', city: city || null })}>
        ＋
      </button>
      {edit && <PlaceForm tripId={trip.id} me={me} place={edit} onClose={() => setEdit(null)} />}
      {planning && <AddToDay trip={trip} place={planning} onClose={() => setPlanning(null)} />}
    </div>
  )
}

function PlaceRow(props: { p: Place; planned: boolean; onEdit: (p: Place) => void; onPlan: (p: Place) => void }) {
  const { p } = props
  const mapLink = p.url || (p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : mapsUrl(p.name + ' ' + (p.city ?? '')))
  return (
    <div className={'item card' + (p.visited ? ' done' : '')}>
      <button
        className="check"
        aria-label="היינו"
        onClick={() => mutate(supabase.from('places').update({ visited: !p.visited }).eq('id', p.id))}
      >
        {p.visited ? '✓' : ''}
      </button>
      <div className="item-body" onClick={() => props.onEdit(p)}>
        <div className="item-title" dir="auto">
          {p.name}
        </div>
        <div className="muted small">
          {CATEGORIES[p.category]?.split(' ')[0]} {p.verdict && VERDICTS[p.verdict]?.label}
          {p.added_by && ` · ${p.added_by}`}
          {props.planned && ' · 🗓️ במסלול'}
        </div>
        {p.notes && (
          <div className="notes" dir="auto">
            {p.notes}
          </div>
        )}
      </div>
      <div className="col">
        <a className="icon" href={mapLink} target="_blank" rel="noreferrer">
          🗺️
        </a>
        <button className="icon" onClick={() => props.onPlan(p)} aria-label="הוספה למסלול">
          🗓️
        </button>
      </div>
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
    const cityDays = days
      .filter((d) => d.city === city || (city === 'נארה' && d.notes?.includes('נארה')))
      .map((d) => d.day)
    if (!cityDays.length) {
      skipped += ps.length
      continue
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
  return { rows, skipped }
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

  const add = async () => {
    const p = props.place
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
