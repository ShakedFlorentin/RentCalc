import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabase'
import { AUDIENCES, CARD_STYLE, CITY_HE, KOSHER, VERDICTS, type Candidate, type Member, type Swipe, type Trip } from '../types'
import { cityLabel, couplesOf, keepRanges, mutate, safeUrl, useMediaIndex, useTripTable, withMedia } from '../lib'
import AddPlace from './AddPlace'
import { t } from '../i18n'
import { Empty, Sheet } from '../ui'
import { MediaActions } from '../media'
import { ChevronLeft, ChevronUp, Heart, Ban, X, Lightbulb, MapPin, MessageSquare, Plus, ReceiptText, Search, Sparkles, Star, Target, Timer, Users, Utensils, UtensilsCrossed, Wine, Baby } from 'lucide-react'
import { AUDIENCE_ICON, CARD_ICON, Icon, type LucideIcon } from '../icons'
import '../styles/game.css'

const LEVELS = [
  { xp: 0, name: t('גאיג׳ין') },
  { xp: 200, name: t('תייר') },
  { xp: 500, name: t('נוסע') },
  { xp: 1000, name: t('מקומי') },
  { xp: 2000, name: t('שוגון') },
]

type Props = {
  trip: Trip
  userId: string
  members: Member[]
  /** a card picked in search: opened on its own, with everyone's votes */
  showCard?: string | null
  onCardShown?: () => void
}

