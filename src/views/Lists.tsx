import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import type { ChecklistItem, Member } from '../types'
import { mutate, useTripTable } from '../lib'
import { Empty } from '../ui'
import { Icon, type LucideIcon } from '../icons'
import { Check, ClipboardList, Luggage, Plus, ShoppingCart, Trash2 } from 'lucide-react'

const LISTS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'todo', label: 'לפני הטיסה', icon: ClipboardList },
  { id: 'packing', label: 'ציוד', icon: Luggage },
  { id: 'shopping', label: 'לקנות ביפן', icon: ShoppingCart },
]

export default function Lists({ tripId, members }: { tripId: string; members: Member[] }) {
  const { rows } = useTripTable<ChecklistItem>('checklist_items', tripId)
  const [list, setList] = useState('todo')
  const [text, setText] = useState('')
  const [assignee, setAssignee] = useState('')

  const items = rows.filter((r) => r.list === list).sort((a, b) => Number(a.done) - Number(b.done))
  const doneCount = items.filter((i) => i.done).length

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    const ok = await mutate(
      supabase.from('checklist_items').insert({ trip_id: tripId, list, text: text.trim(), assignee: assignee || null }),
    )
    if (ok) setText('')
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
      {items.length > 0 && (
        <div className="progress">
          <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
          <span>
            {doneCount}/{items.length}
          </span>
        </div>
      )}

      <form className="add-row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="להוסיף…" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="אחראי/ת">
          <option value="">כולם</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.display_name}>
              {m.display_name}
            </option>
          ))}
        </select>
        <button className="primary" aria-label="הוספה"><Icon as={Plus} size="1.25em" /></button>
      </form>

      {items.length === 0 && <Empty>הרשימה ריקה</Empty>}
      {items.map((i) => (
        <div key={i.id} className={'item card slim' + (i.done ? ' done' : '')}>
          <button
            className="check"
            aria-label={i.done ? 'לבטל סימון' : 'לסמן כבוצע'}
            aria-pressed={i.done}
            onClick={() => mutate(supabase.from('checklist_items').update({ done: !i.done }).eq('id', i.id))}
          >
            {i.done ? <Icon as={Check} size="1em" strokeWidth={3} /> : null}
          </button>
          <div className="item-body">
            {i.text}
            {i.assignee && <span className="chip tiny">{i.assignee}</span>}
          </div>
          <button
            className="icon faint"
            aria-label="מחיקה"
            onClick={() => confirm(`למחוק את "${i.text}"?`) && mutate(supabase.from('checklist_items').delete().eq('id', i.id))}
          >
            <Icon as={Trash2} size="1.25em" />
          </button>
        </div>
      ))}
    </div>
  )
}
