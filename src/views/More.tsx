import type { Member, Trip } from '../types'
import Lists from './Lists'
import Expenses from './Expenses'
import Essentials from './Essentials'
import Baby from './Baby'
import { Icon, type LucideIcon } from '../icons'
import { Baby as BabyIcon, ListChecks, ShieldAlert, Wallet } from 'lucide-react'

export const MORE_TABS = [
  { id: 'money', label: 'כסף', icon: Wallet },
  { id: 'lists', label: 'רשימות', icon: ListChecks },
  { id: 'info', label: 'חשוב', icon: ShieldAlert },
  { id: 'baby', label: 'תינוק', icon: BabyIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[]
export type MoreTab = (typeof MORE_TABS)[number]['id']

type Props = { trip: Trip; members: Member[]; userId: string; sub: MoreTab; setSub: (s: MoreTab) => void }

/** The fourth-row tools: shared expenses, checklists, must-have info and the baby corner. */
export default function More({ trip, members, userId, sub, setSub }: Props) {
  return (
    <div className="stack">
      <div className="segmented more-tabs" role="tablist" aria-label="עוד">
        {MORE_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={sub === t.id} className={sub === t.id ? 'on' : ''} onClick={() => setSub(t.id)}>
            <Icon as={t.icon} /> {t.label}
          </button>
        ))}
      </div>
      {sub === 'money' && <Expenses trip={trip} members={members} userId={userId} />}
      {sub === 'lists' && <Lists tripId={trip.id} members={members} userId={userId} />}
      {sub === 'info' && <Essentials trip={trip} members={members} userId={userId} />}
      {sub === 'baby' && <Baby trip={trip} members={members} userId={userId} />}
    </div>
  )
}
