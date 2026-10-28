import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { AUDIENCES, CATEGORIES, VERDICTS, type Candidate, type DayInfo, type GuidePlace, type ItineraryItem, type Member, type Place, type Trip } from '../types'
import { cityLabel, couplesOf, dayOption, errorText, keepRanges, mapsUrl, mutate, normName, replan, safeUrl, useMediaIndex, useTripTable, withMedia } from '../lib'
import { isEn, t } from '../i18n'
import { BookOpen, CalendarCheck, CalendarPlus, Check, Heart, List, Map as MapIcon, MapPin, Plus, Users, Wand2 } from 'lucide-react'
import { Empty, Field, LoadNote, Sheet, useRemembered } from '../ui'
import { AUDIENCE_ICON, CATEGORY_ICON, Icon } from '../icons'
import '../styles/game.css'
import { MediaActions, Thumb } from '../media'
import PlacesMap from './PlacesMap'
import AddPlace from './AddPlace'

const PLACE_TABS: Record<string, string> = {
  '': t('הכל'),
  food: t('אוכל'),
  sight: t('אטרקציות'),
  shopping: t('קניות'),
  transport: t('תחבורה'),
  other: t('אחר'),
}

// the Ptitim map's folders, filed under the Places tabs
const GUIDE_TAB: Record<string, string> = { 'חנויות': 'shopping', 'איזורים ואתרים': 'sight' } // he-only
const guideTab = (g: GuidePlace) => GUIDE_TAB[g.folder] ?? 'food'
const guideCategory = (g: GuidePlace) =>
  g.folder === 'חנויות' ? 'shopping' : g.folder === 'איזורים ואתרים' ? 'sight' : g.folder.startsWith('קפה') ? 'cafe' : 'food' // he-only
const PTITIM_URL = 'https://www.ptitim.com/tokyoguide'

