// The app's language: Hebrew (the default) or English, picked in settings and kept on this phone. Switching reloads
// the app, so every string comes out in the new language, including the ones a module computes once when it loads.
// index.html sets <html lang dir> from the same setting before the first paint.
import { EN } from './i18n/en'

export type Lang = 'he' | 'en'

function stored(): Lang {
  try {
    return localStorage.getItem('lang') === 'en' ? 'en' : 'he'
  } catch {
    return 'he'
  }
}

export const lang: Lang = stored()
export const isEn = lang === 'en'
/** The locale for dates, times and numbers in the app's language. */
export const locale = isEn ? 'en-GB' : 'he-IL'

export function setLang(l: Lang) {
  try {
    if (l === 'en') localStorage.setItem('lang', 'en')
    else localStorage.removeItem('lang')
  } catch {
    // private browsing: the choice lasts until the app closes
  }
  location.reload()
}

/**
 * UI text in the app's language. The Hebrew is the key and the English sits in i18n/en; {name} placeholders are
 * filled from vars. A string with no English yet shows in Hebrew (scripts/i18n-check.mjs lists them).
 */
export function t(he: string, vars?: Record<string, string | number>) {
  const s = isEn ? (EN[he] ?? he) : he
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}
