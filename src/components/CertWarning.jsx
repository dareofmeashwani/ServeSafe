import React, { useState } from 'react'
import { useT } from '../LanguageContext.jsx'
import { AlertOctagonIcon, ChevronUpIcon, ChevronDownIcon } from './Icons.jsx'

export function CertWarning({ warning, onGoBack, onProceed }) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { url, error, certSubject } = warning
  const t = useT()

  let hostname = url
  try { hostname = new URL(url).hostname } catch {}

  return (
    <div className="cert-warning">
      <div className="cert-warning-card">
        <div className="cert-warning-icon"><AlertOctagonIcon size={48} /></div>
        <h2 className="cert-warning-title">{t.connectionNotPrivate}</h2>
        <p className="cert-warning-body">{t.attackerSteal(hostname)}</p>

        <div className="cert-warning-code">
          <code>{error}</code>
          {certSubject && <span className="cert-warning-subject">{t.certificateLabel}: {certSubject}</span>}
        </div>

        <div className="cert-warning-actions">
          <button className="cert-btn-primary" onClick={onGoBack}>
            {t.goBackToSafety}
          </button>
        </div>

        <div className="cert-advanced">
          <button className="cert-advanced-toggle" onClick={() => setShowAdvanced(v => !v)}>
            {t.advanced} {showAdvanced ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
          </button>
          {showAdvanced && (
            <div className="cert-advanced-body">
              <p>{t.serverNotProve}</p>
              <button className="cert-btn-danger" onClick={onProceed}>
                {t.proceedUnsafe(hostname)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
