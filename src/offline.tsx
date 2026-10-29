import { useEffect, useState } from 'react'
import { t } from './i18n'
import { onOutbox, pending } from './outbox'

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** "לפני 3 שעות" for a timestamp. */
function ago(at: number) {
  const min = Math.max(1, Math.round((Date.now() - at) / 60000))
  if (min < 60) return min === 1 ? t('לפני דקה') : t('לפני {n} דקות', { n: min })
  const h = Math.round(min / 60)
  if (h < 24) return h === 1 ? t('לפני שעה') : h === 2 ? t('לפני שעתיים') : t('לפני {n} שעות', { n: h })
  const d = Math.round(h / 24)
  return d === 1 ? t('לפני יום') : d === 2 ? t('לפני יומיים') : t('לפני {n} ימים', { n: d })
}

/** How many changes made offline are still waiting to be sent. */
function useWaiting() {
  const [n, setN] = useState(() => pending().length)
  useEffect(() => {
    const off = onOutbox(() => setN(pending().length))
    return () => {
      off()
    }
  }, [])
  return n
}

/**
 * Slim bar under the top bar while there is no connection, while what's shown is a saved copy (`since` = when that
 * copy was taken), or while changes made offline wait to be sent.
 */
export function OfflineBanner({ since }: { since: number | null }) {
  const online = useOnline()
  const waiting = useWaiting()
  const [, tick] = useState(0)
  // keep "לפני 3 שעות" honest while the screen stays open
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  if (online && since == null && !waiting) return null
  const parts: string[] = []
  if (!online || since != null) parts.push(online ? t('השרת לא עונה') : t('אין אינטרנט'))
  if (since != null) parts.push(t('עדכון אחרון {ago}', { ago: ago(since) }))
  if (waiting)
    parts.push(
      online
        ? waiting === 1 ? t('שולח שינוי אחד…') : t('שולח {n} שינויים…', { n: waiting })
        : waiting === 1 ? t('שינוי אחד יישלח כשתהיה קליטה') : t('{n} שינויים יישלחו כשתהיה קליטה', { n: waiting }),
    )
  return (
    <div
      role="status"
      className="small"
      style={{ background: 'var(--accent-soft)', color: 'var(--accent)', padding: '6px 20px', textAlign: 'center' }}
    >
      {parts.join(' · ')}
    </div>
  )
}
