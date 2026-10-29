// Finds 2-3 photos for a swipe card that has none: a place added from a link or a name arrives with text and facts
// but no pictures. Called by the database (trigger card_needs_photos via pg_net, with the planner token) right after
// such a card is inserted; also run by hand for older cards. Candidates come from the post it was added from (its
// cover frame), Tabelog's photos for places to eat and drink, the place's website and source pages (their share image
// and photos captioned with its name) and, for sights, Wikipedia and Wikimedia Commons. They are
// downloaded, small images and repeats dropped, one Claude call keeps the ones that show the place, and the keepers
// are stored in Storage (bucket card-photos), so a picture never expires the way Instagram's links do.
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.1.0/helpers/zod'
import { z } from 'npm:zod@4'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { logCall } from './ai-log.ts'

const MODEL = 'claude-haiku-5-5'
const BUCKET = 'card-photos'
const KEEP = 3
// images checked per card (each one costs a little in the Claude call)
const MAX_CHECKED = 8
// below this an image is an icon, a logo or a thumbnail
const MIN_BYTES = 15_000
const MIN_SIDE = 400
const UA = 'facebookexternalhit/1.1'

type Card = {
  id: string
  trip_id: string
  library_id: string | null
  name: string
  name_ja: string | null
  city: string | null
  area: string | null
  category: string | null
  website_url: string | null
  instagram_url: string | null
  tiktok_url: string | null
  maps_url: string | null
  sources: string[] | null
  photos: string[] | null
  serves: string | null
  todo: string | null
  hype: string | null
}
type Found = { url: string; from: string }
type Image = Found & { bytes: Uint8Array; type: string; w: number; h: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CITY = { tokyo: 'Tokyo', kyoto: 'Kyoto', osaka: 'Osaka', nara: 'Nara', daytrip: 'Japan' } as Record<string, string>
const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const body = (await req.json().catch(() => null)) as { candidate_id?: unknown; dry?: unknown } | null
  const cid = typeof body?.candidate_id === 'string' && UUID.test(body.candidate_id) ? body.candidate_id : null
  if (!cid) return json({ error: 'candidate_id missing' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // only the database calls this: it sends the planner token
  const token = req.headers.get('x-plan-token')
  const { data: expected } = await admin.rpc('get_planner_token')
  if (!token || token !== expected) return json({ error: 'bad token' }, 401)

  const work = fill(admin, cid, body?.dry === true)
  edge?.waitUntil(work)
  return json(await work)
})

async function fill(admin: SupabaseClient, cid: string, dry: boolean) {
  const { data: c } = await admin
    .from('candidates')
    .select('id,trip_id,library_id,name,name_ja,city,area,category,website_url,instagram_url,tiktok_url,maps_url,sources,photos,serves,todo,hype')
    .eq('id', cid)
    .maybeSingle<Card>()
  if (!c) return { skipped: 'no card' }
  if (c.photos?.length && !dry) return { skipped: 'has photos' }

  const found = await candidates(admin, c)
  const images = await download(found)
  if (!images.length) return { name: c.name, found: found.length, images: 0 }
  const keep = await pick(admin, c, images)
  const chosen = keep.map((i) => images[i]).slice(0, KEEP)
  const report = {
    name: c.name,
    found: found.map((f) => `${f.from}: ${f.url.slice(0, 120)}`),
    checked: images.map((im, i) => `${i} ${im.from} ${im.w}x${im.h} ${Math.round(im.bytes.length / 1000)}KB`),
    keep,
  }
  if (dry || !chosen.length) return report

  const urls: string[] = []
  for (const [i, im] of chosen.entries()) {
    const ext = im.type.split('/')[1].replace('jpeg', 'jpg')
    const path = `${c.id}/${i + 1}.${ext}`
    const { error } = await admin.storage.from(BUCKET).upload(path, im.bytes, { contentType: im.type, upsert: true })
    if (error) {
      console.error('upload failed', c.name, error.message)
      continue
    }
    urls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return { ...report, stored: 0 }
  await admin.from('candidates').update({ photos: urls }).eq('id', c.id)
  // a library card's photos are copied to every trip on sync, which would wipe the trip's copy: the library keeps them
  if (c.library_id) await admin.from('place_library').update({ photos: urls }).eq('id', c.library_id)
  await admin.from('places').update({ photos: urls }).eq('candidate_id', c.id)
  return { ...report, stored: urls.length }
}

/** Every image the place's own pages offer, best guesses first. */
async function candidates(admin: SupabaseClient, c: Card): Promise<Found[]> {
  const out: Found[] = []
  const sources = (c.sources ?? []).filter((s) => /^https:\/\//i.test(s))
  const social = [c.instagram_url, c.tiktok_url, ...sources].filter((s): s is string => !!s && /instagram\.com|tiktok\.com/i.test(s))
  // a roundup post ("5 cafes in Kyoto") is the source of several cards: its cover shows only one of them
  const { data: trip } = await admin.from('candidates').select('id,sources,instagram_url,tiktok_url').eq('trip_id', c.trip_id)
  const usedBy = (key: string) =>
    ((trip ?? []) as { instagram_url: string | null; tiktok_url: string | null; sources: string[] | null }[]).filter((x) => [x.instagram_url, x.tiktok_url, ...((x.sources as string[] | null) ?? [])].some((u) => u?.includes(key))).length
  for (const link of [...new Set(social)].slice(0, 3)) {
    const key = link.match(/\/(?:p|reel|reels|tv|video)\/([\w-]+)/)?.[1]
    if (key && usedBy(key) > 1) continue
    const cover = /tiktok\.com/i.test(link) ? await tiktokCover(link) : key ? await instagramCover(key) : null
    if (cover) out.push({ url: cover, from: 'post' })
  }
  const eats = ['food', 'cafe', 'nightlife'].includes(c.category ?? '')
  const pages = [c.website_url, ...sources.filter((s) => !/instagram\.com|tiktok\.com|tabelog\.com/i.test(s))]
  const list = [...new Set(pages.filter((p): p is string => !!p))].slice(0, 5)
  const [tabelog, own, wiki] = await Promise.all([
    eats ? tabelogPhotos(c, sources) : [],
    Promise.all(list.map(async (p) => (await pageImages(p, c)).map((url) => ({ url, from: p === c.website_url ? 'website' : new URL(p).hostname })))),
    eats ? [] : Promise.all([wikipedia(c), commons(c)]).then((l) => l.flat()),
  ])
  out.push(...tabelog, ...own.flat(), ...wiki)
  const seen = new Set<string>()
  return out.filter((f) => !seen.has(f.url) && seen.add(f.url))
}

const fetchText = async (url: string, ms = 8000) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en,ja;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(ms) })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return null
    return { html: (await r.text()).slice(0, 400_000), url: r.url }
  } catch {
    return null
  }
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"')

