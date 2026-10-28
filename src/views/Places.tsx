import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { AUDIENCES, CATEGORIES, VERDICTS, type DayInfo, type GuidePlace, type ItineraryItem, type Member, type Place, type Trip } from '../types'
import { couplesOf, errorText, keepRanges, mapsUrl, mutate, normName, replan, safeUrl, useMediaIndex, useTripTable, withMedia } from '../lib'
import { BookOpen, CalendarCheck, CalendarPlus, Check, Heart, List, Map as MapIcon, MapPin, Plus, Users, Wand2 } from 'lucide-react'
import { Empty, Field, LoadNote, Sheet, useRemembered } from '../ui'
import { AUDIENCE_ICON, CATEGORY_ICON, Icon } from '../icons'
import '../styles/game.css'
import { MediaActions, Thumb } from '../media'
import PlacesMap from './PlacesMap'
import AddPlace from './AddPlace'

const PLACE_TABS: Record<string, string> = {
  '': 'הכל',
  food: 'אוכל',
  sight: 'אטרקציות',
  shopping: 'קניות',
  transport: 'תחבורה',
  other: 'אחר',
}

// the Ptitim map's folders, filed under the Places tabs
const GUIDE_TAB: Record<string, string> = { 'חנויות': 'shopping', 'איזורים ואתרים': 'sight' }
const guideTab = (g: GuidePlace) => GUIDE_TAB[g.folder] ?? 'food'
const guideCategory = (g: GuidePlace) =>
  g.folder === 'חנויות' ? 'shopping' : g.folder === 'איזורים ואתרים' ? 'sight' : g.folder.startsWith('קפה') ? 'cafe' : 'food'
