import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Empty, Sheet } from '../ui'
import { Icon } from '../icons'
import { t } from '../i18n'
import { Camera, ChevronLeft } from 'lucide-react'

const MAX_SIDE = 1600

/** The picked photo as a JPEG at most 1600px long; drawing it anew also drops its location and other hidden data. */
async function toJpeg(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error('no image'))), 'image/jpeg', 0.85))
}

/** A traveller sends their own photo of a place; it shows on the card only after an admin approves it. */
export function AddPhoto({ name, tripId, libraryId, onClose }: { name: string; tripId: string; libraryId: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const send = async () => {
    if (!file || !rights) return
    setBusy(true)
    setErr('')
    try {
      const { data: auth } = await supabase.auth.getUser()
      const path = `${tripId}/${auth.user?.id}/${crypto.randomUUID()}.jpg`
      const up = await supabase.storage.from('photo-submissions').upload(path, await toJpeg(file), { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const row = await supabase.from('photo_submissions').insert({ library_id: libraryId, trip_id: tripId, path, rights_confirmed: true })
      if (row.error) {
        await supabase.storage.from('photo-submissions').remove([path])
        throw row.error
      }
      setSent(true)
    } catch (e) {
      console.error('photo not sent', e)
      setErr(t('לא הצלחתי לשלוח את התמונה. אפשר לנסות שוב.'))
    }
    setBusy(false)
  }

  return (
    <Sheet title={t('הוספת תמונה')} onClose={onClose}>
      {sent ? (
        <>
          <p>{t('התמונה נשלחה לאישור. היא תופיע בכרטיס אחרי שנאשר אותה.')}</p>
          <button className="primary" onClick={onClose}>{t('סגירה')}</button>
        </>
      ) : (
        <>
          <p className="muted small" dir="auto">{name}</p>
          <input type="file" accept="image/*" aria-label={t('בחירת תמונה')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {preview && <img className="photo-preview" src={preview} alt="" />}
          <label className="photo-rights">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            <span>{t('צילמתי את התמונה בעצמי, ואני מרשה לאפליקציה להציג אותה לכל המשתמשים. אין בה אנשים שאפשר לזהות בלי הסכמתם.')}</span>
          </label>
          {err && <p className="msg" role="alert">{err}</p>}
          <button className="primary" onClick={send} disabled={!file || !rights || busy}>
            {busy ? t('שולח…') : t('שליחה לאישור')}
          </button>
        </>
      )}
    </Sheet>
  )
}

type Waiting = { id: string; path: string; created_at: string; place_library: { name: string } | null; url?: string }

/** The admin's entry on the More tab, shown only to app admins, with the count of photos waiting. */
export function PhotoReviewEntry() {
  const [admin, setAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Waiting[]>([])
  const [err, setErr] = useState('')

  const load = async () => {
    const { data } = await supabase
      .from('photo_submissions')
      .select('id,path,created_at,place_library(name)')
      .eq('status', 'pending')
      .order('created_at')
      .limit(30)
      .returns<Waiting[]>()
    const list = data ?? []
    const signed = list.length ? (await supabase.storage.from('photo-submissions').createSignedUrls(list.map((r) => r.path), 600)).data : null
    setRows(list.map((r, i) => ({ ...r, url: signed?.[i]?.signedUrl ?? undefined })))
  }

  useEffect(() => {
    void supabase.rpc('is_app_admin').then(({ data }) => {
      if (data !== true) return
      setAdmin(true)
      void load()
    })
  }, [])

  const review = async (id: string, approve: boolean) => {
    setErr('')
    const { error } = await supabase.functions.invoke('review-photo', { body: { id, approve } })
    if (error) return setErr(t('הפעולה לא הצליחה. אפשר לנסות שוב.'))
    setRows((r) => r.filter((x) => x.id !== id))
  }

  if (!admin) return null
  return (
    <>
      <button className="prefs-entry" onClick={() => setOpen(true)}>
        <Icon as={Camera} size="1.375em" className="lead" />
        <span className="prefs-entry-text">
          <b>{t('תמונות לאישור')}</b>
          <span className="muted small">{t('{n} ממתינות', { n: rows.length })}</span>
        </span>
        <Icon as={ChevronLeft} className="flip-ltr muted" />
      </button>
      {open && (
        <Sheet title={t('תמונות לאישור')} onClose={() => setOpen(false)}>
          {err && <p className="msg" role="alert">{err}</p>}
          {!rows.length && <Empty>{t('אין תמונות שממתינות לאישור')}</Empty>}
          {rows.map((r) => (
            <div key={r.id} className="photo-review">
              {r.url && <img className="photo-preview" src={r.url} alt="" />}
              <b dir="auto">{r.place_library?.name}</b>
              <div className="row">
                <button className="primary" onClick={() => review(r.id, true)}>{t('אישור')}</button>
                <button className="link" onClick={() => review(r.id, false)}>{t('דחייה')}</button>
              </div>
            </div>
          ))}
        </Sheet>
      )}
    </>
  )
}
