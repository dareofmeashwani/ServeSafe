import React, { useEffect, useRef } from 'react'
import { useT } from '../LanguageContext.jsx'
import { CameraIcon, MicIcon, MapPinIcon, BellIcon, KeyIcon, MusicIcon, ClipboardIcon, ShieldIcon } from './Icons.jsx'

function renderTemplate(template, vars) {
  const tokens = Object.keys(vars)
  const pattern = new RegExp(`(${tokens.join('|')})`)
  return template.split(pattern).map((part, i) =>
    vars[part] ? React.cloneElement(vars[part], { key: i }) : part
  )
}

export function PermissionToast({ request, onAllow, onDeny }) {
  const { id, origin, permission } = request
  const t = useT()

  const PERMISSION_ICONS = {
    camera: <CameraIcon size={22} />,
    microphone: <MicIcon size={22} />,
    geolocation: <MapPinIcon size={22} />,
    notifications: <BellIcon size={22} />,
    'media-key-system': <KeyIcon size={22} />,
    midi: <MusicIcon size={22} />,
    clipboard: <ClipboardIcon size={22} />,
  }
  const PERMISSION_LABELS = {
    camera: t.permCamera, microphone: t.permMicrophone, geolocation: t.permLocation,
    notifications: t.permNotifications, 'media-key-system': t.permDRM,
    midi: t.permMIDI, clipboard: t.permClipboard,
  }

  const icon  = PERMISSION_ICONS[permission] || <ShieldIcon size={22} />
  const label = PERMISSION_LABELS[permission] || t.permAccess

  let displayOrigin = origin
  try { displayOrigin = new URL(origin).hostname } catch {}

  const timerRef = useRef(null)
  useEffect(() => {
    timerRef.current = setTimeout(() => onDeny(id, origin, permission), 30_000)
    return () => clearTimeout(timerRef.current)
  }, [id])

  const sentence = t.permWantsAccess('\x00ORIGIN\x00', '\x00LABEL\x00')
  const rendered = renderTemplate(sentence, {
    '\x00ORIGIN\x00': <strong>{displayOrigin}</strong>,
    '\x00LABEL\x00':  <strong>{label}</strong>,
  })

  return (
    <div className="permission-toast">
      <span className="permission-toast-icon">{icon}</span>
      <div className="permission-toast-text">{rendered}</div>
      <div className="permission-toast-actions">
        <button className="perm-btn-allow" onClick={() => { clearTimeout(timerRef.current); onAllow(id, origin, permission) }}>
          {t.allow}
        </button>
        <button className="perm-btn-deny" onClick={() => { clearTimeout(timerRef.current); onDeny(id, origin, permission) }}>
          {t.block}
        </button>
      </div>
    </div>
  )
}
