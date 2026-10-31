import { FormEvent, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { Field } from '../ui'
import { t } from '../i18n'
import { forgetInvite } from './Login'

// accounts this phone already joined to their invite's trip: someone who later leaves that trip isn't pulled back in
const JOINED_KEY = 'inviteJoined'

function joinedBefore(userId: string) {
  try {
    return (JSON.parse(localStorage.getItem(JOINED_KEY) ?? '[]') as string[]).includes(userId)
  } catch {
    return false
  }
}

function rememberJoined(userId: string) {
  try {
    const ids = JSON.parse(localStorage.getItem(JOINED_KEY) ?? '[]') as string[]
    localStorage.setItem(JOINED_KEY, JSON.stringify([...ids, userId]))
  } catch {
    // worst case the next visit here joins the same trip again
  }
}

export default function TripPicker({ onPick }: { onPick: (id: string) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [tripName, setTripName] = useState(t('יפן'))
  const [start, setStart] = useState('')
  const [err, setErr] = useState('')
  // a new account came in through an invite: join that trip by itself before showing the picker
  const [auto, setAuto] = useState<'checking' | 'joining' | 'done'>('checking')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      const user = s.session?.user
      const given = ((user?.user_metadata?.name as string | undefined) ?? '').trim()
      if (given) setName((n) => n || given)
      const shown = given || (user?.email ?? '').split('@')[0]
      if (!user || joinedBefore(user.id)) return setAuto('done')
      const { data, error } = await supabase.rpc('my_invite')
      const invite = (Array.isArray(data) ? data[0] : data) as { trip_id: string; join_code: string } | null
      if (error || !invite?.join_code) return setAuto('done')
      setAuto('joining')
      const joined = await supabase.rpc('join_trip', { code: invite.join_code, name: shown })
      if (joined.error || !joined.data) {
        // the code is ready in the join form: one tap to try again
        setCode(invite.join_code)
        setErr(t('לא הצלחנו לצרף אתכם לטיול. אפשר לנסות שוב עם הקוד.'))
        return setAuto('done')
      }
      rememberJoined(user.id)
      forgetInvite()
      onPick(joined.data as string)
    })()
  }, [])

  const join = async (e: FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabase.rpc('join_trip', { code, name })
    if (error) setErr(error.message)
    else if (!data) setErr(t('קוד טיול שגוי'))
    else onPick(data as string)
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabase.rpc('create_trip', {
      trip_name: tripName,
      name,
      start: start || null,
    })
    if (error) setErr(error.message)
    else onPick(data as string)
  }

  // the app's own loading look while checking, so people without an invite don't see a flash of anything else
  if (auto === 'checking') return <div className="center" role="status">{t('טוען…')}</div>
  if (auto === 'joining') return <div className="center" role="status">{t('מצטרפים לטיול…')}</div>

  return (
    <div className="login">
      <h1>{t('הצטרפות לטיול')}</h1>
      <div className="card">
        <Field label={t('איך קוראים לך?')}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('השם שיוצג לשאר המשתתפים')} />
        </Field>
      </div>

      <form onSubmit={join} className="card">
        <h3>{t('הצטרפות לטיול קיים')}</h3>
        <p className="muted small">{t('את הקוד מקבלים ממי שיצר את הטיול, הוא מופיע אצלו במסך הבית')}</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('קוד טיול')} dir="ltr" required />
        <button className="primary" disabled={!name.trim()}>
          {t('הצטרפות')}
        </button>
      </form>

      <form onSubmit={create} className="card">
        <h3>{t('יצירת טיול חדש')}</h3>
        <p className="muted small">{t('נוצר מסלול בסיסי של טוקיו, קיוטו ואוסקה, אפשר לערוך אותו')}</p>
        <Field label={t('שם הטיול')}>
          <input value={tripName} onChange={(e) => setTripName(e.target.value)} required />
        </Field>
        <Field label={t('תאריך התחלה (אפשר להשלים אחר כך)')}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <button className="secondary" disabled={!name.trim()}>
          {t('יצירת טיול')}
        </button>
      </form>
      {err && <p className="msg">{err}</p>}
      <button className="link" onClick={() => supabase.auth.signOut({ scope: 'local' })}>
        {t('התנתקות')}
      </button>
    </div>
  )
}
