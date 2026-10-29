import { useState } from 'react'
import { supabase } from '../supabase'
import type { Report, Trip } from '../types'
import { fmtDay, mutate, useTripTable } from '../lib'
import { Field, Sheet } from '../ui'
import { Icon } from '../icons'
import { t } from '../i18n'
import { Check, Send } from 'lucide-react'
import '../styles/info.css'

const STATUS: Record<Report['status'], { label: string; cls: string }> = {
  open: { label: t('פתוח'), cls: 'open' },
  fixed: { label: t('תוקן'), cls: 'fixed' },
  wontfix: { label: t('לא יתוקן'), cls: 'wontfix' },
}

/**
 * Report a mistake or a problem. It lands in the `reports` table with the screen it was sent from, the build and
 * the phone, so it can be found and fixed later; the reply and status come back here once it's handled.
 */
export default function ReportSheet(props: { trip: Trip; me: string; from: string; onClose: () => void }) {
  const { rows, reload } = useTripTable<Report>('reports', props.trip.id)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
  // what's fixed (or won't be) is out of the way; its reply is still there behind one tap
  const open = sorted.filter((r) => r.status === 'open')
  const done = sorted.filter((r) => r.status !== 'open')

  const send = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    const ok = await mutate(
      supabase.from('reports').insert({
        trip_id: props.trip.id,
        reporter: props.me,
        body: text.slice(0, 2000),
        screen: props.from.slice(0, 100),
        app_version: String(import.meta.env.VITE_BUILD ?? 'dev').slice(0, 40),
        device: navigator.userAgent.slice(0, 300),
      }),
    )
    setBusy(false)
    if (ok) {
      setBody('')
      setSent(true)
      // reports aren't broadcast live, so fetch the list again to show the one just sent
      reload()
    }
  }

  return (
    <Sheet title={t('דיווח על בעיה')} onClose={props.onClose}>
      <Field label={t('מה לא עובד, או מה לא נכון?')}>
        <textarea
          rows={5}
          dir="auto"
          value={body}
          maxLength={2000}
          onChange={(e) => {
            setBody(e.target.value)
            setSent(false)
          }}
          placeholder={t('למשל: בהזמנות, הטיסה של יום ה׳ בשעה לא נכונה')}
        />
      </Field>
      <p className="muted small">
        {t('עם הדיווח נשמרים גם המסך ({screen}), גרסת האפליקציה וסוג הטלפון, כדי שיהיה קל לתקן.', { screen: props.from })}
      </p>
      {sent && (
        <p className="report-sent" role="status">
          <Icon as={Check} /> {t('נשלח, תודה. כשזה יטופל, התשובה תופיע תחת "טופלו".')}
        </p>
      )}
      <button className="primary" onClick={send} disabled={busy || !body.trim()}>
        <Icon as={Send} /> {busy ? t('שולח…') : t('שליחה')}
      </button>

      {open.length > 0 && (
        <section className="info-sec report-list">
          <h3>{t('ממתינים לתיקון')}</h3>
          {open.map(card)}
        </section>
      )}
      {done.length > 0 && (
        <section className="info-sec report-list">
          <button className="link" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? t('הסתרת מה שטופל') : t('טופלו ({n})', { n: done.length })}
          </button>
          {showDone && done.map(card)}
        </section>
      )}
    </Sheet>
  )
}

function card(r: Report) {
  return (
    <div key={r.id} className="card report">
      <div className="row spread nowrap">
        <span className="muted small">
          <bdi>{r.reporter ?? t('מישהו')}</bdi> · {fmtDay(new Date(r.created_at))}
          {r.screen && <> · <bdi>{r.screen}</bdi></>}
        </span>
        <span className={'report-status ' + STATUS[r.status].cls}>{STATUS[r.status].label}</span>
      </div>
      <p className="report-body" dir="auto">{r.body}</p>
      {r.reply && (
        <p className="report-reply" dir="auto">
          {r.reply}
        </p>
      )}
    </div>
  )
}
