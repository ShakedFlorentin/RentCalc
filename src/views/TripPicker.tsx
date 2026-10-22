import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import { Field } from '../ui'

export default function TripPicker({ onPick }: { onPick: (id: string) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [tripName, setTripName] = useState('יפן')
  const [start, setStart] = useState('')
  const [err, setErr] = useState('')

  const join = async (e: FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabase.rpc('join_trip', { code, name })
    if (error) setErr(error.message)
    else if (!data) setErr('קוד טיול שגוי')
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
      <h1>הצטרפות לטיול</h1>
      <div className="card">
        <Field label="איך קוראים לך?">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="השם שיוצג לשאר המשתתפים" />
        </Field>
      </div>

      <form onSubmit={join} className="card">
        <h3>הצטרפות לטיול קיים</h3>
        <p className="muted small">את קוד הטיול מקבלים ממי שיצר אותו, והוא מופיע במסך הבית שלו</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="קוד טיול" dir="ltr" required />
        <button className="primary" disabled={!name.trim()}>
          הצטרפות
        </button>
      </form>

      <form onSubmit={create} className="card">
        <h3>יצירת טיול חדש</h3>
        <p className="muted small">הטיול נוצר עם מסלול בסיסי של טוקיו, קיוטו ואוסקה, וניתן לערוך אותו</p>
        <Field label="שם הטיול">
          <input value={tripName} onChange={(e) => setTripName(e.target.value)} required />
        </Field>
        <Field label="תאריך התחלה (אפשר להשלים אחר כך)">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <button className="secondary" disabled={!name.trim()}>
          יצירת טיול
        </button>
      </form>
      {err && <p className="msg">{err}</p>}
      <button className="link" onClick={() => supabase.auth.signOut()}>
        התנתקות
      </button>
    </div>
  )
}
