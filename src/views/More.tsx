import type { Member, Trip } from '../types'
import Lists from './Lists'
import Expenses from './Expenses'
import Essentials from './Essentials'
import Baby from './Baby'

export const MORE_TABS = [
  { id: 'money', label: '💰 כסף' },
  { id: 'lists', label: '📋 רשימות' },
  { id: 'info', label: '🆘 חשוב' },
  { id: 'baby', label: '👶 תינוק' },
] as const
export type MoreTab = (typeof MORE_TABS)[number]['id']

type Props = { trip: Trip; members: Member[]; userId: string; sub: MoreTab; setSub: (s: MoreTab) => void }

/** The fourth-row tools: shared expenses, checklists, must-have info and the baby corner. */
export default function More({ trip, members, userId, sub, setSub }: Props) {
  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="עוד">
        {MORE_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={sub === t.id} className={sub === t.id ? 'on' : ''} onClick={() => setSub(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'money' && <Expenses trip={trip} members={members} userId={userId} />}
      {sub === 'lists' && <Lists tripId={trip.id} members={members} />}
      {sub === 'info' && <Essentials trip={trip} members={members} userId={userId} />}
      {sub === 'baby' && <Baby trip={trip} members={members} userId={userId} />}
    </div>
  )
}
