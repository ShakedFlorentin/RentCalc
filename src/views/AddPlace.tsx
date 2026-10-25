import { useState } from 'react'
import { supabase } from '../supabase'
import { AUDIENCES, CARD_STYLE, CITY_HE, VERDICTS, type Candidate } from '../types'
import { aiError, mutate, safeUrl, samePlace } from '../lib'
import { ArrowRight, Heart, List, PencilLine, Search, Star } from 'lucide-react'
import { Field, Sheet } from '../ui'
import { Icon } from '../icons'

type Draft = Partial<Candidate> & { link?: string }
/** A place already in the trip that looks like the one being added. */
type Existing = { id: string; name: string; where: 'deck' | 'list'; exact: boolean }
type Row = { id: string; name: string; lat: number | null; lng: number | null }
type TripPlaces = { deck: Row[]; list: Row[] }

function existingIn(trip: TripPlaces, d: Draft): Existing | null {
  const probe = { name: d.name ?? '', lat: d.lat, lng: d.lng }
  // the game card first: on a tie, "same place" should like it
  let best: Existing | null = null
  for (const [rows, where] of [[trip.deck, 'deck'], [trip.list, 'list']] as const) {
    for (const r of rows) {
      const hit = samePlace(probe, r)
      if (hit && (!best || (hit === 'exact' && !best.exact))) best = { id: r.id, name: r.name, where, exact: hit === 'exact' }
    }
  }
  return best
}

type Props = { tripId: string; userId: string; me: string; defaultTo: 'deck' | 'list'; onClose: () => void }

