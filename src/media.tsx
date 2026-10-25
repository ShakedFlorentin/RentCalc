import { useState } from 'react'
import { ExternalLink, Globe, MapPin, Play } from 'lucide-react'
import { Sheet } from './ui'
import { safeUrl } from './lib'
import { Icon, type LucideIcon } from './icons'

type Media = {
  instagram_url?: string | null
  tiktok_url?: string | null
  photos?: string[] | null
  lat?: number | null
  lng?: number | null
}

/** Embed URL for an Instagram post/reel or TikTok video; null when the id can't be parsed. */
export function videoEmbed(m: Media): { embed: string | null; href: string; kind: 'instagram' | 'tiktok' } | null {
  if (m.instagram_url) {
    const id = m.instagram_url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/i)?.[1]
    return { kind: 'instagram', href: m.instagram_url, embed: id ? `https://www.instagram.com/p/${id}/embed` : null }
  }
  if (m.tiktok_url) {
    const id = m.tiktok_url.match(/tiktok\.com\/.*?\/video\/(\d+)/i)?.[1]
    return { kind: 'tiktok', href: m.tiktok_url, embed: id ? `https://www.tiktok.com/embed/v2/${id}` : null }
  }
  return null
}

export function VideoSheet({ media, title, onClose }: { media: NonNullable<ReturnType<typeof videoEmbed>>; title: string; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {media.embed ? (
        <iframe
          className={'video-frame ' + media.kind}
          src={media.embed}
          title={title}
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      ) : null}
      <a className="secondary btn-link" href={safeUrl(media.href)} target="_blank" rel="noreferrer">
        <Icon as={ExternalLink} />
        {media.kind === 'instagram' ? 'פתיחה באינסטגרם' : 'פתיחה בטיקטוק'}
      </a>
    </Sheet>
  )
}

/** Maps / website / video chips. Renders nothing when there is nothing to link to. */
export function MediaActions(props: { name: string; maps?: string | null; website?: string | null; m: Media; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const website = safeUrl(props.website)
  const maps =
    safeUrl(props.maps) || (props.m.lat != null && props.m.lng != null ? `https://www.google.com/maps/search/?api=1&query=${props.m.lat},${props.m.lng}` : null)
  const video = videoEmbed(props.m)
  if (!maps && !website && !video) return null
  return (
    <div className={'actions' + (props.compact ? ' compact' : '')}>
      {maps && (
        <a className="action" href={maps} target="_blank" rel="noreferrer">
          <Icon as={MapPin} /> <span>Google Maps</span>
        </a>
      )}
      {website && (
        <a className="action" href={website} target="_blank" rel="noreferrer">
          <Icon as={Globe} /> <span>אתר</span>
        </a>
      )}
      {video && (
        <button className="action" onClick={() => setOpen(true)}>
          <Icon as={Play} /> <span>סרטון</span>
        </button>
      )}
      {open && video && <VideoSheet media={video} title={props.name} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Square thumbnail: first photo, else a quiet category icon tile. */
export function Thumb({ photos, icon }: { photos?: string[] | null; icon: LucideIcon }) {
  const [bad, setBad] = useState(false)
  const src = photos?.[0]
  return (
    <span className="thumb" aria-hidden="true">
      {src && !bad ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
      ) : (
        <Icon as={icon} size={24} />
      )}
    </span>
  )
}
