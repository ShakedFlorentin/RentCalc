import { useState, type KeyboardEvent } from 'react'
import type { Member, Trip } from '../types'
import Lists from './Lists'
import Expenses from './Expenses'
import Essentials from './Essentials'
import Baby from './Baby'
import Say from './Say'
import Onboarding, { useProfile } from './Onboarding'
import { answersOf } from '../prefs'
import { useTripHasBaby } from '../lib'
import { Icon, type LucideIcon } from '../icons'
import { isEn, t } from '../i18n'
import { Baby as BabyIcon, ChevronLeft, Languages, ListChecks, ShieldAlert, SlidersHorizontal, Wallet } from 'lucide-react'

export const MORE_TABS = [
  { id: 'money', label: t('כסף'), icon: Wallet },
  { id: 'lists', label: t('רשימות'), icon: ListChecks },
  { id: 'info', label: t('חירום'), icon: ShieldAlert },
  { id: 'say', label: t('תרגום'), icon: Languages },
  { id: 'baby', label: t('תינוק'), icon: BabyIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[]
export type MoreTab = (typeof MORE_TABS)[number]['id']

type Props = { trip: Trip; members: Member[]; userId: string; sub: MoreTab; setSub: (s: MoreTab) => void }

/** The fourth-row tools: shared expenses, checklists, emergency info, talking in Japanese and the baby corner. */
export default function More({ trip, members, userId, sub: subProp, setSub }: Props) {
  const { profile, saved } = useProfile(userId)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const hasBaby = useTripHasBaby(trip.id)
  // the baby corner is only for trips with a baby; a remembered 'baby' tab on another trip falls back to money
  const tabs = MORE_TABS.filter((x) => x.id !== 'baby' || hasBaby)
  const sub: MoreTab = subProp === 'baby' && !hasBaby ? 'money' : subProp
  // the tab pattern: one tab stop, arrows move between sections (in RTL the left arrow goes to the next one, in LTR the right)
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const fwd = isEn ? 'ArrowRight' : 'ArrowLeft'
    const back = isEn ? 'ArrowLeft' : 'ArrowRight'
    const step = { [fwd]: 1, [back]: -1, Home: -99, End: 99 }[e.key]
    if (!step) return
    e.preventDefault()
    const i = Math.min(tabs.length - 1, Math.max(0, tabs.findIndex((t) => t.id === sub) + step))
    setSub(tabs[i].id)
    document.getElementById('more-tab-' + tabs[i].id)?.focus()
  }
  return (
    <div className="stack">
      <button className="prefs-entry" onClick={() => setPrefsOpen(true)}>
        <Icon as={SlidersHorizontal} size="1.375em" className="lead" />
        <span className="prefs-entry-text">
          <b>{t('ההעדפות שלי')}</b>
          <span className="muted small">{profile?.completed_at ? t('מה יופיע בגילוי') : t('כמה שאלות, כדי שבגילוי יופיעו רק מקומות מתאימים')}</span>
        </span>
        <Icon as={ChevronLeft} className="flip-ltr muted" />
      </button>
      {prefsOpen && (
        <Onboarding
          userId={userId}
          initial={answersOf(profile) ?? profile?.answers}
          onDone={(p) => {
            saved(p)
            setPrefsOpen(false)
          }}
          onClose={() => setPrefsOpen(false)}
        />
      )}
      <div className="more-tabs" role="tablist" aria-label={t('עוד')} onKeyDown={arrows}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={'more-tab-' + t.id}
            role="tab"
            aria-selected={sub === t.id}
            aria-controls="more-panel"
            tabIndex={sub === t.id ? 0 : -1}
            className={sub === t.id ? 'on' : ''}
            onClick={() => setSub(t.id)}
          >
            <Icon as={t.icon} size="1.375em" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div id="more-panel" role="tabpanel" aria-labelledby={'more-tab-' + sub}>
        {sub === 'money' && <Expenses trip={trip} members={members} userId={userId} />}
        {sub === 'lists' && <Lists tripId={trip.id} members={members} userId={userId} />}
        {sub === 'info' && <Essentials trip={trip} members={members} userId={userId} />}
        {sub === 'say' && <Say tripId={trip.id} />}
        {sub === 'baby' && <Baby trip={trip} members={members} userId={userId} />}
      </div>
    </div>
  )
}
