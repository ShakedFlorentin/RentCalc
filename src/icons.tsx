// One icon set for the whole app (Lucide, MIT): line icons that inherit the text colour, in place of emoji.
import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  Baby,
  BedDouble,
  Coffee,
  FileText,
  Landmark,
  MapPin,
  Plane,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Ticket,
  TrainFront,
  Utensils,
  UtensilsCrossed,
  Wine,
} from 'lucide-react'

export type { LucideIcon }

/** An inline icon sized to the surrounding text; decorative unless given a `label`. */
export function Icon({ as: As, label, size = '1.15em', className, ...rest }: { as: LucideIcon; label?: string } & LucideProps) {
  return (
    <As
      className={className ? 'ic ' + className : 'ic'}
      size={size}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      {...rest}
    />
  )
}

/** Places and itinerary items (see CATEGORIES). */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  sight: Landmark,
  food: UtensilsCrossed,
  shopping: ShoppingBag,
  transport: TrainFront,
  other: MapPin,
}

/** Swipe-game cards (see CARD_STYLE). */
export const CARD_ICON: Record<string, LucideIcon> = {
  food: UtensilsCrossed,
  cafe: Coffee,
  sight: Landmark,
  shopping: ShoppingBag,
  nightlife: Wine,
  experience: Sparkles,
}

/** Bookings (see BOOKING_KINDS). */
export const BOOKING_ICON: Record<string, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  restaurant: Utensils,
  train: TrainFront,
  activity: Ticket,
  insurance: ShieldCheck,
  other: FileText,
}

/** Who a place suits (see AUDIENCES). */
export const AUDIENCE_ICON: Record<string, LucideIcon> = {
  baby: Baby,
  adults: Wine,
}
