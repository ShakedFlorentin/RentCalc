// What a person's questionnaire answers (profiles.answers) mean for the Discover deck: which cards they never see,
// and which come first. Pure functions over the card's own fields (city, category, tags, kosher, baby_block, price,
// verdict). The word lists match card tags exactly (tags are lowercase English and Hebrew search words), so a new
// word is one more entry in a list.
import type { Answers, Candidate, InterestKind } from './types'

type Card = Pick<Candidate, 'city' | 'category' | 'tags' | 'kosher' | 'baby_block' | 'price' | 'verdict'>

/** A sight whose tags say it is about the view counts as a viewpoint, not a temple or garden. */
const VIEW_WORDS = [
  'view', 'views', 'observatory', 'observation deck', 'observation tower', 'observation wheel', 'night view',
  'city view', 'viewpoint', 'skyline', '360 view', 'panoramic view', 'scenic view', 'sky view', 'tower',
  'ferris wheel',
  'תצפית', 'נוף', 'נוף לילה', 'נוף פנורמי', 'נקודת תצפית', 'מגדל', 'גלגל ענק', // he-only
]

// the categories where "what's on the plate" decides: a market or a shop that sells fish is still fine to visit
const EATING = ['food', 'cafe', 'nightlife']

/** What never to show to someone who never has this, and which cards it applies to. */
const NEVER: Record<Answers['never'][number], { categories: string[]; words: string[] }> = {
  chicken: {
    categories: EATING,
    words: [
      'chicken', 'yakitori', 'karaage', 'oyakodon', 'tori paitan', 'tsukune', 'chicken ramen', 'chicken katsu',
      'fried chicken', 'chicken skewers',
      'עוף', 'בשר עוף', 'יקיטורי', 'יאקיטורי', 'קראגה', 'אויאקודון', 'צוקנה', 'טורי פייטן', 'ראמן עוף', 'שיפודי עוף', // he-only
    ],
  },
  fish: {
    categories: ['food', 'cafe'],
    words: [
      'fish', 'sushi', 'sashimi', 'raw fish', 'nigiri', 'sushiya', 'sushi counter', 'sushi bar', 'tuna',
      'fatty tuna', 'salmon', 'eel', 'unagi', 'grilled fish', 'fresh fish',
      'דגים', 'דג', 'סושי', 'סשימי', 'דג נא', 'דגים נאים', 'ניגירי', 'טונה', 'סלמון', 'צלופח', 'דגים טריים', // he-only
    ],
  },
  seafood: {
    categories: ['food', 'cafe'],
    words: [
      'seafood', 'crab', 'shrimp', 'shrimp tempura', 'oyster', 'oysters', 'octopus', 'squid', 'takoyaki', 'scallop',
      'shellfish', 'kaisendon', 'clam', 'clams',
      'פירות ים', 'סרטן', 'שרימפס', 'צדפות', 'תמנון', 'קלמרי', 'דיונון', 'טאקויאקי', 'קאיסנדון', // he-only
    ],
  },
  raw_fish: {
    categories: EATING,
    words: [
      'sushi', 'sashimi', 'raw fish', 'omakase sushi', 'nigiri', 'sushiya', 'sushi counter', 'sushi bar', 'edomae',
      'kaisendon', 'tuna tartare',
      'סושי', 'סשימי', 'דג נא', 'דגים נאים', 'ניגירי', 'טרטר טונה', // he-only
    ],
  },
  beef: {
    categories: EATING,
    words: [
      'beef', 'wagyu', 'yakiniku', 'kobe beef', 'gyukatsu', 'beef cutlet', 'steak', 'beef tongue', 'sukiyaki',
      'yakiniku restaurant', 'a5 wagyu', 'kuroge wagyu', 'beef bowl',
      'בקר', 'בשר בקר', 'וואגיו', 'ואגיו', 'יקיניקו', 'יאקינקו', 'סטייק', 'לשון בקר', 'קציצת בקר', 'בקר קובה', // he-only
    ],
  },
  pork: {
    categories: EATING,
    words: [
      'pork', 'tonkatsu', 'chashu', 'tonkotsu', 'tonkotsu ramen', 'pork broth', 'pork cutlet', 'pork belly',
      'breaded pork', 'fried pork', 'pork offal', 'pork dumplings',
      'חזיר', 'טונקצו', 'טונקטסו', 'טונקוטסו', 'צ׳אשו', 'ציר חזיר', 'קציצת חזיר', 'בטן חזיר', 'שניצל חזיר', // he-only
    ],
  },
  alcohol: {
    categories: [...EATING, 'experience'],
    words: [
      'bar', 'bars', 'sake', 'izakaya', 'beer', 'cocktail', 'cocktails', 'cocktail bar', 'sake bar', 'standing bar',
      'hidden bar', 'whisky', 'japanese whisky', 'sake tasting', 'brewery', 'wine', 'japanese pub',
      'בר', 'ברים', 'סאקה', 'איזקאיה', 'בירה', 'קוקטיילים', 'בר קוקטיילים', 'בר סאקה', 'ויסקי', 'טעימת סאקה', // he-only
      'מבשלה', 'יין', 'פאב יפני', // he-only
    ],
  },
}

