// English UI text, keyed by the Hebrew string passed to t(). Split by group of files so several people can add to it
// at once: en-a (shell, home, more, lists), en-b (plan, places, add place, swipe), en-c (bookings, money, essentials,
// baby, translator), en-shared (city names the database keeps in Hebrew).
import { EN_A } from './en-a'
import { EN_B } from './en-b'
import { EN_C } from './en-c'
import { EN_SHARED } from './en-shared'

export const EN: Record<string, string> = { ...EN_SHARED, ...EN_A, ...EN_B, ...EN_C }
