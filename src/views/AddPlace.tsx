import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { AUDIENCES, CARD_STYLE, CITY_HE, VERDICTS, type Candidate } from '../types'
import { aiError, cityLabel, localizeCard, mutate, safeUrl, samePlace, useTripAvoidsPorkSeafood, useTripHasBaby } from '../lib'
import { isEn, t } from '../i18n'
import { ArrowRight, Check, Heart, List, LoaderCircle, Search, Star, X } from 'lucide-react'
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

/**
 * The places a lookup found, read from place_lookups: the search keeps running when the phone stops waiting, so the
 * answer can be there although the request failed. Waits up to two minutes while it is still running.
 */
async function savedResult(id: string): Promise<Draft[] | undefined> {
  const start = Date.now()
  let seen = false
  while (Date.now() - start < 120_000) {
    const { data } = await supabase.from('place_lookups').select('status, places').eq('id', id).maybeSingle()
    if (data?.status === 'done') return (data.places as Draft[] | null) ?? []
    if (data?.status === 'failed') return undefined
    if (data) seen = true
    // still no row after ten seconds: the request never reached the search
    else if (!seen && Date.now() - start > 10_000) return undefined
    await new Promise((r) => setTimeout(r, 3000))
  }
  return undefined
}

/** A place as the lookup's progress names it (see suggest-place): a card's area comes with its city apart. */
type Spot = { name: string; where: string; city?: string }
/** One line of the lookup's progress stream, sent by suggest-place as each step learns something. */
type Step =
  | { type: 'read'; source: 'instagram' | 'tiktok' | 'maps' | 'link'; excerpt: string; slides: number }
  | { type: 'search'; query: string }
  | { type: 'researched'; searches: number }
  | { type: 'found'; places: Spot[] }
  | ({ type: 'card'; i: number; ok: boolean } & Spot)
  | { type: 'cached'; places: Spot[] }
  | { type: 'done'; places: Draft[] }
  | { type: 'error'; error: string; status: number }
/** What the lookup has told so far. */
type Progress = {
  link: boolean
  read?: Extract<Step, { type: 'read' }>
  searches: string[]
  researched?: number
  found?: Spot[]
  // by the place's index in found
  cards: ({ ok: boolean } & Spot)[]
  cached?: Spot[]
}

function heard(p: Progress, e: Step): Progress {
  switch (e.type) {
    case 'read':
      return { ...p, read: e }
    case 'search':
      return { ...p, searches: [...p.searches, e.query] }
    case 'researched':
      return { ...p, researched: e.searches }
    case 'found':
      return { ...p, found: e.places }
    case 'card': {
      const cards = [...p.cards]
      cards[e.i] = e
      return { ...p, cards }
    }
    case 'cached':
      return { ...p, cached: e.places }
  }
  return p
}

/** The lookup's answer in the shape supabase.functions.invoke gives it, so both ways are read alike. */
type Answer = { data: { places?: Draft[] } | null; error: { context?: Response } | null }

/**
 * Runs the lookup with its steps streamed to `on` as they happen (functions.invoke would wait for the whole body).
 * Null when the request couldn't be sent at all, so the caller asks the plain way.
 */
