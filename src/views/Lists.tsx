import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import type { ChecklistItem, Member } from '../types'
import { mutate, useTripTable } from '../lib'
import { Empty } from '../ui'

const LISTS = [
  { id: 'todo', label: '📝 לפני הטיסה' },
  { id: 'packing', label: '🧳 ציוד' },
  { id: 'shopping', label: '🛒 לקנות ביפן' },
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
      <div className="segmented">
        {LISTS.map((l) => (
          <button key={l.id} className={list === l.id ? 'on' : ''} onClick={() => setList(l.id)}>
            {l.label}
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
        <button className="primary">＋</button>
      </form>

      {items.length === 0 && <Empty>הרשימה ריקה</Empty>}
      {items.map((i) => (
        <div key={i.id} className={'item card slim' + (i.done ? ' done' : '')}>
          <button
            className="check"
            onClick={() => mutate(supabase.from('checklist_items').update({ done: !i.done }).eq('id', i.id))}
          >
            {i.done ? '✓' : ''}
          </button>
          <div className="item-body">
            {i.text}
            {i.assignee && <span className="chip tiny">{i.assignee}</span>}
          </div>
          <button
            className="icon faint"
            aria-label="מחיקה"
            onClick={() => mutate(supabase.from('checklist_items').delete().eq('id', i.id))}
          >
            🗑️
          </button>
        </div>
      ))}
    </div>
  )
}
