import type { Member, Trip } from '../types'

type Props = { trip: Trip; members: Member[]; userId: string }

// placeholder: built by its own feature agent
export default function Baby(_props: Props) {
  return <p className="muted">בקרוב</p>
}
