import React, { useState, useEffect } from 'react'
import { useT } from '../LanguageContext.jsx'
import { ShieldIcon, XIcon, CheckCircleIcon, SlashCircleIcon } from './Icons.jsx'

function Toggle({ on, onChange }) {
  return (
    <button
      className={`toggle-switch ${on ? 'toggle-on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className="toggle-thumb" />
    </button>
  )
}

export function PrivacyPanel({ onClose, activeTabId, trackerCount }) {
  const [settings, setSettings] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [clearFlags, setClearFlags] = useState({ history: true, cookies: false, cache: false })
  const [clearDone, setClearDone] = useState(false)
  const [section, setSection] = useState('settings')
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [appLockEnabled, setAppLockEnabled] = useState(true)
  const t = useT()

  useEffect(() => {
    window.browser.getPrivacySettings().then(setSettings)
    window.browser.getPermissions().then(setPermissions)
    window.browser.getAutoLockMinutes?.().then(m => setAutoLockMinutes(m ?? 5))
    window.browser.getAuthState?.().then(s => {
      if (s?.appLockEnabled !== undefined) setAppLockEnabled(s.appLockEnabled)
    })
  }, [])

  const updateSetting = async (key, value) => {
    const updated = await window.browser.savePrivacySettings({ [key]: value })
    setSettings(updated)
  }

  const clearData = async () => {
    await window.browser.clearData(clearFlags)
    setClearDone(true)
    setTimeout(() => setClearDone(false), 2000)
  }

  const clearPerms = async () => {
    await window.browser.clearPermissions()
    setPermissions({})
  }

  if (!settings) return null

  const toggleDefs = [
    { key: 'blockTrackers',          label: t.blockTrackers,          desc: t.blockTrackersDesc },
    { key: 'doNotTrack',             label: t.doNotTrack,             desc: t.doNotTrackDesc },
    { key: 'globalPrivacyControl',   label: t.globalPrivacyControl,   desc: t.globalPrivacyControlDesc },
    { key: 'httpsOnly',              label: t.httpsOnly,              desc: t.httpsOnlyDesc },
    { key: 'blockThirdPartyCookies', label: t.blockThirdPartyCookies, desc: t.blockThirdPartyCookiesDesc },
  ]

  const permEntries = Object.entries(permissions).flatMap(([origin, perms]) =>
    Object.entries(perms).map(([perm, allowed]) => ({ origin, perm, allowed }))
  )

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span><ShieldIcon size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> {t.privacySecurity}</span>
          <button onClick={onClose}><XIcon size={14} /></button>
        </div>

        <div className="panel-tabs">
          <button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}>{t.settings}</button>
          <button className={section === 'permissions' ? 'active' : ''} onClick={() => setSection('permissions')}>{t.permissions}</button>
        </div>

        <div className="panel-list" style={{ padding: '8px 0' }}>
          {section === 'settings' && (
            <>
              {trackerCount > 0 && (
                <div className="privacy-stat">
                  <span className="privacy-stat-num">{trackerCount}</span>
                  <span className="privacy-stat-label">{t.trackersBlockedPage(trackerCount)}</span>
                </div>
              )}

              {toggleDefs.map(({ key, label, desc }) => (
                <div key={key} className="privacy-toggle-row">
                  <div className="privacy-toggle-text">
                    <div className="privacy-toggle-label">{label}</div>
                    <div className="privacy-toggle-desc">{desc}</div>
                  </div>
                  <Toggle on={settings[key]} onChange={v => updateSetting(key, v)} />
                </div>
              ))}

              {/* App lock */}
              <div className="privacy-section-title">{t.appLock}</div>
              <div className="privacy-toggle-row">
                <div className="privacy-toggle-text">
                  <div className="privacy-toggle-label">{t.enableAppLock}</div>
                  <div className="privacy-toggle-desc">{t.enableAppLockDesc}</div>
                </div>
                <Toggle
                  on={appLockEnabled}
                  onChange={async (v) => {
                    await window.browser.setAppLockEnabled?.(v)
                    setAppLockEnabled(v)
                  }}
                />
              </div>
              <div className="privacy-toggle-row" style={{ opacity: appLockEnabled ? 1 : 0.4, pointerEvents: appLockEnabled ? 'auto' : 'none' }}>
                <div className="privacy-toggle-text">
                  <div className="privacy-toggle-label">{t.autoLock}</div>
                  <div className="privacy-toggle-desc">{t.autoLockDesc}</div>
                </div>
                <select
                  className="autolock-select"
                  value={autoLockMinutes}
                  onChange={async (e) => {
                    const m = Number(e.target.value)
                    await window.browser.setAutoLockMinutes?.(m)
                    setAutoLockMinutes(m)
                  }}
                >
                  <option value={0}>{t.autoLockNever}</option>
                  <option value={1}>{t.autoLock1}</option>
                  <option value={5}>{t.autoLock5}</option>
                  <option value={10}>{t.autoLock10}</option>
                  <option value={15}>{t.autoLock15}</option>
                  <option value={30}>{t.autoLock30}</option>
                </select>
              </div>

              {/* Clear data */}
              <div className="privacy-section-title">{t.clearBrowsingData}</div>
              <div className="privacy-clear-options">
                {[[`history`, t.browsingHistory], ['cookies', t.cookiesSiteData], ['cache', t.cachedFiles]].map(([k, lbl]) => (
                  <label key={k} className="privacy-clear-row">
                    <input
                      type="checkbox"
                      checked={clearFlags[k]}
                      onChange={e => setClearFlags(f => ({ ...f, [k]: e.target.checked }))}
                    />
                    {lbl}
                  </label>
                ))}
              </div>
              <div style={{ padding: '8px 14px' }}>
                <button
                  className="privacy-clear-btn"
                  onClick={clearData}
                  disabled={!Object.values(clearFlags).some(Boolean)}
                >
                  {clearDone ? t.cleared : t.clearNow}
                </button>
              </div>
            </>
          )}

          {section === 'permissions' && (
            <>
              {permEntries.length === 0
                ? <div className="panel-empty">{t.noSavedPermissions}</div>
                : permEntries.map(({ origin, perm, allowed }, i) => (
                    <div key={i} className="panel-item">
                      <span className="panel-item-icon">{allowed ? <CheckCircleIcon size={16} style={{ color: 'var(--safe)' }} /> : <SlashCircleIcon size={16} style={{ color: 'var(--danger)' }} />}</span>
                      <div className="panel-item-text">
                        <div className="panel-item-title">{origin}</div>
                        <div className="panel-item-url">{perm}</div>
                      </div>
                    </div>
                  ))
              }
              {permEntries.length > 0 && (
                <div className="panel-footer">
                  <button onClick={clearPerms}>{t.clearNow}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
