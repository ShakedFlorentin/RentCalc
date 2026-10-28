import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import { Field } from '../ui'
import { t } from '../i18n'

export default function TripPicker({ onPick }: { onPick: (id: string) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [tripName, setTripName] = useState(t('יפן'))
  const [start, setStart] = useState('')
  const [err, setErr] = useState('')

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