export default function SwipeGame({ trip, userId, members, showCard, onCardShown }: Props) {
  const { rows: rawCandidates, loading } = useTripTable<Candidate>('candidates', trip.id)
  const media = useMediaIndex()
  const candidates = useMemo(() => rawCandidates.map((c) => withMedia(c, media)), [rawCandidates, media])
  const { rows: swipes, loading: swipesLoading, reload: reloadSwipes } = useTripTable<Swipe>('swipes', trip.id)
  const [city, setCity] = useState('')
  const [aud, setAud] = useState('')
  const [match, setMatch] = useState<{ c: Candidate; names: string[]; who: string | null } | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const knownMatches = useRef<Set<string> | null>(null)
  // who each card is for (the couples sleeping near it) and which of them said yes: the database's own rules
  // (trip_place_couples), fetched again after every change in the votes
  const [forWhom, setForWhom] = useState<Map<string, { couples: string[]; liked: string[] }> | null>(null)
  useEffect(() => {
    let live = true
    supabase.rpc('trip_place_couples', { tid: trip.id }).then(({ data }) => {
      if (!live || !data) return
      const rows = data as { candidate_id: string; couples: string[] | null; liked_by: string[] | null }[]
      setForWhom(new Map(rows.map((r) => [r.candidate_id, { couples: r.couples ?? [], liked: r.liked_by ?? [] }])))
    })
    return () => {
      live = false
    }
  }, [trip.id, swipes, rawCandidates.length])

  useEffect(() => {
    supabase.rpc('sync_library', { tid: trip.id })
  }, [trip.id])

  const likes = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of swipes) if (s.liked) m.set(s.candidate_id, [...(m.get(s.candidate_id) ?? []), s.user_id])
    return m
  }, [swipes])
  // candidate id → whose match it is (a couple, or null for everyone): every couple the place is for said yes
  const matches = useMemo(() => {
    const m = new Map<string, string | null>()
    const everyone = couplesOf(members)
    if (!everyone.length) {
      for (const [id, us] of likes) if (us.length >= trip.match_threshold) m.set(id, null)
      return m
    }
    for (const [id, f] of forWhom ?? []) {
      if (!f.couples.length || f.liked.length < f.couples.length) continue
      m.set(id, f.couples.length === everyone.length ? null : f.couples.join(' + '))
    }
    return m
  }, [forWhom, likes, members, trip.match_threshold])
  const matchedIds = useMemo(() => new Set(matches.keys()), [matches])

  // announce every new match, whoever made it
  useEffect(() => {
    // wait for everything a match is made of, or the matches that already exist look new
    if (loading || swipesLoading || !members.length || !forWhom) return
    if (knownMatches.current === null) {
      knownMatches.current = new Set([...matches].map(([id, who]) => id + who))
      return
    }
    // keyed with the owner too, so a couple's match turning into everyone's is celebrated again
    for (const [id, who] of matches) {
      if (knownMatches.current.has(id + who)) continue
      knownMatches.current.add(id + who)
      const c = candidates.find((x) => x.id === id)
      if (c) setMatch({ c, who, names: (likes.get(id) ?? []).map((u) => nameOf(members, u)) })
    }
  }, [matches, loading, swipesLoading, candidates, likes, members])

  const mine = new Set(swipes.filter((s) => s.user_id === userId).map((s) => s.candidate_id))
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  // a place only the other couple will be near (their hotel city) isn't ours to vote on
  const forMe = (c: Candidate) => !myCouple || !forWhom || (forWhom.get(c.id)?.couples ?? [myCouple]).includes(myCouple)
  const myVote = (c: Candidate) => swipes.find((s) => s.candidate_id === c.id && s.user_id === userId)?.liked
  // the other couple already said yes: it waits on us, so it comes first
  const othersLiked = (c: Candidate) => (forWhom?.get(c.id)?.liked ?? []).filter((x) => x !== myCouple)
  const cities = Object.keys(CITY_HE).filter((c) => candidates.some((x) => x.city === c))
  const deck = candidates
    .filter((c) => !mine.has(c.id) && forMe(c) && (!city || c.city === city) && (!aud || c.audience === aud))
    .sort((a, b) => Number(othersLiked(b).length > 0) - Number(othersLiked(a).length > 0) || hash(a.id + userId) - hash(b.id + userId))

  // the card stays up until the reload lands, so a second tap would swipe it again
  const pending = useRef(new Set<string>())
  const swipe = async (c: Candidate, liked: boolean) => {
    if (pending.current.has(c.id)) return false
    pending.current.add(c.id)
    const ok = await mutate(
      supabase.from('swipes').upsert({ trip_id: trip.id, candidate_id: c.id, user_id: userId, liked }),
    )
    if (ok) {
      setHistory((h) => (h[h.length - 1] === c.id ? h : [...h, c.id]))
      await reloadSwipes()
    }
    pending.current.delete(c.id)
    return ok
  }

  const undo = async () => {
    const last = history[history.length - 1]
    if (!last) return
    await mutate(supabase.from('swipes').delete().eq('candidate_id', last).eq('user_id', userId))
    setHistory((h) => h.slice(0, -1))
    reloadSwipes()
  }

  const board = members
    .map((m) => {
      const own = swipes.filter((s) => s.user_id === m.user_id)
      const xp = own.length * 10 + [...matchedIds].filter((id) => likes.get(id)?.includes(m.user_id)).length * 50
      return { m, done: own.length, xp, level: [...LEVELS].reverse().find((l) => xp >= l.xp)!, twin: agreement(swipes, userId, m.user_id) }
    })
    .sort((a, b) => b.xp - a.xp)

  const meRow = board.find((b) => b.m.user_id === userId)
  const nextLevel = meRow ? LEVELS.find((l) => l.xp > meRow.xp) : undefined
  const levelPct = meRow ? (nextLevel ? ((meRow.xp - meRow.level.xp) / (nextLevel.xp - meRow.level.xp)) * 100 : 100) : 0
  const [boardOpen, setBoardOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  // places someone said no to: a split vote keeps a place off that couple's list, so it is worth finding again
  const [vetoOpen, setVetoOpen] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => {
    if (!showCard) return
    setFocus(showCard)
    onCardShown?.()
  }, [showCard, onCardShown])
  const focused = focus ? candidates.find((c) => c.id === focus) : undefined
  const vetoed = useMemo(() => {
    const no = new Set(swipes.filter((s) => !s.liked).map((s) => s.candidate_id))
    const split = (c: Candidate) => swipes.some((s) => s.candidate_id === c.id && s.liked)
    return candidates
      .filter((c) => no.has(c.id))
      .sort((a, b) => Number(split(b)) - Number(split(a)) || a.name.localeCompare(b.name))
  }, [candidates, swipes])
  // a vote from a list or a card opened from search: not part of the deck's undo
  const vote = async (c: Candidate, liked: boolean) => {
    if (await mutate(supabase.from('swipes').upsert({ trip_id: trip.id, candidate_id: c.id, user_id: userId, liked }))) reloadSwipes()
  }
  const me = members.find((m) => m.user_id === userId)?.display_name ?? ''

  return (
    <div className="swipe-screen">
      <button className="hud" onClick={() => setBoardOpen(true)} aria-label={t('פתיחת הדירוג')}>
        <span className="hud-level">
          <b>{meRow?.level.name ?? ''}</b>
          <span className="bar">
            <span style={{ width: `${levelPct}%` }} />
          </span>
        </span>
        <span className="hud-stat">
          <b>{meRow?.xp ?? 0}</b> XP
        </span>
        <span className="hud-stat">
          <Icon as={Heart} /> <b>{matchedIds.size}</b>
        </span>
        <span className="hud-chevron" aria-hidden="true">
          <Icon as={ChevronLeft} size="1.3em" className="flip-ltr" />
        </span>
      </button>

      <div className="chips scroll filters" role="group" aria-label={t('סינון')}>
        <button className="chip add-chip" onClick={() => setAdding(true)}>
          <Icon as={Plus} /> {t('הצעת מקום')}
        </button>
        <button className={'chip' + (!city && !aud ? ' on' : '')} aria-pressed={!city && !aud} onClick={() => (setCity(''), setAud(''))}>
          {t('הכל')}
        </button>
        {vetoed.length > 0 && (
          <button className="chip" onClick={() => setVetoOpen(true)}>
            <Icon as={Ban} /> {t('נפסלו')} <bdi className="muted">{vetoed.length}</bdi>
          </button>
        )}
        {Object.entries(AUDIENCES).map(([k, v]) => (
          <button key={k} className={'chip' + (aud === k ? ' on' : '')} aria-pressed={aud === k} onClick={() => setAud(aud === k ? '' : k)}>
            {AUDIENCE_ICON[k] && <Icon as={AUDIENCE_ICON[k]} />} {v}
          </button>
        ))}
        <span className="chip-sep" aria-hidden="true" />
        {cities.map((c) => (
          <button key={c} className={'chip' + (city === c ? ' on' : '')} aria-pressed={city === c} onClick={() => setCity(city === c ? '' : c)}>
            {cityLabel(CITY_HE[c])}
          </button>
        ))}
      </div>

      {adding && <AddPlace tripId={trip.id} userId={userId} me={me} defaultTo="deck" onClose={() => setAdding(false)} />}

      {vetoOpen && (
        <Sheet title={t('נפסלו')} onClose={() => setVetoOpen(false)}>
          <p className="small muted">{t('מקומות שמישהו אמר עליהם לא. אצל זוג שאחד אהב והשני לא, המקום לא נכנס למסלול שלהם עד שמישהו משנה את דעתו.')}</p>
          {!vetoed.length && <p className="empty">{t('אף אחד לא פסל מקום')}</p>}
          <div className="card list-card">
            {vetoed.map((c) => {
              const mineNo = swipes.some((x) => x.candidate_id === c.id && x.user_id === userId && !x.liked)
              return (
                <div key={c.id} className="veto-row">
                  <button className="veto-text" onClick={() => setFocus(c.id)}>
                    <b dir="auto">{c.name}</b>
                    <span className="muted small">
                      {[cityLabel(CITY_HE[c.city] ?? c.city), c.area].filter(Boolean).join(' · ')}
                    </span>
                    <Votes c={c} swipes={swipes} members={members} />
                  </button>
                  {mineNo && (
                    <button className="pill soft" onClick={() => vote(c, true)}>
                      {t('שיניתי את דעתי')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Sheet>
      )}

      {focused && (
        <Sheet title={focused.name} onClose={() => setFocus(null)}>
          <div className="card-full">
            <div className="muted small">
              {[cityLabel(CITY_HE[focused.city] ?? focused.city), focused.area].filter(Boolean).join(' · ')}
            </div>
            <FocusVotes c={focused} swipes={swipes} members={members} userId={userId} />
            <CardFull c={focused} />
          </div>
          {forMe(focused) && (
            <div className="sheet-decide">
              <button
                className={'round nope' + (myVote(focused) === false ? ' chosen' : '')}
                onClick={() => vote(focused, false)}
                aria-pressed={myVote(focused) === false}
                aria-label={t('דלג')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
              <button
                className={'round like' + (myVote(focused) === true ? ' chosen' : '')}
                onClick={() => vote(focused, true)}
                aria-pressed={myVote(focused) === true}
                aria-label={t('אהבתי')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path className="fill" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.7 4 4.5 7.2 4.5c1.9 0 3.4 1 4.8 2.8 1.4-1.8 2.9-2.8 4.8-2.8 3.2 0 5.6 3.2 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" /></svg>
              </button>
            </div>
          )}
        </Sheet>
      )}

      {boardOpen && (
        <Sheet title={t('דירוג')} onClose={() => setBoardOpen(false)}>
          <div className="board">
            {board.map((b, i) => (
              <div key={b.m.user_id} className="player">
                <span className="rank">{i + 1}</span>
                <div className="player-body">
                  <div className="row spread nowrap">
                    <b>
                      {b.m.display_name}
                      {b.m.user_id === userId && ` ${t('(אני)')}`}
                    </b>
                    <span className="small muted">
                      {b.level.name} · <bdi>{b.xp} XP</bdi>
                    </span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${candidates.length ? (b.done / candidates.length) * 100 : 0}%` }} />
                  </div>
                  {b.m.user_id !== userId && b.twin !== null && (
                    <div className="small muted">{t('טעם משותף איתך: {pct}%', { pct: b.twin })}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="small muted">
            {t('כל זוג מצביע ביחד: מספיק שאחד אוהב, אלא אם השני דילג. שואלים על מקום רק את מי שישן לידו, והוא נכנס למסלול ביום שכולם בעיר, אם כל הזוגות האלה אהבו אותו. לייק או דילוג שווים 10 XP, מאצ׳ 50 XP.')}
          </p>
        </Sheet>
      )}

      <div className="deck">
        {!loading && deck.length === 0 && (
          <Empty>
            {!candidates.length
              ? t('עוד אין מקומות בגילוי')
              : candidates.some((c) => !mine.has(c.id) && forMe(c))
                ? t('אין מקומות בסינון הזה')
                : t('ראיתם את כל המקומות. אפשר לחכות לחברים או להציץ במאצ׳ים בלשונית מקומות')}
          </Empty>
        )}
        {deck
          .slice(0, 2)
          .reverse()
          .map((c, i, arr) => (
            <Card key={c.id} c={c} likedBy={othersLiked(c)} top={i === arr.length - 1} onSwipe={(liked) => swipe(c, liked)} />
          ))}
      </div>
      {(deck.length > 0 || history.length > 0) && (
        <div className="swipe-buttons">
          <button className="round small-round" onClick={undo} disabled={!history.length} aria-label={t('ביטול החלקה אחרונה')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </button>
          <button className="round nope" onClick={() => deck[0] && swipe(deck[0], false)} disabled={!deck.length} aria-label={t('דלג')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <button className="round like" onClick={() => deck[0] && swipe(deck[0], true)} disabled={!deck.length} aria-label={t('אהבתי')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path className="fill" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.7 4 4.5 7.2 4.5c1.9 0 3.4 1 4.8 2.8 1.4-1.8 2.9-2.8 4.8-2.8 3.2 0 5.6 3.2 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" /></svg>
          </button>
          {deck.length > 0 && <span className="left-count" aria-live="polite">{deck.length === 1 ? t('נשאר אחד') : t('נשארו {n}', { n: deck.length })}</span>}
        </div>
      )}

      {match && (
        <div className="backdrop center-modal" onClick={() => setMatch(null)}>
          <div className="match-pop" role="dialog" aria-modal="true" aria-label={t('מאצ׳')} onClick={(e) => e.stopPropagation()}>
            <h2>{t('מאצ׳')}</h2>
            <p>
              <b dir="auto">{match.c.name}</b>{' '}
              {match.who ? t('נכנס לרשימה של {who}', { who: match.who.split(' + ').map((w) => t(w)).join(' + ') }) : t('נכנס לרשימה של כולם')}
            </p>
            <p className="muted small">{t('נכנס למסלול ביום פנוי בעיר שלו. טיול יום יחכה עד שתבחרו לו יום.')}</p>
            <p className="muted">{t('{names} אהבו את המקום', { names: match.names.join(' · ') })}</p>
            <button className="primary" onClick={() => setMatch(null)}>
              {t('המשך')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A spring in Apple's terms: damping ratio (1 = no overshoot) and response (roughly seconds to settle).
 * It starts from wherever the card is and with whatever speed it has, so a gesture can grab it mid-flight.
 */
function springTo(
  from: number,
  to: number,
  velocity: number,
  { damping, response }: { damping: number; response: number },
  onFrame: (x: number) => boolean | void,
  onDone: () => void,
) {
  const k = ((2 * Math.PI) / response) ** 2
  const c = (4 * Math.PI * damping) / response
  let x = from
  let v = velocity
  let last = performance.now()
  let id = requestAnimationFrame(function tick(now) {
    let dt = Math.min(0.064, (now - last) / 1000)
    last = now
    while (dt > 0) {
      const h = Math.min(dt, 0.004)
      v += (-k * (x - to) - c * v) * h
      x += v * h
      dt -= h
    }
    const settled = Math.abs(x - to) < 0.5 && Math.abs(v) < 5
    if (settled) x = to
    if (onFrame(x) === true || settled) return onDone()
    id = requestAnimationFrame(tick)
  })
  return () => cancelAnimationFrame(id)
}

/** Where a flick would come to rest, like scroll deceleration (Apple's projection, rate 0.998). */
const project = (v: number) => ((v / 1000) * 0.998) / (1 - 0.998)
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function Card({ c, top, likedBy, onSwipe }: { c: Candidate; top: boolean; likedBy: string[]; onSwipe: (liked: boolean) => Promise<boolean> }) {
  const [dx, setDx] = useState(0)
  const [more, setMore] = useState(false)
  const [photo, setPhoto] = useState(0)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const pos = useRef(0)
  const grab = useRef<number | null>(null) // pointer x minus card x: the card stays where the finger took it
  const downX = useRef(0)
  const trail = useRef<{ t: number; x: number }[]>([])
  const stop = useRef<(() => void) | null>(null)
  const flying = useRef(false)
  const moved = useRef(false)
  const onInfo = useRef(false)
  const style = CARD_STYLE[c.category] ?? CARD_STYLE.sight
  const photos = (c.photos ?? []).filter((u) => !broken.has(u))
  const cur = photos[Math.min(photo, photos.length - 1)]
  useEffect(() => () => stop.current?.(), [])

  const show = (x: number) => {
    pos.current = x
    setDx(x)
  }
  const animate = (to: number, v: number, opts: { damping: number; response: number }, done?: () => void, until?: (x: number) => boolean) => {
    stop.current?.()
    stop.current = null
    if (reducedMotion()) {
      show(to)
      done?.()
      return
    }
    stop.current = springTo(pos.current, to, v, opts, (x) => (show(x), until?.(x)), () => {
      stop.current = null
      done?.()
    })
  }
  // back to the middle; a little bounce only because a drag preceded it
  const settle = (v = 0) => animate(0, v, { damping: 0.8, response: 0.4 })
  const fly = (dir: 1 | -1, v = 0) => {
    flying.current = true
    navigator.vibrate?.(12)
    const off = dir * (window.innerWidth + 200)
    animate(
      off,
      v,
      { damping: 1, response: 0.3 },
      async () => {
        // the swipe didn't save (e.g. offline): bring the card back instead of leaving it off-screen on top
        if (!(await onSwipe(dir === 1))) {
          flying.current = false
          settle()
        }
      },
      (x) => Math.abs(x) > window.innerWidth * 0.8,
    )
  }
  const down = (e: PointerEvent) => {
    if (flying.current || (e.target as HTMLElement).closest('a,button')) return
    // grabbing a card that is still springing back stops it right where it is
    stop.current?.()
    stop.current = null
    grab.current = e.clientX - pos.current
    downX.current = e.clientX
    trail.current = [{ t: e.timeStamp, x: pos.current }]
    moved.current = false
    onInfo.current = !!(e.target as HTMLElement).closest('.card-info')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    if (grab.current === null) return
    if (Math.abs(e.clientX - downX.current) > 6) moved.current = true
    const x = e.clientX - grab.current
    trail.current = [...trail.current.filter((p) => e.timeStamp - p.t < 100), { t: e.timeStamp, x }]
    show(x)
  }
  const up = (e: PointerEvent) => {
    if (grab.current === null) return
    grab.current = null
    // the card holds the pointer while dragging, so a tap on the text is caught here, not as a click
    if (!moved.current && onInfo.current) {
      settle()
      setMore(true)
      return
    }
    const tr = trail.current
    const a = tr[0]
    const b = tr[tr.length - 1]
    // a finger that stopped before letting go has no speed left, whatever it had before the pause
    const v = b.t > a.t && e.timeStamp - b.t < 50 ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0
    // decide by where the flick is going, not where the finger let go. RTL doesn't change it: right = like
    const rest = pos.current + project(v)
    if (rest > 110) fly(1, v)
    else if (rest < -110) fly(-1, v)
    else settle(v)
  }
  const decide = (dir: 1 | -1) => {
    setMore(false)
    fly(dir)
  }
  const cycle = (e: { stopPropagation: () => void }, step: number) => {
    e.stopPropagation()
    setPhoto((i) => (i + step + photos.length) % photos.length)
  }

  const p = Math.min(1, Math.abs(dx) / 90)
  return (
    <div
      className={'swipe-card' + (top ? ' top' : ' under')}
      style={{ transform: top ? `translateX(${dx}px) rotate(${dx / 20}deg)` : undefined }}
      onPointerDown={top ? down : undefined}
      onPointerMove={top ? move : undefined}
      onPointerUp={top ? up : undefined}
      onPointerCancel={top ? up : undefined}
    >
      <div className="card-hero" style={{ background: style.bg }}>
        {cur ? (
          <img
            key={cur}
            className="card-photo"
            src={cur}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setBroken((b) => new Set(b).add(cur))}
          />
        ) : (
          <Icon as={CARD_ICON[c.category] ?? CARD_ICON.sight} className="card-emoji" size={92} />
        )}
        {top && photos.length > 1 && (
          <>
            <button className="photo-tap prev" aria-label={t('תמונה קודמת')} onClick={(e) => cycle(e, -1)} />
            <button className="photo-tap next" aria-label={t('תמונה הבאה')} onClick={(e) => cycle(e, 1)} />
            <div className="dots" aria-hidden="true">
              {photos.map((u, i) => (
                <i key={u} className={i === Math.min(photo, photos.length - 1) ? 'on' : ''} />
              ))}
            </div>
          </>
        )}
        <span className="stamp like-stamp" style={{ opacity: dx > 0 ? p : 0 }} aria-hidden="true">
          {t('אהבתי')}
        </span>
        <span className="stamp nope-stamp" style={{ opacity: dx < 0 ? p : 0 }} aria-hidden="true">
          {t('דלג')}
        </span>
        <div className="card-title">
          {likedBy.length > 0 && (
            <span className="liked-by">
              <Icon as={Heart} /> <bdi>{likedBy.map((c) => t(c)).join(', ')}</bdi> {t('אהבו')}
            </span>
          )}
          <h2 dir="auto">{c.name}</h2>
          {c.name_ja && (
            <div className="ja" lang="ja" dir="ltr">
              {c.name_ja}
            </div>
          )}
          <div className="card-meta">
            <Icon as={MapPin} /> {cityLabel(CITY_HE[c.city] ?? c.city)}
            {c.area && (
              <>
                {' · '}
                <bdi>{c.area}</bdi>
              </>
            )}
            {' · '}
            {style.label}
            {c.price && (
              <>
                {' · '}
                <bdi>{keepRanges(c.price)}</bdi>
              </>
            )}
          </div>
        </div>
      </div>
      {/* a short preview; tapping it opens the whole card in a full-height sheet */}
      <div className="card-info">
        <Tags c={c} />
        {c.serves && (
          <div className="fact">
            <Label icon={Utensils}>{t('מה מגישים')}</Label>
            <p dir="auto" className="clamp">{keepRanges(c.serves)}</p>
          </div>
        )}
        {c.todo && !c.serves && (
          <div className="fact">
            <Label icon={Target}>{t('מה עושים שם')}</Label>
            <p dir="auto" className="clamp">{keepRanges(c.todo)}</p>
          </div>
        )}
        {c.special && (
          <div className="fact">
            <Label icon={Sparkles}>{t('מה מיוחד')}</Label>
            <p dir="auto" className="clamp">{keepRanges(c.special)}</p>
          </div>
        )}
        {c.hype && !c.serves && !c.todo && !c.special && (
          <div className="fact">
            <Label icon={MessageSquare}>{t('ברשתות')}</Label>
            <p dir="auto" className="clamp">{keepRanges(c.hype)}</p>
          </div>
        )}
        {c.reality && !c.todo && !c.special && (
          <div className="fact">
            <Label icon={Search}>{t('בביקורות')}</Label>
            <p dir="auto" className="clamp">{keepRanges(c.reality)}</p>
          </div>
        )}
      </div>
      {top && (
        <button className="link more-btn" onClick={() => setMore(true)}>
          <Icon as={ChevronUp} /> {t('עוד פרטים')}
        </button>
      )}
      {more &&
        createPortal(
          <Sheet title={c.name} onClose={() => setMore(false)}>
            <div className="card-full">
              <CardFull c={c} />
            </div>
            <div className="sheet-decide">
              <button className="round nope" onClick={() => decide(-1)} aria-label={t('דלג')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
              <button className="round like" onClick={() => decide(1)} aria-label={t('אהבתי')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path className="fill" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.7 4 4.5 7.2 4.5c1.9 0 3.4 1 4.8 2.8 1.4-1.8 2.9-2.8 4.8-2.8 3.2 0 5.6 3.2 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" /></svg>
              </button>
            </div>
          </Sheet>,
          document.body,
        )}
      <span className="tint like-tint" style={{ opacity: dx > 0 ? p * 0.35 : 0 }} aria-hidden="true" />
      <span className="tint nope-tint" style={{ opacity: dx < 0 ? p * 0.35 : 0 }} aria-hidden="true" />
    </div>
  )
}

/** Everything a card says, as the full sheet shows it. */
function CardFull({ c }: { c: Candidate }) {
  return (
    <>
      <Tags c={c} />
      {c.serves && (
        <div className="fact">
          <Label icon={Utensils}>{t('מה מגישים')}</Label>
          <p dir="auto">{keepRanges(c.serves)}</p>
          {!!c.dishes?.length && (
            <div className="dishes">
              {c.dishes.map((d) => (
                <span key={d} className="pill" dir="auto">
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {c.kosher_note && (
        <div className="fact">
          <Label icon={UtensilsCrossed}>{t('כשרות (בלי חזיר ופירות ים)')}</Label>
          <p dir="auto">{keepRanges(c.kosher_note)}</p>
        </div>
      )}
      {c.todo && (
        <div className="fact">
          {c.serves ? <Label icon={ReceiptText}>{t('איך זה עובד')}</Label> : <Label icon={Target}>{t('מה עושים שם')}</Label>}
          <p dir="auto">{keepRanges(c.todo)}</p>
          {c.time_needed && <p className="muted small"><Icon as={Timer} /> {c.time_needed}</p>}
        </div>
      )}
      {c.special && (
        <div className="fact">
          <Label icon={Sparkles}>{t('מה מיוחד')}</Label>
          <p dir="auto">{keepRanges(c.special)}</p>
          {!!c.highlights?.length && (
            <div className="dishes">
              {c.highlights.map((h) => (
                <span key={h} className="pill" dir="auto">
                  {h}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {c.hype && (
        <div className="fact">
          <Label icon={MessageSquare}>{t('ברשתות')}</Label>
          <p dir="auto">{keepRanges(c.hype)}</p>
        </div>
      )}
      {c.reality && (
        <div className="fact">
          <Label icon={Search}>{t('בביקורות')}</Label>
          <p dir="auto">{keepRanges(c.reality)}</p>
        </div>
      )}
      {c.baby_notes && (
        <div className="fact">
          {c.audience === 'adults' ? <Label icon={Wine}>{t('למה בלי התינוק')}</Label> : <Label icon={Baby}>{t('עם תינוק')}</Label>}
          <p dir="auto">{keepRanges(c.baby_notes)}</p>
        </div>
      )}
      {c.tip && (
        <div className="fact">
          <Label icon={Lightbulb}>{t('טיפ')}</Label>
          <p dir="auto">{keepRanges(c.tip)}</p>
        </div>
      )}
      <MediaActions name={c.name} maps={c.maps_url} website={c.website_url} m={c} />
      {c.sources.some((s) => safeUrl(s)) && (
        <div className="row">
          {c.sources.flatMap((s) => safeUrl(s) ?? []).slice(0, 4).map((s, i) => (
            <a key={s} className="pill" href={s} target="_blank" rel="noreferrer">
              {t('מקור {n}', { n: i + 1 })}
            </a>
          ))}
        </div>
      )}
    </>
  )
}

/** Who voted what on a card: a green heart for yes, a red x for no. */
function Votes({ c, swipes, members }: { c: Candidate; swipes: Swipe[]; members: Member[] }) {
  const votes = members.flatMap((m) => {
    const s = swipes.find((x) => x.candidate_id === c.id && x.user_id === m.user_id)
    return s ? [{ m, liked: s.liked }] : []
  })
  if (!votes.length) return null
  return (
    <div className="veto-votes">
      {votes.map((v) => (
        <span key={v.m.user_id} className={'verdict ' + (v.liked ? 'good' : 'bad')}>
          <Icon as={v.liked ? Heart : X} /> {t(v.m.display_name)}
        </span>
      ))}
    </div>
  )
}

/** A card opened from search: the votes so far, or that nobody has voted yet. */
function FocusVotes({ c, swipes, members, userId }: { c: Candidate; swipes: Swipe[]; members: Member[]; userId: string }) {
  const any = swipes.some((s) => s.candidate_id === c.id)
  const mine = swipes.find((s) => s.candidate_id === c.id && s.user_id === userId)
  return (
    <div className="fact">
      <Votes c={c} swipes={swipes} members={members} />
      <p className="muted small">
        {!any ? t('עוד אף אחד לא הצביע') : mine ? (mine.liked ? t('אהבת את המקום. אפשר לשנות למטה.') : t('דילגת על המקום. אפשר לשנות למטה.')) : t('עוד לא הצבעת')}
      </p>
    </div>
  )
}

function Tags({ c }: { c: Candidate }) {
  const verdict = c.verdict ? VERDICTS[c.verdict] : null
  const kosher = c.kosher ? KOSHER[c.kosher] : null
  return (
    <>
      <div className="row tags">
        {verdict && <div className={'verdict ' + verdict.tone}>{verdict.label}</div>}
        {c.audience && (
          <div className={'verdict aud-' + c.audience}>
            {AUDIENCE_ICON[c.audience] && <Icon as={AUDIENCE_ICON[c.audience]} />} {AUDIENCES[c.audience]}
          </div>
        )}
        {kosher && (
          <div className={'verdict ' + kosher.tone}>
            <Icon as={UtensilsCrossed} /> {kosher.label}
          </div>
        )}
        {c.local_pick && (
          <div className="verdict local">
            <Icon as={Users} /> {t('מקומיים ממליצים')}
          </div>
        )}
      </div>
      {(c.tabelog_score != null || c.google_score != null) && (
        <div className="scores">
          {c.tabelog_score != null && <span>Tabelog <Icon as={Star} /> <bdi>{c.tabelog_score}</bdi></span>}
          {c.google_score != null && <span>Google <Icon as={Star} /> <bdi>{c.google_score}</bdi></span>}
        </div>
      )}
    </>
  )
}

function Label({ icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <b className="fact-label">
      <Icon as={icon} /> {children}
    </b>
  )
}

function nameOf(members: Member[], id: string) {
  // a person's name in the app's language (the group's names have English in the dictionary)
  return t(members.find((m) => m.user_id === id)?.display_name ?? '?')
}

/** % of shared swipes where two members made the same call; null when there's nothing to compare. */
function agreement(swipes: Swipe[], a: string, b: string) {
  const mine = new Map(swipes.filter((s) => s.user_id === a).map((s) => [s.candidate_id, s.liked]))
  const both = swipes.filter((s) => s.user_id === b && mine.has(s.candidate_id))
  if (both.length < 3) return null
  return Math.round((both.filter((s) => mine.get(s.candidate_id) === s.liked).length / both.length) * 100)
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
