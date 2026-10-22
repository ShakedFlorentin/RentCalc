import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabase'
import { AUDIENCES, CARD_STYLE, CITY_HE, VERDICTS, type Candidate, type Member, type Swipe, type Trip } from '../types'
import { matchFor, mutate, useMediaIndex, useTripTable, withMedia } from '../lib'
import AddPlace from './AddPlace'
import { Empty, Sheet } from '../ui'
import { MediaActions } from '../media'

const LEVELS = [
  { xp: 0, name: 'גאיג׳ין 🐣' },
  { xp: 200, name: 'תייר 🎒' },
  { xp: 500, name: 'נוסע 🚅' },
  { xp: 1000, name: 'מקומי 🏮' },
  { xp: 2000, name: 'שוגון 🏯' },
]

type Props = { trip: Trip; userId: string; members: Member[] }

export default function SwipeGame({ trip, userId, members }: Props) {
  const { rows: rawCandidates, loading } = useTripTable<Candidate>('candidates', trip.id)
  const media = useMediaIndex()
  const candidates = useMemo(() => rawCandidates.map((c) => withMedia(c, media)), [rawCandidates, media])
  const { rows: swipes, reload: reloadSwipes } = useTripTable<Swipe>('swipes', trip.id)
  const [city, setCity] = useState('')
  const [aud, setAud] = useState('')
  const [match, setMatch] = useState<{ c: Candidate; names: string[]; who: string | null } | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const knownMatches = useRef<Set<string> | null>(null)

  useEffect(() => {
    supabase.rpc('sync_library', { tid: trip.id })
  }, [trip.id])

  const likes = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of swipes) if (s.liked) m.set(s.candidate_id, [...(m.get(s.candidate_id) ?? []), s.user_id])
    return m
  }, [swipes])
  // candidate id → whose list it went on (a couple, or null for everyone)
  const matches = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const [id, us] of likes) {
      const hit = matchFor(us, members, trip.match_threshold)
      if (hit) m.set(id, hit.who)
    }
    return m
  }, [likes, members, trip.match_threshold])
  const matchedIds = useMemo(() => new Set(matches.keys()), [matches])

  // celebrate every new match, whoever made it
  useEffect(() => {
    if (loading) return
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
  }, [matches, loading, candidates, likes, members])

  const mine = new Set(swipes.filter((s) => s.user_id === userId).map((s) => s.candidate_id))
  const cities = Object.keys(CITY_HE).filter((c) => candidates.some((x) => x.city === c))
  const deck = candidates
    .filter((c) => !mine.has(c.id) && (!city || c.city === city) && (!aud || c.audience === aud))
    .sort((a, b) => hash(a.id + userId) - hash(b.id + userId))

  const swipe = async (c: Candidate, liked: boolean) => {
    const ok = await mutate(
      supabase.from('swipes').upsert({ trip_id: trip.id, candidate_id: c.id, user_id: userId, liked }),
    )
    if (ok) {
      setHistory((h) => [...h, c.id])
      reloadSwipes()
    }
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
  const me = members.find((m) => m.user_id === userId)?.display_name ?? ''

  return (
    <div className="swipe-screen">
      <button className="hud" onClick={() => setBoardOpen(true)} aria-label="פתיחת טבלת השחקנים">
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
          💘 <b>{matchedIds.size}</b>
        </span>
        <span className="hud-chevron" aria-hidden="true">🏆</span>
      </button>

      <div className="chips scroll filters" role="group" aria-label="סינון">
        <button className="chip add-chip" onClick={() => setAdding(true)}>
          ＋ הצעת מקום
        </button>
        <button className={'chip' + (!city && !aud ? ' on' : '')} aria-pressed={!city && !aud} onClick={() => (setCity(''), setAud(''))}>
          הכל
        </button>
        {Object.entries(AUDIENCES).map(([k, v]) => (
          <button key={k} className={'chip' + (aud === k ? ' on' : '')} aria-pressed={aud === k} onClick={() => setAud(aud === k ? '' : k)}>
            {v}
          </button>
        ))}
        <span className="chip-sep" aria-hidden="true" />
        {cities.map((c) => (
          <button key={c} className={'chip' + (city === c ? ' on' : '')} aria-pressed={city === c} onClick={() => setCity(city === c ? '' : c)}>
            {CITY_HE[c]}
          </button>
        ))}
      </div>

      {adding && <AddPlace tripId={trip.id} userId={userId} me={me} defaultTo="deck" onClose={() => setAdding(false)} />}

      {boardOpen && (
        <Sheet title="🏆 טבלת השחקנים" onClose={() => setBoardOpen(false)}>
          <div className="board">
            {board.map((b, i) => (
              <div key={b.m.user_id} className="player">
                <span className="rank">{['🥇', '🥈', '🥉'][i] ?? '🎖️'}</span>
                <div className="player-body">
                  <div className="row spread nowrap">
                    <b>
                      {b.m.display_name}
                      {b.m.user_id === userId && ' (אני)'}
                    </b>
                    <span className="small muted">
                      {b.level.name} · <bdi>{b.xp} XP</bdi>
                    </span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${candidates.length ? (b.done / candidates.length) * 100 : 0}%` }} />
                  </div>
                  {b.m.user_id !== userId && b.twin !== null && (
                    <div className="small muted">התאמת טעם איתך: {b.twin}%</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="small muted">
            מקום נכנס לרשימה כשלפחות {trip.match_threshold} מכם אוהבים אותו. כל החלקה שווה 10 XP, כל מאצ׳ 50 XP.
          </p>
        </Sheet>
      )}

      <div className="deck">
        {!loading && deck.length === 0 && (
          <Empty>
            {candidates.length ? 'סיימת את החפיסה! 🎉 חכו לחברים או בדקו את המאצ׳ים במקומות' : 'הסקאוטים עוד לא הביאו מקומות…'}
          </Empty>
        )}
        {deck
          .slice(0, 2)
          .reverse()
          .map((c, i, arr) => (
            <Card key={c.id} c={c} top={i === arr.length - 1} onSwipe={(liked) => swipe(c, liked)} />
          ))}
      </div>
      {deck.length > 0 && (
        <div className="swipe-buttons">
          <button className="round small-round" onClick={undo} disabled={!history.length} aria-label="ביטול החלקה אחרונה">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </button>
          <button className="round nope" onClick={() => swipe(deck[0], false)} aria-label="דלג">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <button className="round like" onClick={() => swipe(deck[0], true)} aria-label="אהבתי">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path className="fill" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.7 4 4.5 7.2 4.5c1.9 0 3.4 1 4.8 2.8 1.4-1.8 2.9-2.8 4.8-2.8 3.2 0 5.6 3.2 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" /></svg>
          </button>
          <span className="left-count" aria-live="polite">נשארו {deck.length}</span>
        </div>
      )}

      {match && (
        <div className="backdrop center-modal" onClick={() => setMatch(null)}>
          <div className="match-pop" role="dialog" aria-modal="true" aria-label="מאצ׳" onClick={(e) => e.stopPropagation()}>
            <div className="confetti">🎉🍣🏯🎌🍜🎉</div>
            <h2>זה מאצ׳!</h2>
            <p>
              <b dir="auto">{match.c.name}</b> נכנס {match.who ? `לרשימה של ${match.who}` : 'לרשימה של כולם'}
            </p>
            <p className="muted">{match.names.join(' · ')} אהבו</p>
            <button className="primary" onClick={() => setMatch(null)}>
              יאללה, ממשיכים 💪
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ c, top, onSwipe }: { c: Candidate; top: boolean; onSwipe: (liked: boolean) => void }) {
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0)
  const [more, setMore] = useState(false)
  const [photo, setPhoto] = useState(0)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const start = useRef<number | null>(null)
  const moved = useRef(false)
  const onInfo = useRef(false)
  const style = CARD_STYLE[c.category] ?? CARD_STYLE.sight
  const photos = (c.photos ?? []).filter((u) => !broken.has(u))
  const cur = photos[Math.min(photo, photos.length - 1)]

  const fly = (dir: 1 | -1) => {
    setLeaving(dir)
    navigator.vibrate?.(12)
    setTimeout(() => onSwipe(dir === 1), 200)
  }
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return
    start.current = e.clientX
    moved.current = false
    onInfo.current = !!(e.target as HTMLElement).closest('.card-info')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    if (start.current === null) return
    const d = e.clientX - start.current
    if (Math.abs(d) > 6) moved.current = true
    setDx(d)
  }
  const up = () => {
    if (start.current === null) return
    start.current = null
    // the card holds the pointer while dragging, so a tap on the text is caught here, not as a click
    if (!moved.current && onInfo.current) {
      setDx(0)
      setMore(true)
      return
    }
    // RTL doesn't change the gesture: right = like, as on every dating app
    if (dx > 90) fly(1)
    else if (dx < -90) fly(-1)
    else setDx(0)
  }
  const decide = (dir: 1 | -1) => {
    setMore(false)
    fly(dir)
  }
  const cycle = (e: { stopPropagation: () => void }, step: number) => {
    e.stopPropagation()
    setPhoto((i) => (i + step + photos.length) % photos.length)
  }

  const x = leaving ? leaving * 600 : dx
  const p = Math.min(1, Math.abs(dx) / 90)
  return (
    <div
      className={'swipe-card' + (top ? ' top' : ' under')}
      style={{
        transform: top ? `translateX(${x}px) rotate(${x / 20}deg)` : undefined,
        transition: start.current !== null ? 'none' : 'transform 0.2s ease-out',
      }}
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
          <span className="card-emoji" aria-hidden="true">{style.emoji}</span>
        )}
        {top && photos.length > 1 && (
          <>
            <button className="photo-tap prev" aria-label="תמונה קודמת" onClick={(e) => cycle(e, -1)} />
            <button className="photo-tap next" aria-label="תמונה הבאה" onClick={(e) => cycle(e, 1)} />
            <div className="dots" aria-hidden="true">
              {photos.map((u, i) => (
                <i key={u} className={i === Math.min(photo, photos.length - 1) ? 'on' : ''} />
              ))}
            </div>
          </>
        )}
        <span className="stamp like-stamp" style={{ opacity: dx > 0 ? p : 0 }} aria-hidden="true">
          בא לי!
        </span>
        <span className="stamp nope-stamp" style={{ opacity: dx < 0 ? p : 0 }} aria-hidden="true">
          פאס
        </span>
        <div className="card-title">
          <h2 dir="auto">{c.name}</h2>
          {c.name_ja && (
            <div className="ja" lang="ja" dir="ltr">
              {c.name_ja}
            </div>
          )}
          <div className="card-meta">
            📍 {CITY_HE[c.city] ?? c.city}
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
                <bdi>{c.price}</bdi>
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
            <b>🍽️ מה מגישים</b>
            <p dir="auto" className="clamp">{c.serves}</p>
          </div>
        )}
        {c.hype && !c.serves && (
          <div className="fact">
            <b>📱 ברשתות</b>
            <p dir="auto" className="clamp">{c.hype}</p>
          </div>
        )}
        {c.reality && (
          <div className="fact">
            <b>🔍 בביקורות</b>
            <p dir="auto" className="clamp">{c.reality}</p>
          </div>
        )}
      </div>
      {top && (
        <button className="link more-btn" onClick={() => setMore(true)}>
          לקרוא הכול: טיפ, תינוק, קישורים וסרטון <span aria-hidden="true">⌃</span>
        </button>
      )}
      {more &&
        createPortal(
          <Sheet title={c.name} onClose={() => setMore(false)}>
            <div className="card-full">
              <Tags c={c} />
              {c.serves && (
                <div className="fact">
                  <b>🍽️ מה מגישים</b>
                  <p dir="auto">{c.serves}</p>
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
              {c.hype && (
                <div className="fact">
                  <b>📱 ברשתות</b>
                  <p dir="auto">{c.hype}</p>
                </div>
              )}
              {c.reality && (
                <div className="fact">
                  <b>🔍 בביקורות</b>
                  <p dir="auto">{c.reality}</p>
                </div>
              )}
              {c.baby_notes && (
                <div className="fact">
                  <b>{c.audience === 'adults' ? '🍸 למה בלי התינוק' : '👶 עם תינוק'}</b>
                  <p dir="auto">{c.baby_notes}</p>
                </div>
              )}
              {c.tip && (
                <div className="fact">
                  <b>💡 טיפ</b>
                  <p dir="auto">{c.tip}</p>
                </div>
              )}
              <MediaActions name={c.name} maps={c.maps_url} website={c.website_url} m={c} />
              {c.sources.length > 0 && (
                <div className="row">
                  {c.sources.slice(0, 4).map((s, i) => (
                    <a key={s} className="pill" href={s} target="_blank" rel="noreferrer">
                      מקור {i + 1}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="sheet-decide">
              <button className="round nope" onClick={() => decide(-1)} aria-label="דלג">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
              <button className="round like" onClick={() => decide(1)} aria-label="אהבתי">
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

function Tags({ c }: { c: Candidate }) {
  const verdict = c.verdict ? VERDICTS[c.verdict] : null
  return (
    <>
      <div className="row tags">
        {verdict && <div className={'verdict ' + verdict.tone}>{verdict.label}</div>}
        {c.audience && <div className={'verdict aud-' + c.audience}>{AUDIENCES[c.audience]}</div>}
        {c.local_pick && <div className="verdict local">🇯🇵 מקומיים ממליצים</div>}
      </div>
      {(c.tabelog_score != null || c.google_score != null) && (
        <div className="scores">
          {c.tabelog_score != null && <span>Tabelog ⭐ <bdi>{c.tabelog_score}</bdi></span>}
          {c.google_score != null && <span>Google ⭐ <bdi>{c.google_score}</bdi></span>}
        </div>
      )}
    </>
  )
}

function nameOf(members: Member[], id: string) {
  return members.find((m) => m.user_id === id)?.display_name ?? '?'
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
