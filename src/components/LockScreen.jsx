import React, { useState, useEffect } from 'react'
import { useT } from '../LanguageContext.jsx'
import { LockIcon, AlertTriangleIcon } from './Icons.jsx'

export function LockScreen({ onUnlock, onExit }) {
  const [status, setStatus] = useState('idle')  // idle | loading | error | wiped
  const [errorMsg, setErrorMsg] = useState('')
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const t = useT()

  const authenticate = async () => {
    setStatus('loading')
    setErrorMsg('')
    try {
      const result = await window.browser?.authenticateSystem('Unlock ServeSafe Browser')
      if (result?.success) {
        onUnlock()
      } else if (result?.wiped) {
        setStatus('wiped')
        setAttemptsLeft(0)
        setTimeout(() => window.browser?.quitApp?.(), 4000)
      } else {
        const left = result?.attemptsLeft ?? (attemptsLeft - 1)
        setAttemptsLeft(left)
        setStatus('error')
        setErrorMsg(`${t.authFailed} ${t.attemptsRemaining(left)}`)
      }
    } catch {
      setStatus('error')
      setErrorMsg(t.authUnavailable)
    }
  }

  useEffect(() => {
    window.browser?.getAuthState?.().then(s => {
      if (s?.attemptsLeft !== undefined) setAttemptsLeft(s.attemptsLeft)
    })
    authenticate()
  }, [])

  if (status === 'wiped') {
    return (
      <div className="lock-screen">
        <div className="lock-card">
          <div className="lock-icon lock-icon-danger"><AlertTriangleIcon size={52} /></div>
          <h1 className="lock-title">{t.allDataErased}</h1>
          <p className="lock-subtitle">
            {t.tooManyAttempts}<br />{t.dataDeleted}
          </p>
          <p className="lock-wipe-notice">{t.appWillClose}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-icon"><LockIcon size={52} /></div>
        <h1 className="lock-title">ServeSafe</h1>
        <p className="lock-subtitle">
          {status === 'loading' ? t.waitingAuth : t.verifyIdentity}
        </p>

        {attemptsLeft < 3 && status !== 'loading' && (
          <p className={`lock-attempts${attemptsLeft === 1 ? ' lock-attempts-danger' : ''}`}>
            {t.attemptsRemaining(attemptsLeft)}
          </p>
        )}

        {status === 'error' && errorMsg && (
          <p className="lock-error">{errorMsg}</p>
        )}

        <div className="lock-actions">
          <button
            className="lock-btn"
            onClick={authenticate}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? t.authenticating : t.unlock}
          </button>
          <button className="lock-exit-btn" onClick={onExit}>
            {t.exit}
          </button>
        </div>
      </div>
    </div>
  )
}
