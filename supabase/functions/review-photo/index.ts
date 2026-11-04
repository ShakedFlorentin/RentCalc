// An app admin approves or rejects a photo a traveller sent. Approved: it is copied to the public card-photos bucket and
// added to the card in the library and on every trip. Rejected: the file is deleted. Waiting photos are never public.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/
const FROM = 'photo-submissions'
const TO = 'card-photos'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await user.auth.getUser()
  if (!auth.user) return json({ error: 'not signed in' }, 401)
  const { data: admin_ok } = await user.rpc('is_app_admin')
  if (admin_ok !== true) return json({ error: 'not an admin' }, 403)

  const body = (await req.json().catch(() => null)) as { id?: unknown; approve?: unknown } | null
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null
  if (!id || typeof body?.approve !== 'boolean') return json({ error: 'bad request' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: s } = await admin.from('photo_submissions').select('id,library_id,path,status').eq('id', id).maybeSingle()
  if (!s) return json({ error: 'not found' }, 404)
  if (s.status !== 'pending') return json({ error: 'already reviewed' }, 409)
  // the row's path goes to the storage calls below, which run with full rights
  if (!PATH.test(s.path)) return json({ error: 'bad path' }, 400)
  const done = { reviewed_at: new Date().toISOString(), reviewed_by: auth.user.id }

  if (!body.approve) {
    await admin.storage.from(FROM).remove([s.path])
    await admin.from('photo_submissions').update({ ...done, status: 'rejected' }).eq('id', id)
    return json({ ok: true })
  }

  const { data: file, error: readError } = await admin.storage.from(FROM).download(s.path)
  if (readError || !file) return json({ error: 'file missing' }, 410)
  const path = `submitted/${id}.jpg`
  const { error: upError } = await admin.storage.from(TO).upload(path, file, { contentType: 'image/jpeg', upsert: true })
  if (upError) {
    console.error('upload failed', upError.message)
    return json({ error: 'upload failed' }, 500)
  }
  const url = admin.storage.from(TO).getPublicUrl(path).data.publicUrl

  // the card's photos, on the library row and on each trip's copy
  const add = (photos: string[] | null) => [...(photos ?? []).filter((p) => p !== url), url]
  const { data: lib } = await admin.from('place_library').select('photos').eq('id', s.library_id).maybeSingle()
  await admin.from('place_library').update({ photos: add(lib?.photos ?? null) }).eq('id', s.library_id)
  const { data: cards } = await admin.from('candidates').select('id,photos').eq('library_id', s.library_id)
  for (const c of cards ?? []) {
    await admin.from('candidates').update({ photos: add(c.photos) }).eq('id', c.id)
    const { data: places } = await admin.from('places').select('id,photos').eq('candidate_id', c.id)
    for (const p of places ?? []) await admin.from('places').update({ photos: add(p.photos) }).eq('id', p.id)
  }
  await admin.from('photo_submissions').update({ ...done, status: 'approved', public_url: url }).eq('id', id)
  await admin.storage.from(FROM).remove([s.path])
  return json({ ok: true, url })
})
