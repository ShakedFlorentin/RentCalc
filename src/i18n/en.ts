// English UI text, keyed by the Hebrew string passed to t(). Split by group of files so several people can add to it
// at once: en-a (shell, home, plan, places), en-b (swipe, bookings, money, essentials, baby, translator), en-c (shared).
import { EN_A } from './en-a'
import { EN_B } from './en-b'
import { EN_C } from './en-c'

export const EN: Record<string, string> = { ...EN_C, ...EN_A, ...EN_B }