/** What each "loves" answer looks for in the tags. */
const LOVES: Record<Answers['loves'][number], string[]> = {
  ramen: ['ramen', 'ramen shop', 'tsukemen', 'ראמן', 'צוקמן'], // he-only
  sushi: ['sushi', 'nigiri', 'sushiya', 'sushi counter', 'omakase sushi', 'סושי', 'ניגירי'], // he-only
  yakiniku: ['yakiniku', 'wagyu', 'kobe beef', 'yakiniku restaurant', 'a5 wagyu', 'יקיניקו', 'יאקינקו', 'וואגיו', 'ואגיו'], // he-only
  street: ['street food', 'takoyaki', 'food market', 'yatai', 'אוכל רחוב', 'טאקויאקי', 'דוכנים'], // he-only
  sweets: [
    'dessert', 'desserts', 'sweets', 'japanese sweets', 'matcha', 'wagashi', 'ice cream', 'parfait', 'souffle pancake',
    'קינוח', 'קינוחים', 'מתוקים', 'מאצ\'ה', 'מאצ׳ה', 'גלידה', // he-only
  ],
  izakaya: ['izakaya', 'japanese pub', 'איזקאיה', 'פאב יפני'], // he-only
  chef: [
    'omakase', 'kaiseki', 'fine dining', 'chef counter', "chef's counter", 'tasting menu', 'tasting course', 'michelin',
    'אומקסה', 'קאיסקי', 'קייסקי', 'מסעדת שף', 'דלפק שף', // he-only
  ],
}

/** Rough yen per person for each count of ¥ signs. */
const YEN_SIGNS = [0, 1000, 3000, 8000, 15000, 30000]
// a place a little over the budget is still shown; "clearly above" means more than this much over
const OVER_BUDGET = 1.25

const has = (card: Card, words: string[]) => (card.tags ?? []).some((t) => words.includes(t.trim().toLowerCase()))

/** The kind of place question 3 asked about. */
export function typeOf(card: Card): InterestKind | null {
  switch (card.category) {
    case 'food':
    case 'cafe':
    case 'nightlife':
    case 'shopping':
    case 'experience':
      return card.category
    case 'sight':
      return has(card, VIEW_WORDS) ? 'views' : 'sights'
    default:
      return null
  }
}

/**
 * Yen per person from the card's price text, or null when it can't tell. A number in the text wins (the first one
 * of 100 or more, the low end of a range); otherwise the ¥ signs ("¥¥" ≈ 3,000, the first run in "¥¥-¥¥¥").
 */
export function pricePerPerson(price: string | null | undefined): number | null {
  if (!price) return null
  for (const m of price.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)) {
    const n = Number(m[0].replace(/,/g, ''))
    if (n >= 100) return n
  }
  const signs = price.match(/¥+/)?.[0].length
  return signs ? YEN_SIGNS[Math.min(signs, YEN_SIGNS.length - 1)] : null
}

/** True when the card is no use to this person and stays out of everything Discover shows them. */
export function hidden(card: Card, a: Answers): boolean {
  if (a.cities.length && !a.cities.includes(card.city as Answers['cities'][number])) return true
  const kind = typeOf(card)
  if (kind && a.interest[kind] === 'no') return true
  for (const n of a.never) {
    const rule = NEVER[n]
    if (rule.categories.includes(card.category) && has(card, rule.words)) return true
    if (n === 'alcohol' && card.category === 'nightlife') return true
  }
  // a place that is mostly pork or seafood is no use to someone who eats neither
  if (card.kosher === 'hard' && EATING.includes(card.category) && (a.never.includes('pork') || a.never.includes('seafood'))) return true
  if (a.with.includes('baby') && card.baby_block?.trim()) return true
  if (a.budget && EATING.includes(card.category)) {
    const yen = pricePerPerson(card.price)
    if (yen !== null && yen > a.budget * OVER_BUDGET) return true
  }
  return false
}

/** How well the card fits: higher comes first in the deck. */
export function score(card: Card, a: Answers): number {
  let s = 0
  const kind = typeOf(card)
  if (kind && a.interest[kind] === 'love') s += 2
  for (const l of a.loves) if (has(card, LOVES[l])) s += 2
  if ((card.kosher === 'friendly' || card.kosher === 'options') && (a.never.includes('pork') || a.never.includes('seafood'))) s += 1
  if (card.verdict === 'gem') s += 1
  if (card.verdict === 'trap' || card.verdict === 'overhyped') s -= 1
  return s
}

/**
 * What they don't eat. Older saves (the ones with a kosher answer): "fish" meant fish and seafood, and the kosher
 * question (now gone) meant no pork or seafood, so those carry over as the new answers. New saves have no kosher key,
 * and their "fish" is fish only.
 */
export function neverOf(a: Partial<Answers>): Answers['never'] {
  const never = new Set(a.never ?? [])
  if (a.kosher !== undefined && never.has('fish')) never.add('seafood')
  if (a.kosher === 'prefer' || a.kosher === 'only') {
    never.add('pork')
    never.add('seafood')
  }
  return [...never]
}

const KINDS: InterestKind[] = ['food', 'cafe', 'sights', 'views', 'shopping', 'experience', 'nightlife']

/**
 * The saved answers in full, or null when the questionnaire wasn't finished. Anything missing from an older or
 * partial save reads as "no preference", so a bad row never hides the whole deck.
 */
export function answersOf(p: { answers: Partial<Answers> | null; completed_at: string | null } | null | undefined): Answers | null {
  if (!p?.completed_at || !p.answers) return null
  const a = p.answers
  return {
    with: a.with ?? [],
    cities: a.cities ?? [],
    interest: Object.fromEntries(KINDS.map((k) => [k, a.interest?.[k] ?? 'ok'])) as Answers['interest'],
    never: neverOf(a),
    loves: a.loves ?? [],
    budget: a.budget ?? null,
    pace: a.pace ?? 'balanced',
  }
}