async function lookupLive(body: object, opened: () => void, on: (e: Step) => void, signal: AbortSignal): Promise<Answer | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return null
  let res: Response
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-place`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    })
  } catch {
    return null
  }
  // refused before the search began (sign-in, today's cap, too long): the same error invoke would give
  if (!res.ok) return { data: null, error: { context: res } }
  // a function from before the stream answers in one piece, and that is the answer
  if (!/ndjson/.test(res.headers.get('content-type') ?? '') || !res.body) {
    const data = await res.json().catch(() => null)
    return data ? { data, error: null } : { data: null, error: {} }
  }
  opened()
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        const e = JSON.parse(line) as Step
        if (e.type === 'done') return { data: { places: e.places }, error: null }
        // an error status as invoke reports it, so aiError reads the reason the same way
        if (e.type === 'error') return { data: null, error: { context: new Response(JSON.stringify({ error: e.error }), { status: e.status }) } }
        on(e)
      }
    }
  } catch {
    // cut off below
  }
  // cut off before the end (screen locked, network): no status, so the caller reads what the search saved
  return { data: null, error: {} }
}

/**
 * Suggest a place from an Instagram/TikTok/Maps link or just its name; Claude finds it on the web and fills in the
 * card. Nobody types details by hand: when a link can't be read, the place's name is searched instead.
 */
export default function AddPlace({ tripId, userId, me, defaultTo, onClose }: Props) {
  // one field: a link or a place's name
  const hasBaby = useTripHasBaby(tripId)
  const avoidsPork = useTripAvoidsPorkSeafood(tripId)
  const [query, setQuery] = useState('')
  // a link that couldn't be read: kept for the card, while the place's name is searched instead
  const [failedLink, setFailedLink] = useState('')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [to, setTo] = useState(defaultTo)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // what was typed when the duplicate sheet opened, so going back to edit doesn't lose it
  const [typed, setTyped] = useState<Draft | null>(null)
  const [existing, setExisting] = useState<{ found: Existing; draft: Draft } | null>(null)
  // a post that names several places: each with what's already in the trip, and whether it's ticked
  const [many, setMany] = useState<{ d: Draft; found: Existing | null; on: boolean }[] | null>(null)
  // the steps of the running lookup, as the function reports them; null until it answers with a stream
  const [progress, setProgress] = useState<Progress | null>(null)
  const stop = useRef<AbortController | null>(null)
  // closing the sheet stops reading; the search itself goes on and saves its result
  useEffect(() => () => stop.current?.abort(), [])

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

  /** Looks a place up by link or by name; a link that fails moves on to asking for the name. */
  const research = async (by: { link?: string; name?: string }) => {
    const link = by.link?.trim() ?? ''
    const text = by.name?.trim() ?? ''
    if (!link && !text) return
    setBusy(true)
    setErr('')
    setProgress(null)
    const id = crypto.randomUUID()
    const body = link ? { link, id, trip_id: tripId } : { text, id, trip_id: tripId }
    stop.current?.abort()
    const live = (stop.current = new AbortController())
    // streamed when it can be, to show each step; otherwise (no session, no network) the plain call as before
    const answer =
      (await lookupLive(body, () => setProgress({ link: !!link, searches: [], cards: [] }), (e) => setProgress((p) => p && heard(p, e)), live.signal)) ??
      (await supabase.functions.invoke('suggest-place', { body }))
    if (live.signal.aborted) return
    const { data, error } = answer
    const status = (error as { context?: Response } | null)?.context?.status
    // no answer at all (screen locked, another app) while the search went on: read what it found. A 409 is the same:
    // the live attempt with this id was already charged (and saved its result), so the retry reads that result
    const places = error && (!status || status === 409) ? await savedResult(id) : (data?.places as Draft[] | undefined)
    setBusy(false)
    // the card keeps the post it came from, also when it was found by name
    const from = link || failedLink
    const found: Draft[] = (places ?? []).map((p) => ({ ...p, link: from }))
    if (!found.length) {
      // out of credits (the function answers 402 with the price): say what it costs and where credits come from
      if (error && status === 402) {
        const need = (await (error as { context?: Response }).context?.clone().json().catch(() => null)) as
          | { cost?: number; balance?: number; trip_balance?: number }
          | null
        return setErr(
          t('חיפוש מקום חדש עולה {n} קרדיטים, ויש לך {mine} אישיים ו־{trip} בקבוצה. כל יום מתווספים קרדיטים חינם, ובהגדרות הטיול (ארנק) אפשר להעביר קרדיטים לקבוצה. מקום שכבר חיפשו בעבר נשלף בחינם.', {
            n: need?.cost ?? 0,
            mine: need?.balance ?? 0,
            trip: need?.trip_balance ?? 0,
          }),
        )
      }
      // out of lookups or offline: searching by name won't help either, so say why
      if (error && (status === 429 || status === 413 || !navigator.onLine)) return setErr(await aiError(error, ''))
      if (link) {
        setFailedLink(link)
        setErr('')
      } else {
        setErr(t('לא מצאנו. נסו את השם כמו שהוא מופיע במפות, עם העיר או השכונה.'))
      }
      return
    }
    // the steps stay up only when nothing was found, to show what was read and searched
    setProgress(null)
    if (found.length > 1) {
      const trip = await loadTrip()
      setMany(found.map((d) => {
        const ex = existingIn(trip, d)
        return { d, found: ex, on: !ex || ex.where === 'deck' }
      }))
      return
    }
    setDraft(found[0])
  }

  /** What was typed in the one field: a web address is a link, anything else a place's name. */
  const lookUp = () => {
    const q = query.trim()
    research(/^https?:\/\//i.test(q) || /^(www\.)?(instagram|tiktok|vm\.tiktok|maps\.app\.goo|goo)\./i.test(q) ? { link: /^https?:/i.test(q) ? q : 'https://' + q } : { name: q })
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
    else setErr(t('לא נוסף אף מקום. הם כבר ברשימה, או שהשמירה נכשלה.'))
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
      } else setErr(t('כבר יש מקום בשם הזה בטיול'))
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
          // the lookup's hours and plan line, so the planner places the card without looking anything up
          ...(d.facts_at
            ? {
                opens: d.opens ?? null,
                closes: d.closes ?? null,
                closed_weekdays: d.closed_weekdays ?? [],
                closed_dates: d.closed_dates ?? [],
                open_dates: d.open_dates ?? [],
                best_time: d.best_time ?? 'any',
                visit_mins: d.visit_mins ?? null,
                booking: d.booking ?? null,
                plan_line: d.plan_line ?? null,
                address: d.address ?? null,
                baby_block: d.baby_block ?? null,
                facts_at: d.facts_at,
                facts_sure: d.facts_sure ?? true,
              }
            : {}),
          // the same card in English, for whoever uses the app in English
          ...(d.en ? { en: d.en } : {}),
          ...(d.tags?.length ? { tags: d.tags } : {}),
        })
        .select('id')
        .single()
      // 23505: someone added the same name a moment ago
      if (error?.code === '23505') return 'dup'
      if (error) {
        alert(t('שגיאה: {msg}', { msg: error.message }))
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
          notes: [d.tip, hasBaby && d.baby_notes && 'עם התינוק: ' + d.baby_notes].filter(Boolean).join('\n') || null, // he-only
        })
      if (error?.code === '23505') return 'dup'
      if (error) {
        alert(t('שגיאה: {msg}', { msg: error.message }))
        return 'error'
      }
      return 'ok'
    }
  }

  const destination = (
    <div className="segmented" role="group" aria-label={t('לאן להוסיף')}>
      <button className={to === 'deck' ? 'on' : ''} onClick={() => setTo('deck')}>
        <Icon as={Heart} /> {t('לגילוי, להצבעה')}
      </button>
      <button className={to === 'list' ? 'on' : ''} onClick={() => setTo('list')}>
        <Icon as={List} /> {t('ישר לרשימה')}
      </button>
    </div>
  )

  if (existing) {
    const { found, draft: d } = existing
    return (
      <Sheet title={t('כבר קיים בטיול')} onClose={onClose}>
        <p>
          <b dir="auto">{found.name}</b> {found.where === 'deck' ? t('כבר בגילוי.') : t('כבר ברשימת המקומות.')}
          {!found.exact && ` ${t('נראה שזה אותו מקום.')}`}
        </p>
        <button className="primary" onClick={() => useExisting(found)} disabled={busy}>
          {found.where === 'deck' ? (
            <>
              <Icon as={Heart} /> {t('זה אותו מקום, לסמן לייק')}
            </>
          ) : (
            t('זה אותו מקום, סגירה')
          )}
        </button>
        {!found.exact && (
          <button className="secondary" onClick={() => (setExisting(null), save(d, true))} disabled={busy}>
            {t('זה מקום אחר, להוסיף בכל זאת')}
          </button>
        )}
        <button className="link" onClick={() => setExisting(null)}>
          {t('חזרה לעריכה')}
        </button>
      </Sheet>
    )
  }

  if (many) {
    // ticked places already on the list are skipped, so they don't count
    const picked = many.filter((m) => m.on && m.found?.where !== 'list').length
    return (
      <Sheet title={t('נמצאו {n} מקומות', { n: many.length })} onClose={onClose}>
        <p className="muted small">{t('מסמנים אילו מקומות להוסיף. מקום שכבר בטיול לא יתווסף שוב, ואם הוא בגילוי יסומן לו לייק.')}</p>
        <div className="stack">
          {many.map((m, i) => {
            const style = CARD_STYLE[m.d.category ?? ''] ?? CARD_STYLE.sight
            const verdict = m.d.verdict ? VERDICTS[m.d.verdict] : null
            // the lookup's English text for the preview; what gets added keeps the Hebrew columns and `en`
            const shown = localizeCard(m.d)
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
                    {[cityLabel(CITY_HE[m.d.city ?? '']), m.d.area, style.label].filter(Boolean).join(' · ')}
                  </span>
                  {(shown.serves || shown.todo || shown.reality) && (
                    <span className="small clamp" dir="auto">
                      {shown.serves || shown.todo || shown.reality}
                    </span>
                  )}
                  <span className="row">
                    {verdict && <span className={'verdict ' + verdict.tone}>{verdict.label}</span>}
                    {m.found && (
                      <span className="verdict meh">{m.found.where === 'deck' ? t('כבר בגילוי') : t('כבר ברשימה')}</span>
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
          {busy ? t('מוסיף…') : picked === 1 ? t('הוספת מקום אחד') : t('הוספת {n} מקומות', { n: picked })}
        </button>
        <button className="link" onClick={() => (setErr(''), setMany(null))}>
          <Icon as={ArrowRight} className="flip-ltr" /> {t('חזרה')}
        </button>
      </Sheet>
    )
  }

  if (draft) {
    return (
      <Sheet title={t('זה המקום?')} onClose={onClose}>
        <DraftForm
          hasBaby={hasBaby}
          avoidsPork={avoidsPork}
          draft={typed ?? draft}
          busy={busy}
          err={err}
          destination={destination}
          onSave={save}
          onBack={() => (setTyped(null), setDraft(null))}
        />
      </Sheet>
    )
  }

  if (failedLink) {
    return (
      <Sheet title={t('מה שם המקום?')} onClose={onClose}>
        <p className="muted small">{t('לא זיהינו את המקום מהקישור. כתבו את השם ונחפש דירוג, כתובת ופרטים.')}</p>
        <Field label={t('שם המקום')}>
          <input value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder={t('למשל: Savoy, אזבו-ג׳ובן')} autoFocus enterKeyHint="search" onKeyDown={(e) => e.key === 'Enter' && name.trim() && !busy && research({ name })} />
        </Field>
        {err && <p className="msg">{err}</p>}
        <button className="primary" onClick={() => research({ name })} disabled={busy || !name.trim()}>
          {busy ? t('מחפש, עד דקה…') : (<><Icon as={Search} /> {t('חיפוש לפי שם')}</>)}
        </button>
        {progress && <Steps p={progress} live={busy} />}
        <button className="link" onClick={() => (setErr(''), setProgress(null), setFailedLink(''))}>
          <Icon as={ArrowRight} className="flip-ltr" /> {t('חזרה')}
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet title={t('הצעת מקום')} onClose={onClose}>
      <p className="muted small">
        {t('הדביקו קישור מאינסטגרם, טיקטוק או גוגל מפות, או כתבו שם של מקום. נבדוק דירוג, כתובת, מה יש בתפריט והתאמה לתינוק.')}
      </p>
      <Field label={t('קישור או שם של מקום')}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          placeholder={t('קישור, או שם כמו Ichiran Shibuya')}
          enterKeyHint="search"
          onKeyDown={(e) => e.key === 'Enter' && query.trim() && !busy && lookUp()}
        />
      </Field>
      {err && <p className="msg">{err}</p>}
      <button className="primary" onClick={lookUp} disabled={busy || !query.trim()}>
        {busy ? t('מחפש, עד דקה…') : (<><Icon as={Search} /> {t('זיהוי ובדיקה')}</>)}
      </button>
      {progress && <Steps p={progress} live={busy} />}
    </Sheet>
  )
}

type Mark = 'done' | 'now' | 'wait' | 'fail'

const MARK_ICON = { done: Check, now: LoaderCircle, fail: X } as const

/** A step's mark: a check when done, a spinner while it runs, an empty ring while it waits. */
function StepMark({ mark }: { mark: Mark }) {
  return (
    <span className={'step-mark ' + mark}>
      {mark !== 'wait' && <Icon as={MARK_ICON[mark]} size={14} className={mark === 'now' ? 'spin' : undefined} />}
    </span>
  )
}

/** Where a place is, as the lookup told it: a card's city in the app's language, then its area. */
const whereOf = (s: Spot) => [s.city ? cityLabel(CITY_HE[s.city] ?? '') : '', s.where].filter(Boolean)

/**
 * The lookup's steps as they happen, each with what it learned (the post's text, the searches, the places and
 * where they are), so a wrong turn shows early instead of after a minute of spinner.
 */
function Steps({ p, live }: { p: Progress; live: boolean }) {
  const rows: { key: string; title: string; mark: Mark; body?: React.ReactNode }[] = []
  // stopped (an error, or the answer came): a step still marked running just waits
  const still = (m: Mark): Mark => (!live && m === 'now' ? 'wait' : m)
  const spots = (list: Spot[], status?: (i: number) => Mark) => (
    <ul className="step-list">
      {list.map((s, i) => (
        <li key={i}>
          {status && <StepMark mark={still(status(i))} />}
          <span className="step-place">
            <bdi dir="auto">{s.name}</bdi>
            {/* each part isolated: the city can be Hebrew and the area English */}
            {whereOf(s).map((w, j) => (
              <span key={j} className="muted">
                {' · '}
                <bdi dir="auto">{w}</bdi>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )

  if (p.cached) {
    rows.push({ key: 'cached', title: t('נמצא בבדיקה קודמת'), mark: 'done', body: spots(p.cached) })
  } else {
    if (p.link) {
      const r = p.read
      const SOURCE = { instagram: t('פוסט באינסטגרם'), tiktok: t('סרטון בטיקטוק'), maps: t('קישור לגוגל מפות'), link: t('קישור לאתר') }
      // nothing read from a post: the search starts from the address alone, which often misses
      const empty = r && !r.excerpt && !r.slides
      rows.push({
        key: 'read',
        title: t('קריאת הקישור'),
        mark: r ? 'done' : 'now',
        body: r && (
          <>
            <span>{SOURCE[r.source]}</span>
            {r.excerpt && <q className="step-quote clamp" dir="auto">{r.excerpt}</q>}
            {r.slides > 0 && <span>{r.slides === 1 ? t('תמונה אחת מהפוסט') : t('{n} תמונות מהפוסט', { n: r.slides })}</span>}
            {empty &&
              (r.source === 'instagram' || r.source === 'tiktok' ? (
                <span>{t('לא הצלחנו לקרוא את הפוסט. נחפש לפי הקישור בלבד.')}</span>
              ) : (
                <span>{t('את העמוד עצמו לא קוראים. נחפש לפי הקישור.')}</span>
              ))}
          </>
        ),
      })
    }
    const searching = !p.link || !!p.read
    // the newest searches; a long research can make a few dozen
    const shown = p.searches.slice(-8)
    rows.push({
      key: 'search',
      title: t('חיפוש ברשת'),
      mark: p.researched != null ? 'done' : searching ? 'now' : 'wait',
      body: (p.searches.length > 0 || p.researched === 0) && (
        <>
          {p.searches.length > shown.length && <span>{t('ועוד {n} חיפושים', { n: p.searches.length - shown.length })}</span>}
          {shown.map((q, i) => (
            <span key={i} className="step-line">
              <Icon as={Search} size={13} /> <bdi dir="auto">{q}</bdi>
            </span>
          ))}
          {p.researched === 0 && <span>{t('בלי חיפוש ברשת')}</span>}
        </>
      ),
    })
    const found = p.found
    rows.push({
      key: 'found',
      title: t('זיהוי המקומות'),
      mark: found ? (found.length ? 'done' : 'fail') : p.researched != null ? 'now' : 'wait',
      body:
        found &&
        (found.length === 0 ? t('לא זיהינו מקום') : found.length === 1 ? t('נמצא מקום אחד') : t('נמצאו {n} מקומות', { n: found.length })),
    })
    if (!found || found.length) {
      const cards = found?.map((s, i) => p.cards[i] ?? s) ?? []
      const all = !!found && found.every((_, i) => p.cards[i])
      rows.push({
        key: 'cards',
        title: t('כתיבת הכרטיסים'),
        mark: all ? (p.cards.some((c) => c?.ok) ? 'done' : 'fail') : found ? 'now' : 'wait',
        body: found && spots(cards, (i) => (p.cards[i] ? (p.cards[i].ok ? 'done' : 'fail') : 'now')),
      })
    }
  }

  return (
    <ol className="steps" aria-live="polite" aria-busy={live}>
      {rows.map((r) => (
        <li key={r.key} className={'step ' + still(r.mark)}>
          <StepMark mark={still(r.mark)} />
          <span className="step-title">{r.title}</span>
          {r.body && <div className="step-body">{r.body}</div>}
        </li>
      ))}
    </ol>
  )
}

function DraftForm(props: {
  hasBaby: boolean
  avoidsPork: boolean
  draft: Draft
  busy: boolean
  err: string
  destination: React.ReactNode
  onSave: (d: Draft) => void
  onBack: () => void
}) {
  const [d, setD] = useState<Draft>(props.draft)
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  // a tip typed in English replaces the card's English one too, or the card would still show the old text
  const setTip = (e: { target: { value: string } }) =>
    setD({ ...d, tip: e.target.value, ...(isEn && d.en ? { en: { ...d.en, tip: e.target.value } } : {}) })
  const verdict = d.verdict ? VERDICTS[d.verdict] : null
  // the preview shows the lookup's English text; edits go to the Hebrew columns (and, for the tip, to `en` too)
  const shown = localizeCard(d)

  return (
    <>
      {props.err && <p className="msg">{props.err}</p>}
      {(verdict || d.tabelog_score != null || d.google_score != null) && (
        <div className="row">
          {verdict && <span className={'verdict ' + verdict.tone}>{verdict.label}</span>}
          {d.tabelog_score != null && <span className="small muted">Tabelog <Icon as={Star} /> <bdi>{d.tabelog_score}</bdi></span>}
          {d.google_score != null && <span className="small muted">Google <Icon as={Star} /> <bdi>{d.google_score}</bdi></span>}
        </div>
      )}
      <Field label={t('שם')}>
        <input value={d.name ?? ''} onChange={set('name')} dir="auto" />
      </Field>
      <div className="row">
        <Field label={t('עיר')}>
          <select value={d.city} onChange={set('city')}>
            {Object.entries(CITY_HE).map(([k, v]) => (
              <option key={k} value={k}>
                {cityLabel(v)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('שכונה')}>
          <input value={d.area ?? ''} onChange={set('area')} dir="auto" />
        </Field>
      </div>
      <div className="row">
        <Field label={t('סוג')}>
          <select value={d.category} onChange={set('category')}>
            {Object.entries(CARD_STYLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('למי')}>
          <select value={d.audience ?? ''} onChange={set('audience')}>
            {Object.entries(AUDIENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {d.serves && (
        <div className="small">
          <b>{t('מה מגישים:')}</b> <span dir="auto">{shown.serves}</span>
        </div>
      )}
      {d.todo && (
        <div className="small">
          <b>{t('מה עושים שם:')}</b> <span dir="auto">{shown.todo}</span>
        </div>
      )}
      {d.special && (
        <div className="small">
          <b>{t('מה מיוחד:')}</b> <span dir="auto">{shown.special}</span>
        </div>
      )}
      {d.reality && (
        <div className="small">
          <b>{t('בביקורות:')}</b> <span dir="auto">{shown.reality}</span>
        </div>
      )}
      {props.avoidsPork && d.kosher_note && (
        <div className="small">
          <b>{t('חזיר ופירות ים:')}</b> <span dir="auto">{shown.kosher_note}</span>
        </div>
      )}
      {props.hasBaby && d.baby_notes && (
        <div className="small">
          <b>{t('עם תינוק:')}</b> <span dir="auto">{shown.baby_notes}</span>
        </div>
      )}
      <Field label={t('טיפ / הערה')}>
        <textarea value={shown.tip ?? ''} onChange={setTip} rows={2} dir="auto" />
      </Field>
      {props.destination}
      <button className="primary" onClick={() => props.onSave(d)} disabled={props.busy || !d.name?.trim()}>
        {props.busy ? t('שומר…') : t('הוספה')}
      </button>
      <button className="link" onClick={props.onBack}>
        <Icon as={ArrowRight} className="flip-ltr" /> {t('חזרה')}
      </button>
    </>
  )
}
