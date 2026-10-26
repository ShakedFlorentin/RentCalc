import { PHRASES } from '../phrases'
import { Icon } from '../icons'
import { Languages } from 'lucide-react'
import { PhraseList } from './Essentials'
import Translator from './Translator'
import '../styles/info.css'

/** Talking to people in Japan: the voice translator, then ready phrases to show. The baby phrases live in the baby corner. */
export default function Say() {
  return (
    <div className="stack">
      <Translator />
      <section className="info-sec">
        <h2 className="info-h"><Icon as={Languages} /> משפטים מוכנים</h2>
        <p className="muted small info-note">לוחצים על כרטיס כדי להציג אותו במסך מלא למי שמולכם.</p>
        <PhraseList phrases={PHRASES.filter((p) => !p.baby)} />
      </section>
    </div>
  )
}
