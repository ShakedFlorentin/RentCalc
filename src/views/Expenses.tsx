import { useState, type ReactNode } from 'react'
import { supabase } from '../supabase'
import type { Expense, Member, Trip } from '../types'
import { couplesOf, fmtDay, mutate, useTripTable } from '../lib'
import { balances, convert, coupleTotals, fmtMoney, partiesOf, settleUp, toMinor, SYMBOL, type Cur, type Transfer } from '../money'
import { Empty, Field, LoadNote, Sheet, useRemembered } from '../ui'
import { Icon, type LucideIcon } from '../icons'
import { BedDouble, Check, Handshake, Package, Plus, ShoppingBag, Ticket, TrainFront, Users, Utensils } from 'lucide-react'
import '../styles/expenses.css'

type Props = { trip: Trip; members: Member[]; userId: string }

const CATS: Record<string, { label: string; icon: LucideIcon }> = {
  food: { label: 'אוכל', icon: Utensils },
  transport: { label: 'תחבורה', icon: TrainFront },
  lodging: { label: 'לינה', icon: BedDouble },
  sights: { label: 'אטרקציות', icon: Ticket },
  shopping: { label: 'קניות', icon: ShoppingBag },
  other: { label: 'אחר', icon: Package },
}
const flip = (c: Cur): Cur => (c === 'JPY' ? 'ILS' : 'JPY')
const iconOf = (e: Expense): LucideIcon => (e.kind === 'settlement' ? Handshake : (CATS[e.category ?? '']?.icon ?? Package))

/** Who paid whom, as it is said: "from Almog to Maor". */
const FromTo = ({ from, to }: { from: string; to: string }) => (
  <>
    מ<bdi>{from}</bdi> ל<bdi>{to}</bdi>
  </>
)

/** Today by the date in Japan, whatever timezone the phone is still set to. */
const japanToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

/** What the user typed ("1,200", "12.5") as a number, or NaN. */
// "1,200" is twelve hundred (thousands separators), "12,5" is twelve and a half
const parseAmount = (s: string) => {
  const t = s.trim().replace(/\s/g, '')
  return Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.'))
}
// agorot at most, so a typed 12.345 doesn't leave a half-agora in the books
const roundFor = (n: number, currency: string) => (currency === 'JPY' ? Math.round(n) : Math.round(n * 100) / 100)

