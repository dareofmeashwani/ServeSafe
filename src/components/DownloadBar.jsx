import React from 'react'
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon, DownloadIcon, XIcon } from './Icons.jsx'

const DANGER_EXTS = new Set(['.exe', '.dmg', '.sh', '.bat', '.cmd', '.pkg', '.msi', '.ps1', '.scr', '.vbs'])

function isDangerous(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return DANGER_EXTS.has(ext)
}

function fmt(bytes) {
  if (!bytes) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DownloadBar({ downloads, onOpen, onShow, onDismiss }) {
  const visible = downloads.filter(d => !d.dismissed)
  if (visible.length === 0) return null

  return (
    <div className="download-bar">
      {visible.map(dl => {
        const pct = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : null
        const danger = isDangerous(dl.filename)
        const done = dl.state === 'completed'
        const failed = dl.state === 'interrupted' || dl.state === 'cancelled'

        return (
          <div key={dl.id} className={`download-item ${danger ? 'download-item-danger' : ''}`}>
            <span className="download-icon">
              {danger ? <AlertTriangleIcon size={18} style={{ color: '#e07b00' }} />
                : done ? <CheckCircleIcon size={18} style={{ color: 'var(--safe)' }} />
                : failed ? <XCircleIcon size={18} style={{ color: 'var(--danger)' }} />
                : <DownloadIcon size={18} />}
            </span>
            <div className="download-info">
              <div className="download-filename" title={dl.filename}>{dl.filename}</div>
              {!done && !failed && pct !== null && (
                <div className="download-progress-wrap">
                  <div className="download-progress-bar" style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="download-meta">
                {done ? `${fmt(dl.total)} — complete` : failed ? 'Failed' : `${fmt(dl.received)} of ${fmt(dl.total)}`}
                {danger && !done && <span className="download-danger-label"> · Potentially dangerous file type</span>}
              </div>
            </div>
            <div className="download-actions">
              {done && <button onClick={() => onOpen(dl.savePath)} title="Open file">Open</button>}
              {done && <button onClick={() => onShow(dl.savePath)} title="Show in Finder">Show</button>}
              <button onClick={() => onDismiss(dl.id)} title="Dismiss"><XIcon size={12} /></button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