const PTITIM_URL = 'https://www.ptitim.com/tokyoguide'

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
  const onPick = useCallback((p: Place) => {
    setPickedId(p.id)
    setGuidePick(null)
  }, [])
    // the Ptitim blog's Tokyo map as an optional layer, loaded the first time it's turned on
  const [showGuide, setShowGuide] = useRemembered('guideLayer', '')
  const [guide, setGuide] = useState<GuidePlace[]>([])
  const [guidePick, setGuidePick] = useState<GuidePlace | null>(null)
  const onPickGuide = useCallback((g: GuidePlace) => {
    setPickedId(null)
    setGuidePick(g)
  }, [])
  useEffect(() => {
    if (!showGuide || guide.length) return
    supabase
      .from('guide_places')
      .select('id, source, folder, name, note, lat, lng')
      .then(({ data }) => setGuide((data as GuidePlace[]) ?? []))
  }, [showGuide, guide.length])
  const guideShown = useMemo(() => {
    if (!showGuide || (city && city !== 'טוקיו')) return []
    const mine = new Set(rows.map((p) => p.name.toLowerCase()))
    return guide.filter((g) => (!cat || guideTab(g) === cat) && !mine.has(g.name.toLowerCase()))
  }, [showGuide, guide, city, rows, cat])

  const cities = [...new Set(rows.map((p) => p.city).filter(Boolean))] as string[]
  cities.sort((a, b) => rank(a) - rank(b))
  const filtered = rows.filter((p) => whoOk(p) && (!city || p.city === city) && (!aud || p.audience === aud))
  // one tab per kind of place; transport only once something is filed under it
  const tabs = Object.fromEntries(
    Object.entries(PLACE_TABS).filter(([k]) => k !== 'transport' || rows.some((p) => p.category === k)),
  )
  const counts = Object.fromEntries(Object.keys(tabs).map((k) => [k, filtered.filter((p) => !k || p.category === k).length]))
  const shown = filtered.filter((p) => !cat || p.category === cat)
  // the picked place only shows while the filters still let it through
  const picked = shown.find((p) => p.id === pickedId) ?? null
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

  // the planner runs by itself after every match and booking; this only asks it to run now
  const [replanned, setReplanned] = useState(false)
  const autoPlan = () => {
    replan(trip.id)
    setReplanned(true)
  }

  return (
    <div className="stack">
      <div className="tabs-bar" role="tablist" aria-label="סוג מקום">
        {Object.entries(tabs).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={(tabs[cat] ? cat : '') === k} className={'chip' + ((tabs[cat] ? cat : '') === k ? ' on' : '')} onClick={() => setCat(k)}>
            {CATEGORY_ICON[k] && <Icon as={CATEGORY_ICON[k]} />} {v}
            {!!counts[k] && <span className="count">{counts[k]}</span>}
          </button>
        ))}
      </div>
      <div className="segmented">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          <Icon as={List} /> רשימה
        </button>
        <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
          <Icon as={MapIcon} /> מפה
        </button>
      </div>
      {/* whose list, who it suits and which city, in one scrollable row */}
      <div className="chips scroll filters-row">
        {couples.length > 1 && (
          <>
            {/* my couple first */}
            {[...couples].sort((a, b) => Number(b === myCouple) - Number(a === myCouple)).map((c) => (
              <button key={c} className={'chip' + (whose === c ? ' on' : '')} onClick={() => setWhose(c)}>
                {c === myCouple ? 'שלנו' : c}
              </button>
            ))}
            <button className={'chip' + (whose === 'together' ? ' on' : '')} onClick={() => setWhose('together')}>
              רק של כולם
            </button>
            <button className={'chip' + (whose === 'all' ? ' on' : '')} onClick={() => setWhose('all')}>
              כל הזוגות
            </button>
            <span className="chip-sep" aria-hidden="true" />
          </>
        )}
        {Object.entries(AUDIENCES).map(([k, v]) => (
          <button key={k} className={'chip' + (aud === k ? ' on' : '')} onClick={() => setAud(aud === k ? '' : k)} aria-pressed={aud === k}>
            {AUDIENCE_ICON[k] && <Icon as={AUDIENCE_ICON[k]} />} {v}
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
          <PlacesMap places={shown} onPick={onPick} guide={guideShown} onPickGuide={onPickGuide} />
          <button className={'chip' + (showGuide ? ' on' : '')} aria-pressed={!!showGuide} onClick={() => setShowGuide(showGuide ? '' : '1')}>
            <Icon as={BookOpen} /> המפה של פתיתים {showGuide && guideShown.length ? `(${guideShown.length})` : ''}
          </button>
          {guidePick && !picked && (
            <GuideCard g={guidePick} tripId={trip.id} userId={userId} me={me} onClose={() => setGuidePick(null)} />
          )}
          {picked && (
            <PlaceRow p={picked} planned={plannedIds.has(picked.id)} onEdit={setEdit} onPlan={setPlanning} />
          )}
          <p className="small muted">
            {shown.filter((p) => p.lat == null).length > 0 &&
              `${shown.filter((p) => p.lat == null).length} מקומות בלי מיקום לא מופיעים במפה · `}
            המיקומים משוערים. בדקו בגוגל מפות לפני שיוצאים
          </p>
        </>
      ) : (
        <>
          <button className="secondary" onClick={autoPlan} disabled={replanned}>
            <Icon as={Wand2} /> {replanned ? 'המסלול מתעדכן, זה לוקח כמה שניות' : 'סידור המסלול מחדש'}
          </button>
          {error && <LoadNote onRetry={reload} />}
          {!loading && !error && shown.length === 0 && (
            <Empty>{rows.length ? 'אין מקומות בסינון הזה' : 'אין עדיין מקומות. מקומות שמקבלים מאצ׳ בגילוי מופיעים כאן'}</Empty>
          )}
          {[...groups].map(([c, areas]) => (
            <section key={c} className="stack">
              <h2 className="group-title">{c}</h2>
              {[...areas].map(([a, ps]) => (
                <div key={a} className="stack">
                  {a !== '—' && <div className="area-title"><Icon as={MapPin} /> <bdi>{a}</bdi></div>}
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
        <Icon as={Plus} size="1.5em" />
      </button>
      {adding && <AddPlace tripId={trip.id} userId={userId} me={me} defaultTo="list" onClose={() => setAdding(false)} />}
      {edit && <PlaceForm tripId={trip.id} me={me} place={edit} onClose={() => setEdit(null)} />}
      {planning && <AddToDay trip={trip} place={planning} onClose={() => setPlanning(null)} />}
    </div>
  )
}

function PlaceRow(props: { p: Place; planned: boolean; onEdit: (p: Place) => void; onPlan: (p: Place) => void }) {
  const { p } = props
  const mapLink = safeUrl(p.url) || mapsUrl([p.name, p.area, p.city].filter(Boolean).join(', '))
  return (
    <div className={'item card place-row' + (p.visited ? ' done' : '')}>
      <button
        className="check"
        aria-label="היינו"
        aria-pressed={p.visited}
        onClick={() => mutate(supabase.from('places').update({ visited: !p.visited }).eq('id', p.id))}
      >
        {p.visited ? <Icon as={Check} size="1em" strokeWidth={3} /> : null}
      </button>
      {/* without photos the square only repeats the category and squeezes the name and buttons */}
      {!!p.photos?.length && <Thumb photos={p.photos} icon={CATEGORY_ICON[p.category] ?? MapPin} />}
      <div className="item-body" onClick={() => props.onEdit(p)}>
        <div className="item-title" dir="auto">
          {p.name}
        </div>
        <div className="muted small meta">
          {[
            CATEGORIES[p.category],
            p.audience && AUDIENCES[p.audience],
            p.verdict && VERDICTS[p.verdict]?.label,
          ]
            .filter(Boolean)
            .join(' · ')}
          {p.added_by && <> · <bdi>{p.added_by.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').trim()}</bdi></>}
          {p.who && (
            <>
              {' · '}
              <Icon as={Users} /> <bdi>{p.who}</bdi>
            </>
          )}
        </div>
        {/* the baby line a match copies in is left to the place's own sheet: the row already says if it suits the baby */}
        {notesShown(p.notes) && (
          <div className="notes" dir="auto">
            {keepRanges(notesShown(p.notes)!)}
          </div>
        )}
        {/* one row of chips under the text, the plan button among them, so the name gets the card's width */}
        <MediaActions name={p.name} maps={p.url || null} m={{ ...p, lat: p.url ? null : p.lat, lng: p.url ? null : p.lng }} compact>
          {!p.url && p.lat == null && (
            <a className="action" href={mapLink} target="_blank" rel="noreferrer">
              <Icon as={MapPin} /> <span>מפה</span>
            </a>
          )}
          <button className="action" onClick={() => props.onPlan(p)}>
            <Icon as={props.planned ? CalendarCheck : CalendarPlus} /> <span>{props.planned ? 'במסלול' : 'למסלול'}</span>
          </button>
        </MediaActions>
      </div>
    </div>
  )
}

const notesShown = (notes: string | null) =>
  notes
    ?.split('\n')
    .filter((l) => !l.startsWith('עם התינוק:'))
    .join('\n')
    .trim() || null

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
        // a stand-in: the database puts the card's address here (trigger itinerary_item_address)
        location: [p.name, p.area, p.city].filter(Boolean).join(', '),
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

/** A place from the Ptitim map: Gal's note, a link, and a way to put it in the game. */
function GuideCard({ g, tripId, userId, me, onClose }: { g: GuidePlace; tripId: string; userId: string; me: string; onClose: () => void }) {
  const [state, setState] = useState<'' | 'busy' | 'added' | 'there'>('')
  useEffect(() => setState(''), [g.id])
  const suggest = async () => {
    setState('busy')
    const { data, error } = await supabase
      .from('candidates')
      .insert({
        trip_id: tripId,
        name: g.name,
        city: 'tokyo',
        category: guideCategory(g),
        lat: g.lat,
        lng: g.lng,
        hype: g.note ? 'גל מפתיתים: ' + g.note.replace(/\s*\n\s*/g, ' ') : null,
        sources: [PTITIM_URL],
        added_by: me,
      })
      .select('id')
      .single()
    // 23505: it's already in the game under the same name
    let id: string | undefined = data?.id
    if (error) {
      if (error.code !== '23505') {
        setState('')
        alert(errorText(error.message))
        return
      }
      // already in the game: find that card and like it, same as AddPlace's "same place"
      const { data: same } = await supabase.from('candidates').select('id, name').eq('trip_id', tripId).ilike('name', g.name.replace(/[%_\\]/g, '\\$&'))
      id = (same ?? []).find((c) => normName(c.name) === normName(g.name))?.id ?? same?.[0]?.id
      if (!id) {
        setState('there')
        return
      }
    }
    const { error: likeErr } = await supabase.from('swipes').upsert({ trip_id: tripId, candidate_id: id, user_id: userId, liked: true })
    if (likeErr) {
      setState('')
      alert(errorText(likeErr.message))
      return
    }
    setState(error ? 'there' : 'added')
  }
  return (
    <div className="card place-row stack">
      <div className="row">
        <b dir="auto">{g.name}</b>
        <span className="muted small">{g.folder}</span>
      </div>
      {g.note && <p dir="auto" className="small" style={{ whiteSpace: 'pre-line' }}>{g.note}</p>}
      <div className="row">
        <a className="chip" href={mapsUrl(g.name + ' Tokyo')} target="_blank" rel="noreferrer">
          <Icon as={MapPin} /> גוגל מפות
        </a>
        {state === 'added' ? (
          <span className="small">נוסף לגילוי עם הלייק שלך</span>
        ) : state === 'there' ? (
          <span className="small">כבר בגילוי, עם הלייק שלך</span>
        ) : (
          <button className="chip" disabled={state === 'busy'} onClick={suggest}>
            <Icon as={Heart} /> הוספה לגילוי
          </button>
        )}
        <button className="link small" onClick={onClose}>סגירה</button>
      </div>
      <a className="small muted" href={PTITIM_URL} target="_blank" rel="noreferrer">מתוך המדריך של פתיתים</a>
    </div>
  )
}
