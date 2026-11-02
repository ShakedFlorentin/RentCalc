import { useEffect, useState, type KeyboardEvent } from 'react'
import { Star } from 'lucide-react'
import { supabase } from '../supabase'
import type { PlaceRating } from '../types'
import { mutate, readCache, writeCache } from '../lib'
import { locale, t } from '../i18n'
import { Icon } from '../icons'
import { smoothedStars } from '../rank'
import '../styles/ratings.css'

// Ratings hang on the shared library card, not on the trip's copy, so a later trip with the same place sees what
// earlier travellers thought. Full rows (with who wrote them) are readable only for your own ratings and the trips you
// are in; everyone else's arrive as a count, a star total and a couple of anonymous notes (rating_summary). Each person
// writes only their own row.

const COLS = 'library_id, user_id, trip_id, stars, note, updated_at'
const CACHE = 'place_ratings_v2'
const NOTE_MAX = 500
/** rating_summary reads at most this many cards per call */
const SUMMARY_BATCH = 200

/** What other travellers (outside your trips) said about one card: how many, the star total, anonymous notes. */
type Extra = { n: number; sum: number; notes: string[] }
type Saved = { rows: Record<string, PlaceRating[]>; extra: Record<string, Extra> }
type SummaryRow = { library_id: string; n: number; stars_sum: number; notes: string[] | null }

/** n ratings adding up to sum, as a list of stars: the mean and the count are exact, which is all smoothing reads. */
function starsFrom(n: number, sum: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(sum / n)
  const high = sum - base * n
  return Array.from({ length: n }, (_, i) => (i < high ? base + 1 : base))
}

/** The ratings of these library cards, in two queries, newest first. The last copy is kept on the phone for offline. */
export function useRatings(ids: (string | null | undefined)[]) {
  // a stable key, so a new array with the same cards doesn't ask again
  const key = [...new Set(ids.filter((x): x is string => !!x))].sort().join(',')
  const [saved, setSaved] = useState<Saved>(() => readCache<Saved>(CACHE)?.data ?? { rows: {}, extra: {} })

  useEffect(() => {
    if (!key) return
    const list = key.split(',')
    let live = true
    const own = supabase.from('place_ratings').select(COLS).in('library_id', list).order('updated_at', { ascending: false })
    const others = Promise.all(
      Array.from({ length: Math.ceil(list.length / SUMMARY_BATCH) }, (_, i) =>
        supabase.rpc('rating_summary', { library_ids: list.slice(i * SUMMARY_BATCH, (i + 1) * SUMMARY_BATCH) }),
      ),
    )
    Promise.all([own, others]).then(([mine, sums]) => {
      // offline or refused: keep what's on screen
      if (!live || mine.error || !mine.data || sums.some((r) => r.error)) return
      const rows: Saved['rows'] = Object.fromEntries(list.map((id) => [id, []]))
      for (const r of mine.data as PlaceRating[]) (rows[r.library_id] ??= []).push(r)
      const extra: Saved['extra'] = Object.fromEntries(list.map((id) => [id, { n: 0, sum: 0, notes: [] }]))
      for (const r of sums.flatMap((x) => (x.data ?? []) as SummaryRow[]))
        extra[r.library_id] = { n: r.n, sum: r.stars_sum, notes: r.notes ?? [] }
      setSaved((old) => ({ rows: { ...old.rows, ...rows }, extra: { ...old.extra, ...extra } }))
      const was = readCache<Saved>(CACHE)?.data
      writeCache(CACHE, { rows: { ...(was?.rows ?? {}), ...rows }, extra: { ...(was?.extra ?? {}), ...extra } })
    })
    return () => {
      live = false
    }
  }, [key])

  const rowsOf = (id: string) => saved.rows[id] ?? []
  return {
    /** the full rows you may read: yours and your trips' */
    of: rowsOf,
    /** every star given to this card, yours and other travellers' (for averages and ranking) */
    stars: (id: string) => [...rowsOf(id).map((r) => r.stars), ...starsFrom(saved.extra[id]?.n ?? 0, saved.extra[id]?.sum ?? 0)],
    /** the same without one person's own rating, plus up to two notes (newest first, no names) */
    others: (id: string, userId?: string) => {
      const rows = rowsOf(id).filter((r) => r.user_id !== userId)
      const e = saved.extra[id]
      return {
        stars: [...rows.map((r) => r.stars), ...starsFrom(e?.n ?? 0, e?.sum ?? 0)],
        notes: [...rows.flatMap((r) => r.note?.trim() ?? []), ...(e?.notes ?? [])].slice(0, 2),
      }
    },
    /** lay a saved rating over the list at once, without asking the server again */
    put: (r: PlaceRating) =>
      setSaved((old) => ({
        ...old,
        rows: { ...old.rows, [r.library_id]: [r, ...(old.rows[r.library_id] ?? []).filter((x) => x.user_id !== r.user_id)] },
      })),
  }
}

export type Ratings = ReturnType<typeof useRatings>

const starsLabel = (n: number) => (n === 1 ? t('כוכב אחד') : t('{n} כוכבים', { n }))
const countLabel = (n: number) => (n === 1 ? t('דירוג אחד') : t('{n} דירוגים', { n }))