export default function Expenses({ trip, members, userId }: Props) {
  const { rows, loading, error, reload } = useTripTable<Expense>('expenses', trip.id, 'spent_on')
  const [cur, setCur] = useRemembered('expensesCurrency', 'ILS')
  const [edit, setEdit] = useState<Partial<Expense> | null>(null)
  const [settle, setSettle] = useState<{ t: Transfer; row?: Expense } | null>(null)
  const [editingRate, setEditingRate] = useState(false)
  // the trip row only refreshes through realtime, so show a saved rate right away
  const [savedRate, setSavedRate] = useState<number | null>(null)
  // the column defaults to 0.025; fall back to it for a trip row loaded before the column existed (e.g. a cached copy)
  const rate = savedRate ?? (Number(trip.ils_per_jpy) || 0.025)
  const show: Cur = cur === 'JPY' ? 'JPY' : 'ILS'

  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? 'מישהו'
  const couples = couplesOf(members)
  const ids = members.map((m) => m.user_id)

  const bal = balances(rows, ids, show, rate)
  // a couple is one wallet, so debts are settled between couples; a trip can be set to settle person by person
  // (trips.settle_by, a backend setting). A trip row cached from before the column existed counts as couples.
  const byCouple = couples.length > 1 && trip.settle_by !== 'people'
  const parties = partiesOf(members, byCouple)
  const partyOf = (id: string) => parties.find((p) => p.ids.includes(id))
  const mineKey = partyOf(userId)?.key
  const labelOf = (key: string) => parties.find((p) => p.key === key)?.label ?? 'מישהו'
  const transfers = settleUp(bal, parties, show)
  const toPay = transfers.filter((t) => t.from === mineKey)
  const toGet = transfers.filter((t) => t.to === mineKey)
  const others = transfers.filter((t) => t.from !== mineKey && t.to !== mineKey)
  const owe = toPay.reduce((s, t) => s + t.amount, 0)
  const owed = toGet.reduce((s, t) => s + t.amount, 0)
  const totals = coupleTotals(rows, members, bal, show, rate)
  // "we" for a couple, "you" for one person
  const we = byCouple && (partyOf(userId)?.ids.length ?? 0) > 1

  // newest first, grouped by day
  const sorted = [...rows].sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at))
  const days = [...new Set(sorted.map((e) => e.spent_on))]

  /** Who a split is among, as people would say it. */
  const splitLabel = (split: string[]) => {
    const has = (list: string[]) => list.length === split.length && list.every((id) => split.includes(id))
    if (has(ids)) return 'כולם'
    const couple = couples.find((c) => has(members.filter((m) => m.couple === c).map((m) => m.user_id)))
    return couple ?? split.map(nameOf).join(', ')
  }

  // a repayment between couples is the couple's, whichever of the two handed over the money
  const whoOf = (id: string) => (byCouple ? (partyOf(id)?.label ?? nameOf(id)) : nameOf(id))
  const money = (minor: number, c: Cur = show) => <bdi dir="ltr">{fmtMoney(minor, c)}</bdi>
  /** A transfer between parties, recorded as one person paying another: someone from each side, preferably me. */
  const asPeople = (t: Transfer): Transfer => {
    const pick = (key: string) => {
      const p = parties.find((x) => x.key === key)!
      return p.ids.includes(userId) ? userId : p.ids[0]
    }
    return { from: pick(t.from), to: pick(t.to), amount: t.amount }
  }

  return (
    <div className="stack">
      <div className="card exp-hero">
        <div className="row spread nowrap">
          <span className="muted small">{byCouple ? `היתרה של ${labelOf(mineKey ?? '')}` : 'היתרה שלך'}</span>
          <div className="segmented exp-cur" role="group" aria-label="מטבע להצגה">
            {(['JPY', 'ILS'] as const).map((c) => (
              <button key={c} className={show === c ? 'on' : ''} aria-pressed={show === c} onClick={() => setCur(c)}>
                {SYMBOL[c]}
              </button>
            ))}
          </div>
        </div>
        <div className={'exp-big' + (owe ? ' minus' : owed ? ' plus' : '')}>
          {owe ? (
            <>{we ? 'עליכם להחזיר' : 'עליך להחזיר'} {money(owe)}</>
          ) : owed ? (
            <>{we ? 'מגיע לכם' : 'מגיע לך'} {money(owed)}</>
          ) : (
            'הכול מאוזן'
          )}
        </div>
        {/* my own payments, each with its button: the one thing this screen is for */}
        {[...toPay, ...toGet].map((t) => {
          const paying = t.from === mineKey
          return (
            <div key={t.from + t.to} className="exp-transfer">
              <span className="exp-transfer-who">
                <span>{paying ? 'ל' : 'מ'}<bdi>{labelOf(paying ? t.to : t.from)}</bdi></span>
                <b className="exp-num">{money(t.amount)}</b>
              </span>
              <button className="pill" onClick={() => setSettle({ t: asPeople(t) })}>
                <Icon as={Check} /> {paying ? (we ? 'החזרנו' : 'החזרתי') : (we ? 'קיבלנו' : 'קיבלתי')}
              </button>
            </div>
          )
        })}
        <div className="muted small exp-rate">
          שער: 100 ין = <bdi dir="ltr">₪{Number((rate * 100).toFixed(3))}</bdi>{' '}
          <button className="link exp-link" onClick={() => setEditingRate(true)}>
            עריכה
          </button>
        </div>
      </div>

      {error && <LoadNote onRetry={reload} />}
      {!loading && !error && rows.length === 0 && (
        <Empty>אין הוצאות עדיין. מוסיפים הוצאה, בוחרים מי שילם ובין מי מחלקים, ופה רואים מי חייב למי.</Empty>
      )}

      {others.length > 0 && (
        <div className="card">
          <h3 className="exp-h">החזרים בין האחרים</h3>
          {others.map((t) => (
            <div key={t.from + t.to} className="exp-transfer">
              <span className="exp-transfer-who">
                <span>
                  מ<bdi>{labelOf(t.from)}</bdi> ל<bdi>{labelOf(t.to)}</bdi>
                </span>
                <b className="exp-num">{money(t.amount)}</b>
              </span>
              <button className="link exp-link" onClick={() => setSettle({ t: asPeople(t) })}>
                הוחזר
              </button>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <details className="card tip exp-details">
          <summary>
            <span>{byCouple ? 'כמה כל זוג שילם' : 'היתרה של כל אחד'}</span>
          </summary>
          <div className="exp-details-body">
            {byCouple
              ? couples.map((c) => (
                  <Balance key={c} name={c} net={totals[c]?.net ?? 0} note={`שילמו ${fmtMoney(totals[c]?.paid ?? 0, show)}`} cur={show} />
                ))
              : members.map((m) => <Balance key={m.user_id} name={m.display_name} net={bal[m.user_id] ?? 0} cur={show} />)}
          </div>
        </details>
      )}

      {days.map((d) => (
        <div key={d} className="stack exp-day">
          <div className="area-title">{fmtDay(new Date(d + 'T00:00:00'))}</div>
          {sorted
            .filter((e) => e.spent_on === d)
            .map((e) => {
              const settlement = e.kind === 'settlement'
              const open = () =>
                settlement
                  ? setSettle({ t: { from: e.paid_by, to: e.split_among[0], amount: toMinor(Number(e.amount), e.currency) }, row: e })
                  : setEdit(e)
              return (
                <button key={e.id} className="card exp-row" onClick={open}>
                  <span className="exp-icon" aria-hidden="true">
                    <Icon as={iconOf(e)} size="1.25em" />
                  </span>
                  <span className="exp-main">
                    <b>{settlement ? 'החזר' : e.title}</b>
                    <span className="muted small">
                      {settlement ? (
                        <FromTo from={whoOf(e.paid_by)} to={whoOf(e.split_among[0])} />
                      ) : (
                        <>
                          שולם ע״י {nameOf(e.paid_by)} · בין: {splitLabel(e.split_among)}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="exp-amt">
                    <b>
                      <bdi dir="ltr">{SYMBOL[e.currency] + Number(e.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}</bdi>
                    </b>
                    <span className="muted small">
                      <bdi dir="ltr">≈ {fmtMoney(toMinor(convert(Number(e.amount), e.currency, flip(e.currency), rate), flip(e.currency)), flip(e.currency))}</bdi>
                    </span>
                  </span>
                </button>
              )
            })}
        </div>
      ))}

      <button className="fab" aria-label="הוצאה חדשה" onClick={() => setEdit({})}>
        <Icon as={Plus} size="1.5em" />
      </button>
      {edit && <ExpenseForm trip={trip} members={members} couples={couples} userId={userId} expense={edit} onClose={() => setEdit(null)} />}
      {settle && (
        <SettleSheet
          trip={trip}
          userId={userId}
          nameOf={whoOf}
          cur={settle.row?.currency ?? show}
          {...settle}
          onClose={() => setSettle(null)}
        />
      )}
      {editingRate && (
        <RateSheet
          tripId={trip.id}
          rate={rate}
          onSaved={setSavedRate}
          onClose={() => setEditingRate(false)}
        />
      )}
    </div>
  )
}

function Balance(props: { name: ReactNode; net: number; note?: string; cur: Cur }) {
  const { net, cur } = props
  return (
    <div className="exp-bal">
      <span>
        {props.name}
        {props.note && <span className="muted small"> · {props.note}</span>}
      </span>
      <b className={'exp-num' + (net > 0 ? ' plus' : net < 0 ? ' minus' : ' muted')}>
        <bdi dir="ltr">
          {net > 0 ? '+' : net < 0 ? '−' : ''}
          {fmtMoney(net, cur)}
        </bdi>
      </b>
    </div>
  )
}

function ExpenseForm(props: {
  trip: Trip
  members: Member[]
  couples: string[]
  userId: string
  expense: Partial<Expense>
  onClose: () => void
}) {
  const { expense: x, members, couples, userId } = props
  const [amount, setAmount] = useState(x.id ? String(x.amount) : '')
  const [currency, setCurrency] = useState<Cur>(x.currency ?? 'JPY')
  const [title, setTitle] = useState(x.title ?? '')
  const [category, setCategory] = useState(x.category ?? 'food')
  const [paidBy, setPaidBy] = useState(x.paid_by ?? userId)
  const [split, setSplit] = useState<string[]>(x.split_among ?? members.map((m) => m.user_id))
  const [date, setDate] = useState(x.spent_on ?? japanToday())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const all = members.map((m) => m.user_id)
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))
  const quick = [
    { label: 'כולם', couple: false, ids: all },
    ...(couples.length > 1
      ? couples.map((c) => ({ label: c, couple: true, ids: members.filter((m) => m.couple === c).map((m) => m.user_id) }))
      : []),
    { label: 'רק אני', couple: false, ids: [userId] },
  ]
  const toggle = (id: string) => setSplit(split.includes(id) ? split.filter((s) => s !== id) : [...split, id])

  const save = async () => {
    const n = roundFor(parseAmount(amount), currency)
    if (!(n > 0)) return setErr('צריך סכום גדול מאפס')
    if (!split.length) return setErr('צריך לבחור לפחות אדם אחד')
    setErr('')
    setBusy(true)
    const row = {
      trip_id: props.trip.id,
      kind: 'expense' as const,
      title: title.trim() || (CATS[category]?.label ?? CATS.other.label),
      amount: n,
      currency,
      paid_by: paidBy,
      split_among: split,
      category,
      spent_on: date || japanToday(),
    }
    // the same dinner entered by two people: same payer, amount and day is almost always one expense
    if (!x.id) {
      const { data: twin } = await supabase
        .from('expenses')
        .select('title, created_by')
        .eq('trip_id', props.trip.id)
        .eq('kind', 'expense')
        .eq('paid_by', row.paid_by)
        .eq('amount', row.amount)
        .eq('currency', row.currency)
        .eq('spent_on', row.spent_on)
        .limit(1)
        .maybeSingle()
      const by = members.find((m) => m.user_id === twin?.created_by)?.display_name
      if (twin && !confirm(`"${twin.title}" באותו סכום ובאותו יום כבר נרשמה${by ? ` על ידי ${by}` : ''}. לרשום שוב?`)) {
        setBusy(false)
        return
      }
    }
    const ok = await mutate(
      x.id
        ? supabase.from('expenses').update(row).eq('id', x.id)
        : supabase.from('expenses').insert({ ...row, created_by: userId }),
    )
    setBusy(false)
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (!x.id || !confirm(`למחוק את "${x.title}"?`)) return
    if (await mutate(supabase.from('expenses').delete().eq('id', x.id))) props.onClose()
  }

  return (
    <Sheet title={x.id ? 'עריכת הוצאה' : 'הוצאה חדשה'} onClose={props.onClose}>
      <div className="exp-amount">
        <Field label="סכום">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            dir="ltr"
            autoFocus={!x.id}
          />
        </Field>
        <div className="segmented exp-cur" role="group" aria-label="מטבע">
          {(['JPY', 'ILS'] as const).map((c) => (
            <button key={c} className={currency === c ? 'on' : ''} aria-pressed={currency === c} onClick={() => setCurrency(c)}>
              {SYMBOL[c]}
            </button>
          ))}
        </div>
      </div>
      <Field label="על מה">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: ראמן בשינג׳וקו" />
      </Field>
      <div className="chips">
        {Object.entries(CATS).map(([k, v]) => (
          <button key={k} className={'chip' + (category === k ? ' on' : '')} onClick={() => setCategory(k)}>
            <Icon as={v.icon} /> {v.label}
          </button>
        ))}
      </div>
      <Field label="מי שילם">
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name}
              {m.user_id === userId ? ' (אני)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span>מחלקים בין</span>
        <div className="chips">
          {quick.map((q) => (
            <button key={q.label} className={'chip' + (same(split, q.ids) ? ' on' : '')} onClick={() => setSplit(q.ids)}>
              {q.couple && <Icon as={Users} />} {q.label}
            </button>
          ))}
        </div>
        <div className="chips">
          {members.map((m) => (
            <button
              key={m.user_id}
              className={'chip' + (split.includes(m.user_id) ? ' on' : '')}
              aria-pressed={split.includes(m.user_id)}
              onClick={() => toggle(m.user_id)}
            >
              {m.display_name}
            </button>
          ))}
        </div>
      </div>
      <Field label="תאריך">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {err && <p className="msg" role="alert">{err}</p>}
      <button className="primary" onClick={save} disabled={busy}>
        {busy ? 'שומר…' : 'שמירה'}
      </button>
      {x.id && (
        <button className="danger" onClick={remove}>
          מחיקה
        </button>
      )}
    </Sheet>
  )
}

/** Confirms a repayment (amount editable) and records it as a settlement; with `row`, edits one already recorded. */
function SettleSheet(props: {
  trip: Trip
  userId: string
  nameOf: (id: string) => string
  t: Transfer
  row?: Expense
  cur: Cur
  onClose: () => void
}) {
  const { t, row, cur } = props
  const [amount, setAmount] = useState(String(t.amount / (cur === 'JPY' ? 1 : 100)))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const n = roundFor(parseAmount(amount), cur)
    if (!(n > 0)) return setErr('צריך סכום גדול מאפס')
    setBusy(true)
    const fields = { amount: n }
    const ok = await mutate(
      row
        ? supabase.from('expenses').update(fields).eq('id', row.id)
        : supabase.from('expenses').insert({
            ...fields,
            trip_id: props.trip.id,
            kind: 'settlement',
            title: 'החזר',
            currency: cur,
            paid_by: t.from,
            split_among: [t.to],
            spent_on: japanToday(),
            created_by: props.userId,
          }),
    )
    setBusy(false)
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (row && confirm('למחוק את ההחזר?') && (await mutate(supabase.from('expenses').delete().eq('id', row.id)))) props.onClose()
  }

  return (
    <Sheet title={row ? 'עריכת החזר' : 'רישום החזר'} onClose={props.onClose}>
      <p className="exp-settle-who">
        <b>
          <FromTo from={props.nameOf(t.from)} to={props.nameOf(t.to)} />
        </b>
      </p>
      <Field label={`כמה הוחזר (${SYMBOL[cur]})`}>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
      </Field>
      {err && <p className="msg" role="alert">{err}</p>}
      <button className="primary" onClick={save} disabled={busy}>
        {busy ? 'שומר…' : row ? 'שמירה' : 'רישום ההחזר'}
      </button>
      {row && (
        <button className="danger" onClick={remove}>
          מחיקה
        </button>
      )}
    </Sheet>
  )
}

/** Edits the trip's shekel-per-yen rate; people think in shekels per ¥100. */
function RateSheet(props: { tripId: string; rate: number; onSaved: (r: number) => void; onClose: () => void }) {
  const [v, setV] = useState(String(Number((props.rate * 100).toFixed(3))))
  const [err, setErr] = useState('')

  const save = async () => {
    const n = parseAmount(v)
    // 100 yen has been worth between one and five shekels for decades; anything far outside is a typo
    if (!(n >= 0.5 && n <= 20)) return setErr('השער נראה לא סביר. כמה שקלים שווים 100 ין? בערך 2.5')
    const rate = Math.round((n / 100) * 1e6) / 1e6
    if (await mutate(supabase.from('trips').update({ ils_per_jpy: rate }).eq('id', props.tripId))) {
      props.onSaved(rate)
      props.onClose()
    }
  }

  return (
    <Sheet title="שער החליפין" onClose={props.onClose}>
      <p className="muted small">כמה שקלים שווים 100 ין. השער משותף לכולם ומשפיע על ההמרה בכל המסך.</p>
      <Field label="שקלים ל־100 ין">
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} dir="ltr" />
      </Field>
      {err && <p className="msg" role="alert">{err}</p>}
      <button className="primary" onClick={save}>
        שמירה
      </button>
    </Sheet>
  )
}
