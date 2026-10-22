import { useState } from 'react'
import { supabase } from '../supabase'
import { AUDIENCES, CARD_STYLE, CITY_HE, VERDICTS, type Candidate } from '../types'
import { mutate } from '../lib'
import { Field, Sheet } from '../ui'

type Draft = Partial<Candidate> & { link?: string }
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

  const research = async () => {
    if (!link.trim() && !note.trim()) return
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.functions.invoke('suggest-place', { body: { link: link.trim(), text: note.trim() } })
    setBusy(false)
    if (error || !data) {
      setErr('החיפוש לא הצליח. אפשר לנסות שוב או למלא ידנית.')
      return
    }
    if (!data.found) setErr('לא זיהיתי מקום ספציפי – בדקו את הפרטים או השלימו ידנית.')
    setDraft({ ...data, link: link.trim() })
  }

  const save = async (d: Draft) => {
    if (!d.name?.trim() || !d.city) return
    setBusy(true)
    const l = d.link?.trim() || null
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
    let ok: boolean
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
          sources: d.sources ?? (l ? [l] : []),
        })
        .select('id')
        .single()
      ok = !error
      if (error) alert('שגיאה: ' + error.message)
      // suggesting a place counts as liking it
      else await supabase.from('swipes').insert({ trip_id: tripId, candidate_id: data.id, user_id: userId, liked: true })
    } else {
      const cat = d.category === 'cafe' ? 'food' : ['food', 'sight', 'shopping'].includes(d.category ?? '') ? d.category : 'other'
      ok = await mutate(
        supabase.from('places').insert({
          ...base,
          instagram_url: social.instagram_url,
          tiktok_url: social.tiktok_url,
          city: CITY_HE[d.city] ?? d.city,
          category: cat,
          url: social.maps_url,
          notes: [d.tip, d.baby_notes && '👶 ' + d.baby_notes].filter(Boolean).join('\n') || null,
        }),
      )
    }
    setBusy(false)
    if (ok) onClose()
  }

  const destination = (
    <div className="segmented" role="group" aria-label="לאן להוסיף">
      <button className={to === 'deck' ? 'on' : ''} onClick={() => setTo('deck')}>
        🔥 למשחק (הצבעה)
      </button>
      <button className={to === 'list' ? 'on' : ''} onClick={() => setTo('list')}>
        📍 ישר לרשימה
      </button>
    </div>
  )

  if (draft || mode === 'manual') {
    return (
      <Sheet title={draft ? 'זה המקום?' : 'הוספת מקום'} onClose={onClose}>
        <DraftForm
          draft={draft ?? { city: 'tokyo', category: 'food', audience: 'baby', link: '' }}
          researched={!!draft}
          busy={busy}
          err={err}
          destination={destination}
          onSave={save}
          onBack={() => (draft ? setDraft(null) : setMode('link'))}
        />
      </Sheet>
    )
  }

  return (
    <Sheet title="הצעת מקום" onClose={onClose}>
      <p className="muted small">
        מדביקים לינק מאינסטגרם / טיקטוק / גוגל מפות, או כותבים שם של מקום. Claude מזהה את המקום ובודק דירוגים, כתובת, ואם
        זה מתאים לתינוק.
      </p>
      <Field label="לינק">
        <input type="url" value={link} onChange={(e) => setLink(e.target.value)} dir="ltr" placeholder="https://www.instagram.com/reel/…" />
      </Field>
      <Field label="או שם / הערה (לא חובה)">
        <input value={note} onChange={(e) => setNote(e.target.value)} dir="auto" placeholder="למשל: הראמן מהסרטון, בשינג׳וקו" />
      </Field>
      {err && <p className="msg">{err}</p>}
      <button className="primary" onClick={research} disabled={busy || (!link.trim() && !note.trim())}>
        {busy ? 'מחפש פרטים… (עד דקה)' : '🔎 זיהוי ובדיקה'}
      </button>
      <button className="link" onClick={() => setMode('manual')}>
        ✍️ להוסיף ידנית בלי חיפוש
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
          {d.tabelog_score != null && <span className="small muted">Tabelog ⭐ {d.tabelog_score}</span>}
          {d.google_score != null && <span className="small muted">Google ⭐ {d.google_score}</span>}
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
                {v.emoji} {v.label}
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
      {props.researched && d.reality && (
        <div className="small">
          <b>🔍 בביקורות:</b> <span dir="auto">{d.reality}</span>
        </div>
      )}
      {props.researched && d.baby_notes && (
        <div className="small">
          <b>👶</b> <span dir="auto">{d.baby_notes}</span>
        </div>
      )}
      <Field label="טיפ / הערה">
        <textarea value={d.tip ?? ''} onChange={set('tip')} rows={2} dir="auto" />
      </Field>
      {!props.researched && (
        <Field label="לינק (אינסטגרם / טיקטוק / מפות – לא חובה)">
          <input type="url" value={d.link ?? ''} onChange={set('link')} dir="ltr" />
        </Field>
      )}
      {props.destination}
      <button className="primary" onClick={() => props.onSave(d)} disabled={props.busy || !d.name?.trim()}>
        {props.busy ? 'שומר…' : 'הוספה'}
      </button>
      <button className="link" onClick={props.onBack}>
        ← חזרה
      </button>
    </>
  )
}