const absolute = (v: string, base: string) => {
  try {
    const u = new URL(decode(v.trim().split(/\s+/)[0]), base).href
    return /^https:\/\//.test(u) ? u : null
  } catch {
    return null
  }
}

/** A page's share image (og:image, twitter:image) and the photos on it captioned or named after the place. */
async function pageImages(page: string, c: Card) {
  const got = await fetchText(page)
  if (!got) return []
  const share: string[] = []
  for (const tag of got.html.match(/<(?:meta|link)\b[^>]*>/gi) ?? []) {
    if (!/(?:property|name|rel|itemprop)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?|image_src)["']/i.test(tag)) continue
    const v = tag.match(/(?:content|href)=["']([^"']+)["']/i)?.[1]
    const u = v && absolute(v, got.url)
    if (u) share.push(u)
  }
  // an article about several places: only the photos that name this one (in alt text, title or file name), and its
  // share image only when the page is the place's own or its title names it
  const named = new Set(significant(c.name))
  const title = new Set(significant(got.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? ''))
  const own = page === c.website_url || (named.size > 0 && [...named].every((w) => title.has(w)))
  const captioned: string[] = []
  for (const tag of got.html.match(/<img\b[^>]*>/gi) ?? []) {
    const label = [tag.match(/\balt=["']([^"']*)["']/i)?.[1], tag.match(/\btitle=["']([^"']*)["']/i)?.[1]].join(' ')
    const src = tag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1]
    if (!src || /\.svg|logo|icon|avatar|sprite/i.test(src)) continue
    const said = new Set([...significant(label), ...significant(src.split('/').pop() ?? '')])
    if (!named.size || ![...named].every((w) => said.has(w))) continue
    const u = absolute(src, got.url)
    if (u) captioned.push(u)
  }
  return [...new Set([...(own ? share.slice(0, 1) : []), ...captioned.slice(0, 3)])]
}

