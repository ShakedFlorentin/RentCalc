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
// earlier travellers thought. Anyone signed in can read them; each person writes only their own row.

const COLS = 'library_id, user_id, trip_id, stars, note, updated_at'
const CACHE = 'place_ratings'
const NOTE_MAX = 500

type Saved = Record<string, PlaceRating[]>

/** The ratings of these library cards, in one query, newest first. The last copy is kept on the phone for offline. */
export function useRatings(ids: (string | null | undefined)[]) {
  // a stable key, so a new array with the same cards doesn't ask again
  const key = [...new Set(ids.filter((x): x is string => !!x))].sort().join(',')
  const [rows, setRows] = useState<Saved>(() => readCache<Saved>(CACHE)?.data ?? {})

  useEffect(() => {
    if (!key) return
    const list = key.split(',')
    let live = true
    supabase
      .from('place_ratings')
      .select(COLS)
      .in('library_id', list)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        // offline or refused: keep what's on screen
        if (!live || error || !data) return
        const fresh: Saved = Object.fromEntries(list.map((id) => [id, []]))
        for (const r of data as PlaceRating[]) (fresh[r.library_id] ??= []).push(r)
        setRows((old) => ({ ...old, ...fresh }))
        writeCache(CACHE, { ...(readCache<Saved>(CACHE)?.data ?? {}), ...fresh })
      })
    return () => {
      live = false
    }
  }, [key])

  return {
    of: (id: string) => rows[id] ?? [],
    /** lay a saved rating over the list at once, without asking the server again */
    put: (r: PlaceRating) =>
      setRows((old) => ({
        ...old,
        [r.library_id]: [r, ...(old[r.library_id] ?? []).filter((x) => x.user_id !== r.user_id)],
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
      <RatingSummary ratings={all.filter((r) => r.user_id !== userId)} label={t('מטיילים אחרים')} prior={prior} />
    </div>
  )
}

/** Five stars to tap, a radio group for screen readers and the keyboard (arrows move, as in any radio group). */
function StarsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
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
export function RatingSummary({ ratings, label, prior }: { ratings: PlaceRating[]; label?: string; prior?: number }) {
  if (!ratings.length) return null
  const avg = smoothedStars(ratings.map((r) => r.stars), prior)
  const avgText = avg.toLocaleString(locale, { maximumFractionDigits: 1 })
  // newest first already; a few short lines are enough on a card
  const notes = ratings.filter((r) => r.note?.trim()).slice(0, 2)
  return (
    <div className="rate-sum">
      <div className="rate-avg">
        {label && <span>{label}: </span>}
        <span className="rate-star" aria-hidden="true">
          ★
        </span>
        <span className="rate-sr">{t('ממוצע כוכבים')}</span> <bdi>{avgText}</bdi> · {countLabel(ratings.length)}
      </div>
      {notes.map((r) => (
        <p key={r.user_id} className="rate-note clamp">
          <bdi>{r.note}</bdi>
        </p>
      ))}
    </div>
  )
}

/** A card's ratings from everyone who rated it (the swipe card's full view); loads them itself, one query. */
export function CardRatings({ libraryId, prior }: { libraryId?: string | null; prior?: number }) {
  const ratings = useRatings([libraryId])
  if (!libraryId) return null
  const all = ratings.of(libraryId)
  if (!all.length) return null
  return (
    <div className="fact">
      <b className="fact-label">
        <Icon as={Star} /> {t('מטיילים שהיו שם')}
      </b>
      <RatingSummary ratings={all} prior={prior} />
    </div>
  )
}