/** Suggest a place from an Instagram/TikTok/Maps link (researched by Claude) or by hand. */
export default function AddPlace({ tripId, userId, me, defaultTo, onClose }: Props) {
  const [mode, setMode] = useState<'link' | 'manual'>('link')
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [to, setTo] = useState(defaultTo)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // what was typed when the duplicate sheet opened, so going back to edit doesn't lose it
  const [typed, setTyped] = useState<Draft | null>(null)
  const [existing, setExisting] = useState<{ found: Existing; draft: Draft } | null>(null)
  // a post that names several places: each with what's already in the trip, and whether it's ticked
  const [many, setMany] = useState<{ d: Draft; found: Existing | null; on: boolean }[] | null>(null)

  /** The trip's places, in the game and on the list, to check new ones against. */
  const loadTrip = async (): Promise<TripPlaces> => {
    const [deck, list] = await Promise.all([
      supabase.from('candidates').select('id, name, lat, lng').eq('trip_id', tripId),
      supabase.from('places').select('id, name, lat, lng, candidate_id, added_by').eq('trip_id', tripId),
    ])
    // hidden demo rows (no candidate, no author) aren't on anyone's list, same rule as the Places view
    const visible = (list.data ?? []).filter((p) => p.candidate_id || p.added_by)
    return { deck: deck.data ?? [], list: visible }
  }
  /** The trip's own copy of this place, in the game or on the list, if someone already added it. */
  const findExisting = async (d: Draft, trip?: TripPlaces) => existingIn(trip ?? (await loadTrip()), d)

  /** "It's the same place": in the game, suggesting it means liking it; on the list there's nothing to add. */
  const useExisting = async (e: Existing) => {
    setBusy(true)
    if (e.where === 'deck') {
      await mutate(supabase.from('swipes').upsert({ trip_id: tripId, candidate_id: e.id, user_id: userId, liked: true }))
    }
    setBusy(false)
    onClose()
  }

  const research = async () => {
    if (!link.trim() && !note.trim()) return
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.functions.invoke('suggest-place', { body: { link: link.trim(), text: note.trim() } })
    setBusy(false)
    if (error || !data) {
      setErr(await aiError(error, 'החיפוש לא הצליח. אפשר לנסות שוב או למלא ידנית.'))
      return
    }
    // older function versions return one place; newer ones a list
    const found: Draft[] = ((data.places ?? (data.found ? [data] : [])) as Draft[]).map((p) => ({ ...p, link: link.trim() }))
    if (found.length > 1) {
      const trip = await loadTrip()
      setMany(found.map((d) => {
        const ex = existingIn(trip, d)
        return { d, found: ex, on: !ex || ex.where === 'deck' }
      }))
      return
    }
    if (!found.length) setErr('לא זוהה מקום מסוים. בדקו את הפרטים או השלימו ידנית.')
    setDraft(found[0] ?? { found: false, link: link.trim(), city: 'tokyo', category: 'food', audience: 'baby' } as Draft)
  }

  /** Adds the ticked places; ones already in the game get my like, ones already on the list are skipped. */
  const addMany = async () => {
    if (!many) return
    setBusy(true)
    const trip = await loadTrip()
    setErr('')
    let done = 0
    for (const m of many.filter((x) => x.on)) {
      const ex = existingIn(trip, m.d)
      if (ex) {
        if (ex.where === 'deck') {
          const { error } = await supabase.from('swipes').upsert({ trip_id: tripId, candidate_id: ex.id, user_id: userId, liked: true })
          if (!error) done++
        }
        continue
      }
      if ((await insertDraft(m.d)) === 'ok') done++
    }
    setBusy(false)
    if (done) onClose()
    else setErr('לא נוסף אף מקום. הם כבר ברשימה או שהשמירה לא הצליחה, אפשר לנסות שוב.')
  }

  const save = async (d: Draft, anyway = false) => {
    if (!d.name?.trim() || !d.city) return
    setBusy(true)
    setErr('')
    // two friends often add the same place: offer the one that's there instead of a second copy
    if (!anyway) {
      const found = await findExisting(d)
      if (found) {
        setTyped(d)
        setExisting({ found, draft: d })
        setBusy(false)
        return
      }
    }
    const res = await insertDraft(d)
    if (res === 'dup') {
      const found = await findExisting(d)
      if (found) {
        setTyped(d)
        setExisting({ found, draft: d })
      } else setErr('כבר יש מקום בשם הזה בטיול')
    }
    setBusy(false)
    if (res === 'ok') onClose()
  }

  /** Writes one place to the game (with my like) or straight to the list. */
  const insertDraft = async (d: Draft): Promise<'ok' | 'dup' | 'error'> => {
    if (!d.name?.trim() || !d.city) return 'error'
    // only http(s) links are stored: the rest would end up as clickable hrefs
    const l = safeUrl(d.link) ?? null
    const social = {
      instagram_url: l && /instagram\.com/i.test(l) ? l : null,
      tiktok_url: l && /tiktok\.com/i.test(l) ? l : null,
      maps_url: l && /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(l) ? l : null,
    }
    const base = {
      trip_id: tripId,
      name: d.name.trim(),
      area: d.area || null,
      lat: d.lat ?? null,
      lng: d.lng ?? null,
      verdict: d.verdict ?? null,
      audience: d.audience ?? null,
      added_by: me,
    }
    if (to === 'deck') {
      const { data, error } = await supabase
        .from('candidates')
        .insert({
          ...base,
          ...social,
          name_ja: d.name_ja || null,
          city: d.city,
          category: d.category ?? 'food',
          hype: d.hype || null,
          reality: d.reality || null,
          tabelog_score: d.tabelog_score ?? null,
          google_score: d.google_score ?? null,
          price: d.price || null,
          tip: d.tip || null,
          baby_notes: d.baby_notes || null,
          serves: d.serves || null,
          dishes: d.dishes?.length ? d.dishes : null,
          todo: d.todo || null,
          special: d.special || null,
          highlights: d.highlights?.length ? d.highlights : null,
          time_needed: d.time_needed || null,
          kosher: d.kosher ?? null,
          kosher_note: d.kosher_note || null,
          sources: d.sources ? d.sources.filter((u) => safeUrl(u)) : l ? [l] : [],
        })
        .select('id')
        .single()
      // 23505: someone added the same name a moment ago
      if (error?.code === '23505') return 'dup'
      if (error) {
        alert('שגיאה: ' + error.message)
        return 'error'
      }
      // suggesting a place counts as liking it
      await supabase.from('swipes').insert({ trip_id: tripId, candidate_id: data.id, user_id: userId, liked: true })
      return 'ok'
    } else {
      const cat = d.category === 'cafe' ? 'food' : ['food', 'sight', 'shopping'].includes(d.category ?? '') ? d.category : 'other'
      const { error } = await supabase.from('places').insert({
          ...base,
          instagram_url: social.instagram_url,
          tiktok_url: social.tiktok_url,
          city: CITY_HE[d.city] ?? d.city,
          category: cat,
          url: social.maps_url,
          notes: [d.tip, d.baby_notes && 'עם התינוק: ' + d.baby_notes].filter(Boolean).join('\n') || null,
        })
      if (error?.code === '23505') return 'dup'
      if (error) {
        alert('שגיאה: ' + error.message)
        return 'error'
      }
      return 'ok'
    }
  }

  const destination = (
    <div className="segmented" role="group" aria-label="לאן להוסיף">
      <button className={to === 'deck' ? 'on' : ''} onClick={() => setTo('deck')}>
        <Icon as={Heart} /> למשחק, להצבעה
      </button>
      <button className={to === 'list' ? 'on' : ''} onClick={() => setTo('list')}>
        <Icon as={List} /> ישר לרשימה
      </button>
    </div>
  )

  if (existing) {
    const { found, draft: d } = existing
    return (
      <Sheet title="כבר קיים בטיול" onClose={onClose}>
        <p>
          <b dir="auto">{found.name}</b> {found.where === 'deck' ? 'כבר במשחק.' : 'כבר ברשימת המקומות.'}
          {!found.exact && ' נראה שזה אותו מקום.'}
        </p>
        <button className="primary" onClick={() => useExisting(found)} disabled={busy}>
          {found.where === 'deck' ? (
            <>
              <Icon as={Heart} /> זה אותו מקום, לסמן לייק
            </>
          ) : (
            'זה אותו מקום, סגירה'
          )}
        </button>
        {!found.exact && (
          <button className="secondary" onClick={() => (setExisting(null), save(d, true))} disabled={busy}>
            זה מקום אחר, להוסיף בכל זאת
          </button>
        )}
        <button className="link" onClick={() => setExisting(null)}>
          חזרה לעריכה
        </button>
      </Sheet>
    )
  }

  if (many) {
    // ticked places already on the list are skipped, so they don't count
    const picked = many.filter((m) => m.on && m.found?.where !== 'list').length
    return (
      <Sheet title={`נמצאו ${many.length} מקומות`} onClose={onClose}>
        <p className="muted small">מסמנים את המקומות להוסיף. מקום שכבר קיים בטיול לא יתווסף שוב; אם הוא במשחק, יסומן לך לייק.</p>
        <div className="stack">
          {many.map((m, i) => {
            const style = CARD_STYLE[m.d.category ?? ''] ?? CARD_STYLE.sight
            const verdict = m.d.verdict ? VERDICTS[m.d.verdict] : null
            return (
              <label key={i} className="card pick-row">
                <input
                  type="checkbox"
                  checked={m.on}
                  onChange={() => setMany(many.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                />
                <span className="pick-body">
                  <b dir="auto">{m.d.name}</b>
                  <span className="muted small">
                    {[CITY_HE[m.d.city ?? ''], m.d.area, style.label].filter(Boolean).join(' · ')}
                  </span>
                  {(m.d.serves || m.d.todo || m.d.reality) && (
                    <span className="small clamp" dir="auto">
                      {m.d.serves || m.d.todo || m.d.reality}
                    </span>
                  )}
                  <span className="row">
                    {verdict && <span className={'verdict ' + verdict.tone}>{verdict.label}</span>}
                    {m.found && (
                      <span className="verdict meh">{m.found.where === 'deck' ? 'כבר במשחק' : 'כבר ברשימה'}</span>
                    )}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        {err && <p className="msg">{err}</p>}
        {destination}
        <button className="primary" onClick={addMany} disabled={busy || !picked}>
          {busy ? 'מוסיף…' : picked === 1 ? 'הוספת מקום אחד' : `הוספת ${picked} מקומות`}
        </button>
        <button className="link" onClick={() => (setErr(''), setMany(null))}>
          <Icon as={ArrowRight} /> חזרה
        </button>
      </Sheet>
    )
  }

  if (draft || mode === 'manual') {
    return (
      <Sheet title={draft ? 'זה המקום?' : 'הוספת מקום'} onClose={onClose}>
        <DraftForm
          draft={typed ?? draft ?? { city: 'tokyo', category: 'food', audience: 'baby', link: '' }}
          researched={!!draft}
          busy={busy}
          err={err}
          destination={destination}
          onSave={save}
          onBack={() => (setTyped(null), draft ? setDraft(null) : setMode('link'))}
        />
      </Sheet>
    )
  }

  return (
    <Sheet title="הצעת מקום" onClose={onClose}>
      <p className="muted small">
        הדביקו קישור מאינסטגרם, טיקטוק או גוגל מפות, או כתבו שם של מקום. המערכת מזהה את המקום ובודקת דירוג, כתובת והתאמה
        לתינוק.
      </p>
      <Field label="קישור">
        <input type="url" value={link} onChange={(e) => setLink(e.target.value)} dir="ltr" placeholder="https://www.instagram.com/reel/…" />
      </Field>
      <Field label="או שם / הערה (לא חובה)">
        <input value={note} onChange={(e) => setNote(e.target.value)} dir="auto" placeholder="למשל: הראמן מהסרטון, בשינג׳וקו" />
      </Field>
      {err && <p className="msg">{err}</p>}
      <button className="primary" onClick={research} disabled={busy || (!link.trim() && !note.trim())}>
        {busy ? 'מחפש פרטים, עד דקה' : (<><Icon as={Search} /> זיהוי ובדיקה</>)}
      </button>
      <button className="link" onClick={() => setMode('manual')}>
        <Icon as={PencilLine} /> הוספה ידנית
      </button>
    </Sheet>
  )
}

function DraftForm(props: {
  draft: Draft
  researched: boolean
  busy: boolean
  err: string
  destination: React.ReactNode
  onSave: (d: Draft) => void
  onBack: () => void
}) {
  const [d, setD] = useState<Draft>(props.draft)
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  const verdict = d.verdict ? VERDICTS[d.verdict] : null

  return (
    <>
      {props.err && <p className="msg">{props.err}</p>}
      {props.researched && (verdict || d.tabelog_score != null || d.google_score != null) && (
        <div className="row">
          {verdict && <span className={'verdict ' + verdict.tone}>{verdict.label}</span>}
          {d.tabelog_score != null && <span className="small muted">Tabelog <Icon as={Star} /> <bdi>{d.tabelog_score}</bdi></span>}
          {d.google_score != null && <span className="small muted">Google <Icon as={Star} /> <bdi>{d.google_score}</bdi></span>}
        </div>
      )}
      <Field label="שם">
        <input value={d.name ?? ''} onChange={set('name')} dir="auto" autoFocus={!props.researched} />
      </Field>
      <div className="row">
        <Field label="עיר">
          <select value={d.city} onChange={set('city')}>
            {Object.entries(CITY_HE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שכונה">
          <input value={d.area ?? ''} onChange={set('area')} dir="auto" />
        </Field>
      </div>
      <div className="row">
        <Field label="סוג">
          <select value={d.category} onChange={set('category')}>
            {Object.entries(CARD_STYLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="למי">
          <select value={d.audience ?? ''} onChange={set('audience')}>
            {Object.entries(AUDIENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {props.researched && d.serves && (
        <div className="small">
          <b>מה מגישים:</b> <span dir="auto">{d.serves}</span>
        </div>
      )}
      {props.researched && d.kosher_note && (
        <div className="small">
          <b>כשרות:</b> <span dir="auto">{d.kosher_note}</span>
        </div>
      )}
      {props.researched && d.todo && (
        <div className="small">
          <b>מה עושים שם:</b> <span dir="auto">{d.todo}</span>
        </div>
      )}
      {props.researched && d.special && (
        <div className="small">
          <b>מה מיוחד:</b> <span dir="auto">{d.special}</span>
        </div>
      )}
      {props.researched && d.reality && (
        <div className="small">
          <b>בביקורות:</b> <span dir="auto">{d.reality}</span>
        </div>
      )}
      {props.researched && d.baby_notes && (
        <div className="small">
          <b>עם תינוק:</b> <span dir="auto">{d.baby_notes}</span>
        </div>
      )}
      <Field label="טיפ / הערה">
        <textarea value={d.tip ?? ''} onChange={set('tip')} rows={2} dir="auto" />
      </Field>
      {!props.researched && (
        <Field label="קישור (אינסטגרם, טיקטוק או מפות, לא חובה)">
          <input type="url" value={d.link ?? ''} onChange={set('link')} dir="ltr" />
        </Field>
      )}
      {props.destination}
      <button className="primary" onClick={() => props.onSave(d)} disabled={props.busy || !d.name?.trim()}>
        {props.busy ? 'שומר…' : 'הוספה'}
      </button>
      <button className="link" onClick={props.onBack}>
        <Icon as={ArrowRight} /> חזרה
      </button>
    </>
  )
}