/** The cover of an Instagram post in full size, from its public embed page. */
async function instagramCover(code: string) {
  const got = await fetchText(`https://www.instagram.com/p/${code}/embed/captioned/`)
  const img = got?.html.match(/<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]*>/i)?.[0]
  const srcset = img?.match(/srcset="([^"]+)"/i)?.[1]
  if (srcset) {
    const biggest = decode(srcset).split(',').map((x) => x.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] ?? '0') - parseInt(a[1] ?? '0'))[0]?.[0]
    if (biggest) return biggest
  }
  const src = img?.match(/src="([^"]+)"/i)?.[1]
  if (src) return decode(src)
  const og = await fetchText(`https://www.instagram.com/p/${code}/`)
  const v = og?.html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
  return v ? decode(v) : null
}

/** A restaurant's photos on Tabelog: its page from the card's sources, or the first search hit that matches its name. */
async function tabelogPhotos(c: Card, sources: string[]): Promise<Found[]> {
  let base = sources.map((s) => s.match(/^(https:\/\/(?:[a-z]+\.)?tabelog\.com\/(?:en\/)?[a-z]+\/A\d+\/A\d+\/\d{8})/i)?.[1]).find(Boolean)
  if (!base) {
    const hit = await fetchText(`https://tabelog.com/en/rstLst/?sk=${encodeURIComponent(c.name.replace(/\(.*?\)/g, '').trim())}`)
    const named = significant(c.name)
    for (const m of hit?.html.matchAll(/<a[^>]+href="(https:\/\/tabelog\.com\/en\/[a-z]+\/A\d+\/A\d+\/\d{8})\/?"[^>]*>([^<]{2,80})<\/a>/gi) ?? []) {
      const title = new Set(significant(m[2]))
      if (named.length && named.every((w) => title.has(w))) {
        base = m[1]
        break
      }
    }
  }
  if (!base) return []
  // ssl. and en. copies of a page share its path; the plain Japanese address is the one that always answers
  const path = new URL(base).pathname.replace(/^\/en\//, '/').replace(/\/$/, '')
  const got = await fetchText(`https://tabelog.com${path}/dtlphotolst/smp2/`)
  const urls = [...new Set([...(got?.html.matchAll(/https:\/\/tblg\.k-img\.com\/(?:resize\/[\dx]+c?\/)?restaurant\/images\/Rvw\/[^"'\s)]+?\.(?:jpg|jpeg|png|webp)/gi) ?? [])].map((m) => m[0]))]
  // the listing shows thumbnails; the same path at 640x640 is a full photo
  return urls.slice(0, 4).map((u) => ({ url: u.replace(/\/resize\/[\dx]+c?\//, '/resize/640x640c/'), from: 'tabelog' }))
}

async function tiktokCover(link: string) {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`, { signal: AbortSignal.timeout(8000) })
    return r.ok ? ((await r.json()).thumbnail_url as string | undefined) ?? null : null
  } catch {
    return null
  }
}

// words that say what kind of place it is, not which one
const GENERIC = new Set('the and main store shop branch temple shrine street shopping market cafe coffee bar restaurant park garden tower museum building center centre station tokyo kyoto osaka nara kobe japan'.split(' '))
const significant = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w))
const WIKI_UA = { 'User-Agent': 'JapanTripApp/1.0 (https://shakedflorentin.github.io/RentCalc/)' }

/** The lead image of the Wikipedia article about the place, when the article's title is the place's name. */
async function wikipedia(c: Card): Promise<Found[]> {
  const tries: [string, string][] = [['en', `${c.name.replace(/\(.*?\)/g, '')} ${CITY[c.city ?? ''] ?? ''}`]]
  if (c.name_ja) tries.push(['ja', c.name_ja])
  const named = significant(c.name)
  for (const [lang, q] of tries) {
    try {
      const api = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=1280&gsrsearch=${encodeURIComponent(q.trim())}`
      const r = await fetch(api, { headers: WIKI_UA, signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const p = Object.values(((await r.json()).query?.pages ?? {}) as Record<string, { title: string; thumbnail?: { source: string } }>)[0]
      if (!p?.thumbnail?.source) continue
      const ok =
        lang === 'ja'
          ? !!c.name_ja && (p.title.includes(c.name_ja) || c.name_ja.includes(p.title)) && p.title.length > 1
          : named.length > 0 && named.every((w) => significant(p.title).includes(w))
      if (ok) return [{ url: p.thumbnail.source, from: 'wikipedia' }]
    } catch {
      // try the next one
    }
  }
  return []
}

/** Photos on Wikimedia Commons whose file names carry the place's name (temples, streets, markets). */
async function commons(c: Card): Promise<Found[]> {
  const named = significant(c.name)
  if (!named.length) return []
  try {
    const q = `${c.name.replace(/\(.*?\)/g, '')} ${CITY[c.city ?? ''] ?? ''} filetype:bitmap`
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url&iiurlwidth=1280&gsrsearch=${encodeURIComponent(q)}`
    const r = await fetch(api, { headers: WIKI_UA, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return []
    const pages = Object.values(((await r.json()).query?.pages ?? {}) as Record<string, { title: string; index?: number; imageinfo?: { thumburl?: string }[] }>)
    return pages
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .filter((p) => named.every((w) => significant(p.title).includes(w)) && p.imageinfo?.[0]?.thumburl)
      .slice(0, 3)
      .map((p) => ({ url: p.imageinfo![0].thumburl!, from: 'commons' }))
  } catch {
    return []
  }
}

/** Downloads the candidates and keeps real photos: big enough, an image type Claude reads, each picture once. */
async function download(found: Found[]): Promise<Image[]> {
  const got = await Promise.all(
    found.slice(0, 14).map(async (f) => {
      try {
        const r = await fetch(f.url, { headers: /wikimedia\.org/.test(f.url) ? WIKI_UA : { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
        const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        if (!r.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) return null
        const bytes = new Uint8Array(await r.arrayBuffer())
        if (bytes.length < MIN_BYTES || bytes.length > 4_500_000) return null
        const size = dimensions(bytes)
        if (!size || Math.min(size.w, size.h) < MIN_SIDE * 0.75 || Math.max(size.w, size.h) < MIN_SIDE) return null
        return { ...f, bytes, type, ...size }
      } catch {
        return null
      }
    }),
  )
  const seen = new Set<string>()
  const out: Image[] = []
  for (const im of got) {
    if (!im) continue
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', im.bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
    if (seen.has(hash)) continue
    seen.add(hash)
    out.push(im)
  }
  return out.slice(0, MAX_CHECKED)
}

/** Width and height from a JPEG, PNG or WebP header. */
function dimensions(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1]
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | u16(18), h: (b[20] << 24) | (b[21] << 16) | u16(22) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(i + 5), w: u16(i + 7) }
      i += 2 + u16(i + 2)
    }
    return null
  }
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff }
    if (kind === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  }
  return null
}

const Pick = z.object({ keep: z.array(z.number().int()) })

/** Which images show the place itself, best first; without Claude, the first ones found. */
async function pick(admin: SupabaseClient, c: Card, images: Image[]): Promise<number[]> {
  const fallback = images.map((_, i) => i).slice(0, KEEP)
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ((await admin.rpc('get_anthropic_key')).data as string | null) || undefined
  const t = performance.now()
  try {
    const about = [c.category, c.area, c.city, c.serves ?? c.todo ?? c.hype].filter(Boolean).join(' · ')
    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: `Place: ${c.name}${c.name_ja ? ` (${c.name_ja})` : ''}\nAbout: ${about}\nImages, numbered from 0:` },
      ...images.flatMap((im, i): Anthropic.ContentBlockParam[] => [
        { type: 'text', text: `Image ${i} (from ${im.from}):` },
        { type: 'image', source: { type: 'base64', media_type: im.type as 'image/jpeg', data: base64(im.bytes) } },
      ]),
    ]
    const r = await new Anthropic({ apiKey: key }).messages.parse({
      model: MODEL,
      max_tokens: 200,
      output_config: { effort: 'low', format: zodOutputFormat(Pick) },
      system:
        `These images were found for a place card in a trip app. Return the numbers of up to ${KEEP} images that are real photos of this place: its food or drinks, the interior, the building or street, or the view, ` +
        'best first. Leave out logos, text banners, maps, menus as plain text, screenshots, collages of many places, stock photos of something else, and images that clearly show a different place. ' +
        'An empty list is fine.',
      messages: [{ role: 'user', content }],
    })
    logCall(admin, { fn: 'card-photos', step: 'pick', userId: null, model: MODEL, usage: r.usage, ms: performance.now() - t, stopReason: r.stop_reason })
    const keep = (r.parsed_output?.keep as number[] | undefined)?.filter((i) => i >= 0 && i < images.length)
    return keep ? [...new Set(keep)] : fallback
  } catch (error) {
    console.error('pick failed', c.name, error instanceof Error ? error.message : error)
    logCall(admin, { fn: 'card-photos', step: 'pick', userId: null, model: MODEL, ms: performance.now() - t, error: String(error instanceof Error ? error.message : error) })
    return fallback
  }
}

function base64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
