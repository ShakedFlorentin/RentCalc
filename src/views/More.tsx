import type { Member, Trip } from '../types'
import Lists from './Lists'
import Expenses from './Expenses'
import Essentials from './Essentials'
import Baby from './Baby'
import Say from './Say'
import { Icon, type LucideIcon } from '../icons'
import { Baby as BabyIcon, Languages, ListChecks, ShieldAlert, Wallet } from 'lucide-react'

export const MORE_TABS = [
  { id: 'money', label: 'כסף', icon: Wallet },
  { id: 'lists', label: 'רשימות', icon: ListChecks },
  { id: 'info', label: 'חירום', icon: ShieldAlert },
  { id: 'say', label: 'תרגום', icon: Languages },
  { id: 'baby', label: 'תינוק', icon: BabyIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[]
export type MoreTab = (typeof MORE_TABS)[number]['id']

type Props = { trip: Trip; members: Member[]; userId: string; sub: MoreTab; setSub: (s: MoreTab) => void }

/** The fourth-row tools: shared expenses, checklists, emergency info, talking in Japanese and the baby corner. */
export default function More({ trip, members, userId, sub, setSub }: Props) {
  return (
    <div className="stack">
      <div className="more-tabs" role="tablist" aria-label="עוד">
        {MORE_TABS.map((t) => (
          <button
            key={t.id}
            id={'more-tab-' + t.id}
            role="tab"
            aria-selected={sub === t.id}
            aria-controls="more-panel"
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
