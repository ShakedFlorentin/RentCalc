import { useState } from 'react'
import { supabase } from '../supabase'
import type { Report, Trip } from '../types'
import { fmtDay, mutate, useTripTable } from '../lib'
import { Field, Sheet } from '../ui'
import { Icon } from '../icons'
import { Check, Send } from 'lucide-react'
import '../styles/info.css'

const STATUS: Record<Report['status'], { label: string; cls: string }> = {
  open: { label: 'פתוח', cls: 'open' },
  fixed: { label: 'תוקן', cls: 'fixed' },
  wontfix: { label: 'לא יתוקן', cls: 'wontfix' },
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
  const reports = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))

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
    <Sheet title="דיווח על בעיה" onClose={props.onClose}>
      <Field label="מה לא עובד, או מה לא נכון?">
        <textarea
          rows={5}
          dir="auto"
          value={body}
          maxLength={2000}
          onChange={(e) => {
            setBody(e.target.value)
            setSent(false)
          }}
          placeholder="למשל: בהזמנות, הטיסה של יום ה׳ מופיעה בשעה לא נכונה"
        />
      </Field>
      <p className="muted small">
        עם הדיווח נשמרים גם המסך שממנו שלחת ({props.from}), גרסת האפליקציה וסוג הטלפון, כדי שיהיה קל למצוא ולתקן.
      </p>
      {sent && (
        <p className="report-sent" role="status">
          <Icon as={Check} /> נשלח, תודה. כשזה יטופל, התשובה תופיע כאן.
        </p>
      )}
      <button className="primary" onClick={send} disabled={busy || !body.trim()}>
        <Icon as={Send} /> {busy ? 'שולח…' : 'שליחה'}
      </button>

      {reports.length > 0 && (
        <section className="info-sec report-list">
          <h3>דיווחים קודמים</h3>
          {reports.map((r) => (
            <div key={r.id} className="card report">
              <div className="row spread nowrap">
                <span className="muted small">
                  <bdi>{r.reporter ?? 'מישהו'}</bdi> · {fmtDay(new Date(r.created_at))}
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
          ))}
        </section>
      )}
    </Sheet>
  )
}