/** Your stars and note for a place you went to, with what other travellers said under them. */
export function RateBox(props: { libraryId: string; tripId: string; userId: string; ratings: Ratings; prior?: number }) {
  const { libraryId, tripId, userId, ratings, prior } = props
  const all = ratings.of(libraryId)
  const mine = all.find((r) => r.user_id === userId)
  // the star tapped, shown until the save answers
  const [picked, setPicked] = useState<number | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const stars = picked ?? mine?.stars ?? 0

  const save = async (n: number, note: string | null) => {
    setPicked(n)
    const row = { library_id: libraryId, trip_id: tripId, stars: n, note }
    const ok = await mutate(supabase.from('place_ratings').upsert(row, { onConflict: 'library_id,user_id' }))
    if (ok) ratings.put({ ...row, user_id: userId, updated_at: new Date().toISOString() })
    setPicked(null)
    return ok
  }

  const saveNote = async () => {
    const note = draft?.trim().slice(0, NOTE_MAX) || null
    if (await save(stars, note)) setDraft(null)
  }

  return (
    // taps in here are for the rating, not for opening the place's sheet
    <div className="rate-box" onClick={(e) => e.stopPropagation()}>
      <div className="rate-head">
        <span className="rate-ask">{t('איך היה?')}</span>
        <StarsInput value={stars} onChange={(n) => save(n, mine?.note ?? null)} />
      </div>
      {stars > 0 && draft === null && (
        <div className="rate-mine">
          {mine?.note && (
            // the note isolated, not the paragraph: its bar stays on the app's side whatever language it's in
            <p className="rate-note">
              <bdi>{mine.note}</bdi>
            </p>
          )}
          <button className="link small" onClick={() => setDraft(mine?.note ?? '')}>
            {mine?.note ? t('עריכת ההערה') : t('הוספת הערה למטיילים הבאים')}
          </button>
        </div>
      )}
      {draft !== null && (
        <div className="rate-write">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={NOTE_MAX}
            rows={2}
            dir="auto"
            autoFocus
            aria-label={t('הערה למטיילים הבאים')}
            placeholder={t('מה כדאי לדעת? (לא חובה)')}
          />
          <div className="row">
            <button className="chip on" onClick={saveNote}>
              {t('שמירה')}
            </button>
            <button className="link small" onClick={() => setDraft(null)}>
              {t('ביטול')}
            </button>
          </div>
        </div>
      )}
      <RatingSummary {...ratings.others(libraryId, userId)} label={t('מטיילים אחרים')} prior={prior} />
    </div>
  )
}

/** Five stars to tap, a radio group for screen readers and the keyboard (arrows move, as in any radio group). */
export function StarsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    // right to left, the next star is on the left
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const step =
      e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? 1
        : e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? -1
          : 0
    if (!step) return
    e.preventDefault()
    const next = Math.min(5, Math.max(1, value + step))
    const group = e.currentTarget.parentElement
    ;(group?.children[next - 1] as HTMLElement | undefined)?.focus()
    if (next !== value) onChange(next)
  }
  return (
    <div className="stars" role="radiogroup" aria-label={t('הדירוג שלך')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={starsLabel(n)}
          // one tab stop for the group: the chosen star, or the first one
          tabIndex={(value || 1) === n ? 0 : -1}
          className={n <= value ? 'on' : ''}
          onClick={() => n !== value && onChange(n)}
          onKeyDown={onKey}
        >
          <Icon as={Star} size={26} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

/**
 * "★ 4.5 · 3 ratings" and the latest notes; nothing at all when nobody has rated yet. The number is a Bayesian mean
 * (see rank.ts): `prior` is the average of the place's category, so three 5-star ratings don't read as a perfect 5.0.
 */
export function RatingSummary({ stars, notes, label, prior }: { stars: number[]; notes: string[]; label?: string; prior?: number }) {
  if (!stars.length) return null
  const avg = smoothedStars(stars, prior)
  const avgText = avg.toLocaleString(locale, { maximumFractionDigits: 1 })
  return (
    <div className="rate-sum">
      <div className="rate-avg">
        {label && <span>{label}: </span>}
        <span className="rate-star" aria-hidden="true">
          ★
        </span>
        <span className="rate-sr">{t('ממוצע כוכבים')}</span> <bdi>{avgText}</bdi> · {countLabel(stars.length)}
      </div>
      {notes.map((n, i) => (
        <p key={i} className="rate-note clamp">
          <bdi>{n}</bdi>
        </p>
      ))}
    </div>
  )
}

/** A card's ratings from everyone who rated it (the swipe card's full view); loads them itself, one query. */
export function CardRatings({ libraryId, prior }: { libraryId?: string | null; prior?: number }) {
  const ratings = useRatings([libraryId])
  if (!libraryId) return null
  const all = ratings.others(libraryId)
  if (!all.stars.length) return null
  return (
    <div className="fact">
      <b className="fact-label">
        <Icon as={Star} /> {t('מטיילים שהיו שם')}
      </b>
      <RatingSummary {...all} prior={prior} />
    </div>
  )
}
