import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import { itemDone, type ChecklistItem, type Member } from '../types'
import { couplesOf, mutate, useTripTable } from '../lib'
import { Empty } from '../ui'
import { Icon, type LucideIcon } from '../icons'
import { t } from '../i18n'
import { Check, ClipboardList, Luggage, Plus, ShoppingCart, Trash2 } from 'lucide-react'

const LISTS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'todo', label: t('לפני הטיסה'), icon: ClipboardList },
  { id: 'packing', label: t('ציוד'), icon: Luggage },
  { id: 'shopping', label: t('לקנות ביפן'), icon: ShoppingCart },
]

export default function Lists({ tripId, members, userId }: { tripId: string; members: Member[]; userId: string }) {
  const { rows } = useTripTable<ChecklistItem>('checklist_items', tripId)
  const [list, setList] = useState('todo')
  const [text, setText] = useState('')
  const [assignee, setAssignee] = useState('')
  const [each, setEach] = useState(false)
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  // packing is each couple's own; the other lists are the trip's
  const perCouple = list === 'packing'

  const done = (i: ChecklistItem) => itemDone(i, myCouple)
  const items = rows
    .filter((r) => r.list === list && (!perCouple || !r.couple || r.couple === myCouple))
    .sort((a, b) => Number(done(a)) - Number(done(b)))
  const doneCount = items.filter(done).length

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    const ok = await mutate(
      supabase.from('checklist_items').insert({
        trip_id: tripId,
        list,
        text: text.trim(),
        assignee: assignee || null,
        couple: perCouple ? myCouple : null,
        each: !perCouple && each,
      }),
    )
    if (ok) setText('')
  }

  const toggle = (i: ChecklistItem) => {
    if (!i.each) return mutate(supabase.from('checklist_items').update({ done: !i.done }).eq('id', i.id))
    if (!myCouple) return
    const was = i.done_couples ?? []
    const next = was.includes(myCouple) ? was.filter((c) => c !== myCouple) : [...was, myCouple]
    return mutate(supabase.from('checklist_items').update({ done_couples: next }).eq('id', i.id))
  }

  return (
    <div className="stack">
      <div className="segmented list-tabs">
        {LISTS.map((l) => (
          <button key={l.id} className={list === l.id ? 'on' : ''} onClick={() => setList(l.id)}>
            <Icon as={l.icon} /> {l.label}
          </button>
        ))}
      </div>
      {perCouple && myCouple && <p className="muted small">{t('הציוד של {who}. לכל זוג רשימה משלו.', { who: t(myCouple) })}</p>}
      {items.length > 0 && (
        <div className="progress">
          <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
          <span>
            {doneCount}/{items.length}
          </span>
        </div>
      )}

      <form className="add-row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('להוסיף…')} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t('אחראי')}>
          <option value="">{perCouple ? t('שנינו') : t('כולם')}</option>
          {members
            .filter((m) => !perCouple || m.couple === myCouple)
            .map((m) => (
              <option key={m.user_id} value={m.display_name}>
                {m.display_name}
              </option>
            ))}
        </select>
        <button className="primary" aria-label={t('הוספה')}><Icon as={Plus} size="1.25em" /></button>
      </form>
      {!perCouple && couples.length > 1 && (
        <label className="small check-line">
          <input type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} /> {t('כל זוג מסמן בנפרד (למשל טופס כניסה, ביטוח)')}
        </label>
      )}

      {items.length === 0 && <Empty>{t('הרשימה ריקה')}</Empty>}
      {items.map((i) => {
        const isDone = done(i)
        return (
          <div key={i.id} className={'item card slim' + (isDone ? ' done' : '')}>
            <button
              className="check"
              aria-label={isDone ? t('לבטל סימון') : t('לסמן כבוצע')}
              aria-pressed={isDone}
              onClick={() => toggle(i)}
            >
              {isDone ? <Icon as={Check} size="1em" strokeWidth={3} /> : null}
            </button>
            <div className="item-body">
              {i.text}
              {i.assignee && <span className="chip tiny">{i.assignee}</span>}
              {i.each && couples.length > 1 && (
                <div className="muted small">
                  {couples.map((c) => (
                    <span key={c} className="couple-mark">
                      {(i.done_couples ?? []).includes(c) && <Icon as={Check} />} {c === myCouple ? t('אנחנו') : t(c)}
                      {(i.done_couples ?? []).includes(c) ? '' : t(': עוד לא')}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              className="icon faint"
              aria-label={t('מחיקה')}
              onClick={() => confirm(t('למחוק את "{text}"?', { text: i.text })) && mutate(supabase.from('checklist_items').delete().eq('id', i.id))}
            >
              <Icon as={Trash2} size="1.25em" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
