import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { CARD_STYLE, CITY_HE, VERDICTS, type Candidate, type Member, type Swipe, type Trip } from '../types'
import { mutate, useTripTable } from '../lib'
import { Empty } from '../ui'

const LEVELS = [
  { xp: 0, name: 'גאיג׳ין 🐣' },
  { xp: 200, name: 'תייר 🎒' },
  { xp: 500, name: 'נוסע 🚅' },
  { xp: 1000, name: 'מקומי 🏮' },
  { xp: 2000, name: 'שוגון 🏯' },
]

type Props = { trip: Trip; userId: string; members: Member[] }

export default function SwipeGame({ trip, userId, members }: Props) {
  const { rows: candidates, loading } = useTripTable<Candidate>('candidates', trip.id)
  const { rows: swipes, reload: reloadSwipes } = useTripTable<Swipe>('swipes', trip.id)
  const [city, setCity] = useState('')
  const [match, setMatch] = useState<{ c: Candidate; names: string[] } | null>(null)
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
  const matchedIds = useMemo(
    () => new Set([...likes].filter(([, us]) => us.length >= trip.match_threshold).map(([id]) => id)),
    [likes, trip.match_threshold],
  )

  // celebrate every new match, whoever made it
  useEffect(() => {
    if (loading) return
    if (knownMatches.current === null) {
      knownMatches.current = new Set(matchedIds)
      return
    }
    for (const id of matchedIds) {
      if (knownMatches.current.has(id)) continue
      knownMatches.current.add(id)
      const c = candidates.find((x) => x.id === id)
      if (c) setMatch({ c, names: (likes.get(id) ?? []).map((u) => nameOf(members, u)) })
    }
  }, [matchedIds, loading, candidates, likes, members])

  const mine = new Set(swipes.filter((s) => s.user_id === userId).map((s) => s.candidate_id))
  const cities = Object.keys(CITY_HE).filter((c) => candidates.some((x) => x.city === c))
  const deck = candidates
    .filter((c) => !mine.has(c.id) && (!city || c.city === city))
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

  return (
    <div className="stack">
      <section className="card board">
        <div className="row spread">
          <h3>🏆 טבלת השחקנים</h3>
          <span className="pill">💘 {matchedIds.size} מאצ׳ים</span>
        </div>
        {board.map((b, i) => (
          <div key={b.m.user_id} className="player">
            <span className="rank">{['🥇', '🥈', '🥉'][i] ?? '🎖️'}</span>
            <div className="player-body">
              <div className="row spread">
                <b>
                  {b.m.display_name}
                  {b.m.user_id === userId && ' (אני)'}
                </b>
                <span className="small muted">
                  {b.level.name} · {b.xp} XP
                </span>
              </div>
              <div className="bar">
                <div style={{ width: `${candidates.length ? (b.done / candidates.length) * 100 : 0}%` }} />
              </div>
              {b.m.user_id !== userId && b.twin !== null && (
                <div className="small muted">התאמת טעם איתך: {b.twin}%</div>
              )}
            </div>
          </div>
        ))}
        <p className="small muted">
          מקום נכנס לרשימה כשלפחות {trip.match_threshold} מכם אוהבים אותו · כל החלקה 10 XP, כל מאצ׳ 50 XP
        </p>
      </section>

      <div className="chips scroll">
        <button className={'chip' + (!city ? ' on' : '')} onClick={() => setCity('')}>
          הכל
        </button>
        {cities.map((c) => (
          <button key={c} className={'chip' + (city === c ? ' on' : '')} onClick={() => setCity(c)}>
            {CITY_HE[c]}
          </button>
        ))}
      </div>

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
          <button className="round small-round" onClick={undo} disabled={!history.length} aria-label="ביטול">
            ↩️
          </button>
          <button className="round nope" onClick={() => swipe(deck[0], false)} aria-label="דלג">
            ✕
          </button>
          <button className="round like" onClick={() => swipe(deck[0], true)} aria-label="אהבתי">
            ♥
          </button>
          <span className="small muted left-count">נשארו {deck.length}</span>
        </div>
      )}

      {match && (
        <div className="backdrop center-modal" onClick={() => setMatch(null)}>
          <div className="match-pop">
            <div className="confetti">🎉🍣🏯🎌🍜🎉</div>
            <h2>זה מאצ׳!</h2>
            <p>
              <b>{match.c.name}</b> נכנס לרשימה שלכם
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
  const start = useRef<number | null>(null)
  const style = CARD_STYLE[c.category] ?? CARD_STYLE.sight
  const verdict = c.verdict ? VERDICTS[c.verdict] : null

  const fly = (dir: 1 | -1) => {
    setLeaving(dir)
    setTimeout(() => onSwipe(dir === 1), 220)
  }
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return
    start.current = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => start.current !== null && setDx(e.clientX - start.current)
  const up = () => {
    if (start.current === null) return
    start.current = null
    // RTL doesn't change the gesture: right = like, as on every dating app
    if (dx > 90) fly(1)
    else if (dx < -90) fly(-1)
    else setDx(0)
  }

  const x = leaving ? leaving * 600 : dx
  return (
    <div
      className={'swipe-card' + (top ? ' top' : ' under')}
      style={{
        transform: top ? `translateX(${x}px) rotate(${x / 18}deg)` : undefined,
        transition: start.current !== null ? 'none' : 'transform 0.22s ease-out',
      }}
      onPointerDown={top ? down : undefined}
      onPointerMove={top ? move : undefined}
      onPointerUp={top ? up : undefined}
      onPointerCancel={top ? up : undefined}
    >
      <div className="card-hero" style={{ background: style.bg }}>
        <span className="card-emoji">{style.emoji}</span>
        <span className="stamp like-stamp" style={{ opacity: Math.max(0, dx / 90) }}>
          בא לי!
        </span>
        <span className="stamp nope-stamp" style={{ opacity: Math.max(0, -dx / 90) }}>
          פאס
        </span>
        <div className="card-title">
          <h2 dir="auto">{c.name}</h2>
          {c.name_ja && <div className="ja">{c.name_ja}</div>}
          <div className="small">
            📍 {CITY_HE[c.city] ?? c.city}
            {c.area && ` · ${c.area}`} · {style.label}
            {c.price && ` · ${c.price}`}
          </div>
        </div>
      </div>
      <div className="card-info">
        {verdict && <div className={'verdict ' + verdict.tone}>{verdict.label}</div>}
        <div className="scores">
          {c.tabelog_score != null && <span>Tabelog ⭐ {c.tabelog_score}</span>}
          {c.google_score != null && <span>Google ⭐ {c.google_score}</span>}
        </div>
        {c.hype && (
          <div>
            <b>📱 ברשתות:</b>
            <div dir="auto">{c.hype}</div>
          </div>
        )}
        {c.reality && (
          <div>
            <b>🔍 בביקורות:</b>
            <div dir="auto">{c.reality}</div>
          </div>
        )}
        {more && c.tip && (
          <div>
            <b>💡 טיפ:</b>
            <div dir="auto">{c.tip}</div>
          </div>
        )}
        {more && c.sources.length > 0 && (
          <div className="row">
            {c.sources.slice(0, 4).map((s, i) => (
              <a key={s} className="pill" href={s} target="_blank" rel="noreferrer">
                מקור {i + 1}
              </a>
            ))}
          </div>
        )}
        {top && (
          <button className="link" onClick={() => setMore(!more)}>
            {more ? 'פחות' : 'טיפ ומקורות ⌄'}
          </button>
        )}
      </div>
    </div>
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
