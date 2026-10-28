import type { KeyboardEvent } from 'react'
import type { Member, Trip } from '../types'
import Lists from './Lists'
import Expenses from './Expenses'
import Essentials from './Essentials'
import Baby from './Baby'
import Say from './Say'
import { Icon, type LucideIcon } from '../icons'
import { isEn, t } from '../i18n'
import { Baby as BabyIcon, Languages, ListChecks, ShieldAlert, Wallet } from 'lucide-react'

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
export default function More({ trip, members, userId, sub, setSub }: Props) {
  // the tab pattern: one tab stop, arrows move between sections (in RTL the left arrow goes to the next one, in LTR the right)
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const fwd = isEn ? 'ArrowRight' : 'ArrowLeft'
    const back = isEn ? 'ArrowLeft' : 'ArrowRight'
    const step = { [fwd]: 1, [back]: -1, Home: -99, End: 99 }[e.key]
    if (!step) return
    e.preventDefault()
    const i = Math.min(MORE_TABS.length - 1, Math.max(0, MORE_TABS.findIndex((t) => t.id === sub) + step))
    setSub(MORE_TABS[i].id)
    document.getElementById('more-tab-' + MORE_TABS[i].id)?.focus()
  }
  return (
    <div className="stack">
      <div className="more-tabs" role="tablist" aria-label={t('עוד')} onKeyDown={arrows}>
        {MORE_TABS.map((t) => (
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
        {sub === 'say' && <Say />}
        {sub === 'baby' && <Baby trip={trip} members={members} userId={userId} />}
      </div>
    </div>
  )
}