const CITY_ORDER = ['טוקיו', 'קיוטו', 'נארה', 'אוסקה', 'טיולי יום', 'טיול יום'] // he-only

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
  // the raw card rows: a matched place's notes are copied from its card, and show in English from the card's `en`
  const { rows: cards } = useTripTable<Candidate>('candidates', trip.id)
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
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
    if (!showGuide || (city && city !== 'טוקיו')) return [] // he-only
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
  const noLocation = shown.filter((p) => p.lat == null).length

  // city → area → places
  const groups = new Map<string, Map<string, Place[]>>()
  for (const p of [...shown].sort((a, b) => rank(a.city) - rank(b.city) || Number(a.visited) - Number(b.visited))) {
    const c = p.city || 'אחר' // he-only
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
      <div className="tabs-bar" role="tablist" aria-label={t('סוג מקום')}>
        {Object.entries(tabs).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={(tabs[cat] ? cat : '') === k} className={'chip' + ((tabs[cat] ? cat : '') === k ? ' on' : '')} onClick={() => setCat(k)}>
            {CATEGORY_ICON[k] && <Icon as={CATEGORY_ICON[k]} />} {v}
            {!!counts[k] && <span className="count">{counts[k]}</span>}
          </button>
        ))}
      </div>
      <div className="segmented">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          <Icon as={List} /> {t('רשימה')}
        </button>
        <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
          <Icon as={MapIcon} /> {t('מפה')}
        </button>
      </div>
      {/* whose list, who it suits and which city, in one scrollable row */}
      <div className="chips scroll filters-row">
        {couples.length > 1 && (
          <>
            {/* my couple first */}
            {[...couples].sort((a, b) => Number(b === myCouple) - Number(a === myCouple)).map((c) => (
              <button key={c} className={'chip' + (whose === c ? ' on' : '')} onClick={() => setWhose(c)}>
                {c === myCouple ? t('שלנו') : t(c)}
              </button>
            ))}
            <button className={'chip' + (whose === 'together' ? ' on' : '')} onClick={() => setWhose('together')}>
              {t('של כולם')}
            </button>
            <button className={'chip' + (whose === 'all' ? ' on' : '')} onClick={() => setWhose('all')}>
              {t('כל הזוגות')}
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
            {cityLabel(c)}
          </button>
        ))}
      </div>

      {view === 'map' ? (
        <>
          <PlacesMap places={shown} onPick={onPick} guide={guideShown} onPickGuide={onPickGuide} />
          <button className={'chip' + (showGuide ? ' on' : '')} aria-pressed={!!showGuide} onClick={() => setShowGuide(showGuide ? '' : '1')}>
            <Icon as={BookOpen} /> {t('המפה של פתיתים')} {showGuide && guideShown.length ? `(${guideShown.length})` : ''}
          </button>
          {guidePick && !picked && (
            <GuideCard g={guidePick} tripId={trip.id} userId={userId} me={me} onClose={() => setGuidePick(null)} />
          )}
          {picked && (
            <PlaceRow p={picked} card={picked.candidate_id ? cardById.get(picked.candidate_id) : undefined} planned={plannedIds.has(picked.id)} onEdit={setEdit} onPlan={setPlanning} />
          )}
          <p className="small muted">
            {noLocation > 0 &&
              `${noLocation === 1 ? t('מקום אחד בלי מיקום לא מופיע במפה') : t('{n} מקומות בלי מיקום לא מופיעים במפה', { n: noLocation })} · `}
            {t('המיקומים משוערים, כדאי לבדוק בגוגל מפות')}
          </p>
        </>
      ) : (
        <>
          <button className="secondary" onClick={autoPlan} disabled={replanned}>
            <Icon as={Wand2} /> {replanned ? t('מעדכנים את המסלול, כמה שניות…') : t('סידור המסלול מחדש')}
          </button>
          {error && <LoadNote onRetry={reload} />}
          {!loading && !error && shown.length === 0 && (
            <Empty>{rows.length ? t('אין מקומות בסינון הזה') : t('עוד אין מקומות. מקום שקיבל מאצ׳ בגילוי יופיע כאן')}</Empty>
          )}
          {[...groups].map(([c, areas]) => (
            <section key={c} className="stack">
              <h2 className="group-title">{cityLabel(c)}</h2>
              {[...areas].map(([a, ps]) => (
                <div key={a} className="stack">
                  {a !== '—' && <div className="area-title"><Icon as={MapPin} /> <bdi>{a}</bdi></div>}
                  {ps.map((p) => (
                    <PlaceRow key={p.id} p={p} card={p.candidate_id ? cardById.get(p.candidate_id) : undefined} planned={plannedIds.has(p.id)} onEdit={setEdit} onPlan={setPlanning} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      <button className="fab" aria-label={t('הוספת מקום')} onClick={() => setAdding(true)}>
        <Icon as={Plus} size="1.5em" />
      </button>
      {adding && <AddPlace tripId={trip.id} userId={userId} me={me} defaultTo="list" onClose={() => setAdding(false)} />}
      {edit && <PlaceForm tripId={trip.id} me={me} place={edit} card={edit.candidate_id ? cardById.get(edit.candidate_id) : undefined} onClose={() => setEdit(null)} />}
      {planning && (
        <AddToDay
          trip={trip}
          place={planning}
          card={planning.candidate_id ? cardById.get(planning.candidate_id) : undefined}
          onClose={() => setPlanning(null)}
        />
      )}
    </div>
  )
}

function PlaceRow(props: { p: Place; card?: Candidate; planned: boolean; onEdit: (p: Place) => void; onPlan: (p: Place) => void }) {
  const { p } = props
  const mapLink = safeUrl(p.url) || mapsUrl([p.name, p.area, p.city].filter(Boolean).join(', '))
  return (
    <div className={'item card place-row' + (p.visited ? ' done' : '')}>
      <button
        className="check"
        aria-label={t('היינו')}
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
          {p.added_by && <> · <bdi>{t(p.added_by.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').trim())}</bdi></>}
          {p.who && (
            <>
              {' · '}
              <Icon as={Users} /> <bdi>{p.who.split(' + ').map((w) => t(w)).join(' + ')}</bdi>
            </>
          )}
        </div>
        {/* the baby line a match copies in is left to the place's own sheet: the row already says if it suits the baby */}
        {notesShown(notesFor(p.notes, props.card)) && (
          <div className="notes" dir="auto">
            {keepRanges(notesShown(notesFor(p.notes, props.card))!)}
          </div>
        )}
        {/* one row of chips under the text, the plan button among them, so the name gets the card's width */}
        <MediaActions name={p.name} maps={p.url || null} m={{ ...p, lat: p.url ? null : p.lat, lng: p.url ? null : p.lng }} compact>
          {!p.url && p.lat == null && (
            <a className="action" href={mapLink} target="_blank" rel="noreferrer">
              <Icon as={MapPin} /> <span>{t('מפה')}</span>
            </a>
          )}
          <button className="action" onClick={() => props.onPlan(p)}>
            <Icon as={props.planned ? CalendarCheck : CalendarPlus} /> <span>{props.planned ? t('במסלול') : t('למסלול')}</span>
          </button>
        </MediaActions>
      </div>
    </div>
  )
}

// the baby line a match copies from its card into the place's notes: "<tip>\nעם התינוק: <baby notes>"
const BABY_HE = 'עם התינוק:' // he-only
const BABY_EN = 'With the baby:'

/**
 * A place's notes in the app's language. Notes a match copied from its card (exactly the card's Hebrew tip and baby
 * line) show in English from the card's `en`; notes people wrote themselves show as written.
 */
function notesFor(notes: string | null | undefined, card?: Candidate) {
  return (isEn && notesEn(notes, card)) || (notes ?? null)
}

/** The English of notes a match copied from the card; null for notes people wrote (or a card without English). */
function notesEn(notes: string | null | undefined, card?: Candidate) {
  if (!notes || !card?.en) return null
  const he = [card.tip, card.baby_notes && BABY_HE + ' ' + card.baby_notes].filter(Boolean).join('\n')
  if (notes !== he) return null
  const tip = card.en.tip ?? card.tip
  const baby = card.en.baby_notes ?? card.baby_notes
  return [tip, baby && BABY_EN + ' ' + baby].filter(Boolean).join('\n') || null
}

const notesShown = (notes: string | null) =>
  notes
    ?.split('\n')
    .filter((l) => !l.startsWith(BABY_HE) && !l.startsWith(BABY_EN))
    .join('\n')
    .trim() || null

function rank(city: string | null) {
  const i = CITY_ORDER.indexOf(city ?? '')
  return i === -1 ? 99 : i
}

function PlaceForm(props: { tripId: string; me: string; place: Partial<Place>; card?: Candidate; onClose: () => void }) {
  // in English a matched place's copied notes show in English; untouched, they are saved back as they were
  const [shownNotes] = useState(() => notesFor(props.place.notes, props.card))
  const [f, setF] = useState<Partial<Place>>({ ...props.place, notes: shownNotes })
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
      notes: (f.notes === shownNotes ? props.place.notes : f.notes) || null,
    }
    const ok = await mutate(
      f.id
        ? supabase.from('places').update(row).eq('id', f.id)
        : supabase.from('places').insert({ ...row, added_by: props.me }),
    )
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (f.id && confirm(t('למחוק?')) && (await mutate(supabase.from('places').delete().eq('id', f.id)))) props.onClose()
  }

  return (
    <Sheet title={f.id ? t('עריכת מקום') : t('מקום חדש')} onClose={props.onClose}>
      <Field label={t('שם')}>
        <input value={f.name ?? ''} onChange={set('name')} dir="auto" autoFocus />
      </Field>
      <div className="row">
        <Field label={t('עיר')}>
          <input value={f.city ?? ''} onChange={set('city')} list="cities" />
        </Field>
        <Field label={t('שכונה')}>
          <input value={f.area ?? ''} onChange={set('area')} dir="auto" />
        </Field>
      </div>
      <Field label={t('סוג')}>
        <select value={f.category} onChange={set('category')}>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <datalist id="cities">
        {['טוקיו', 'קיוטו', 'אוסקה', 'נארה', 'הקונה', 'ניקו', 'הירושימה'].map((c) => ( // he-only
          <option key={c} value={c} label={isEn ? cityLabel(c) : undefined} />
        ))}
      </datalist>
      <Field label={t('למי זה מתאים?')}>
        <select value={f.audience ?? ''} onChange={set('audience')}>
          <option value="">—</option>
          {Object.entries(AUDIENCES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('קישור (Google Maps / אתר / טיקטוק)')}>
        <input type="url" value={f.url ?? ''} onChange={set('url')} dir="ltr" />
      </Field>
      <Field label={t('הערות')}>
        <textarea value={f.notes ?? ''} onChange={set('notes')} rows={3} />
      </Field>
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

function AddToDay(props: { trip: Trip; place: Place; card?: Candidate; onClose: () => void }) {
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
        // the same notes in English, for whoever uses the app in English
        notes_en: notesEn(p.notes, props.card),
        category: p.category,
        place_id: p.id,
        who,
      }),
    )
    if (ok) props.onClose()
  }

  return (
    <Sheet title={t('הוספת "{name}" למסלול', { name: props.place.name })} onClose={props.onClose}>
      <div className="row">
        <Field label={t('יום')}>
          <select value={day} onChange={(e) => setDay(+e.target.value)}>
            {Array.from({ length: props.trip.num_days }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {dayOption(props.trip.start_date, i + 1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('שעה (לא חובה)')}>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <button className="primary" onClick={add}>
        {t('הוספה')}
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
        hype: g.note ? 'גל מפתיתים: ' + g.note.replace(/\s*\n\s*/g, ' ') : null, // he-only
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
        <span className="muted small">{t(g.folder)}</span>
      </div>
      {g.note && <p dir="auto" className="small" style={{ whiteSpace: 'pre-line' }}>{g.note}</p>}
      <div className="row">
        <a className="chip" href={mapsUrl(g.name + ' Tokyo')} target="_blank" rel="noreferrer">
          <Icon as={MapPin} /> {t('גוגל מפות')}
        </a>
        {state === 'added' ? (
          <span className="small">{t('נוסף לגילוי עם הלייק שלך')}</span>
        ) : state === 'there' ? (
          <span className="small">{t('כבר בגילוי, עם הלייק שלך')}</span>
        ) : (
          <button className="chip" disabled={state === 'busy'} onClick={suggest}>
            <Icon as={Heart} /> {t('הוספה לגילוי')}
          </button>
        )}
        <button className="link small" onClick={onClose}>{t('סגירה')}</button>
      </div>
      <a className="small muted" href={PTITIM_URL} target="_blank" rel="noreferrer">{t('מתוך המדריך של פתיתים')}</a>
    </div>
  )
}
