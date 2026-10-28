/**
 * Destination photos for the Music-style city tiles, kept in public/cities/<slug>.webp. A slug is listed in
 * PHOTOS only once its file is there, so tiles never ask for a missing image; until then a tile is plain colour.
 */
const PHOTOS = new Set<string>(['tokyo', 'yokohama', 'kyoto', 'osaka', 'nara', 'fuji'])

// names as they are written in day_info / places (Hebrew, free text) and in the swipe deck (English keys)
const SLUGS: [RegExp, string][] = [
  [/tokyo|טוקיו|שינג׳?ו?קו|שיבויה|אסאקוסה|גינזה/i, 'tokyo'], // he-only
  [/yokohama|יוקוהמה/i, 'yokohama'], // he-only
  [/kyoto|קיוטו/i, 'kyoto'], // he-only
  [/osaka|או?סקה|אוסאקה/i, 'osaka'], // he-only
  [/nara|נארה/i, 'nara'], // he-only
  [/daytrip|טיולי יום|פוג׳?י|הקונה|קוואגוצ׳?יקו|hakone|fuji/i, 'fuji'], // he-only
]

export function citySlug(name: string | null | undefined) {
  return SLUGS.find(([re]) => re.test(name ?? ''))?.[1] ?? null
}

/** The photo for a destination, or null while it has none. */
export function cityPhoto(name: string | null | undefined) {
  const slug = citySlug(name)
  return slug && PHOTOS.has(slug) ? `${import.meta.env.BASE_URL}cities/${slug}.webp` : null
}
