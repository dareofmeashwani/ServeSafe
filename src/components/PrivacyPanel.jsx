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

export function PrivacyPanel({ onClose, activeTabId, trackerCount, adCount, cryptoMiningCount }) {
  const [settings, setSettings] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [permDefaults, setPermDefaults] = useState({})
  const [clearFlags, setClearFlags] = useState({ history: true, cookies: false, cache: false })
  const [clearDone, setClearDone] = useState(false)
  const [section, setSection] = useState('settings')
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [appLockEnabled, setAppLockEnabled] = useState(true)
  const t = useT()

  useEffect(() => {
    window.browser.getPrivacySettings().then(setSettings)
    window.browser.getPermissions().then(setPermissions)
    window.browser.getPermissionDefaults?.().then(d => setPermDefaults(d || {}))
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

  const updateDefault = async (type, policy) => {
    const updated = await window.browser.setPermissionDefaults({ [type]: policy })
    setPermDefaults(updated || {})
  }

  const setSitePerm = async (origin, type, allow) => {
    const updated = await window.browser.setPermission(origin, type, allow)
    setPermissions(updated || {})
  }

  const resetSitePerm = async (origin, type) => {
    const updated = await window.browser.removePermission(origin, type)
    setPermissions(updated || {})
  }

  const hostOf = (origin) => { try { return new URL(origin).hostname } catch { return origin } }

  if (!settings) return null

  const toggleDefs = [
    { key: 'antiFingerprinting',     label: t.antiFingerprinting,     desc: t.antiFingerprintingDesc },
    { key: 'secureDns',             label: t.secureDns,              desc: t.secureDnsDesc },
    { key: 'blockBounceTracking',   label: t.blockBounceTracking,    desc: t.blockBounceTrackingDesc },
    { key: 'blockAds',               label: t.blockAds,               desc: t.blockAdsDesc },
    { key: 'blockTrackers',          label: t.blockTrackers,          desc: t.blockTrackersDesc },
    { key: 'blockCryptoMining',      label: t.blockCryptoMining,      desc: t.blockCryptoMiningDesc },
    { key: 'blockJavaScript',        label: t.blockJavaScript,        desc: t.blockJavaScriptDesc },
    { key: 'blockDownloads',         label: t.blockDownloads,         desc: t.blockDownloadsDesc },
    { key: 'doNotTrack',             label: t.doNotTrack,             desc: t.doNotTrackDesc },
    { key: 'globalPrivacyControl',   label: t.globalPrivacyControl,   desc: t.globalPrivacyControlDesc },
    { key: 'httpsOnly',              label: t.httpsOnly,              desc: t.httpsOnlyDesc },
    { key: 'blockThirdPartyCookies', label: t.blockThirdPartyCookies, desc: t.blockThirdPartyCookiesDesc },
  ]

  // Managed permission types (must match PERMISSION_TYPES in electron/main.js) and
  // their localized labels, shared by the defaults list and the per-site list.
  const PERM_TYPES = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard', 'midi']
  const PERM_LABELS = {
    camera: t.permCamera, microphone: t.permMicrophone, geolocation: t.permLocation,
    notifications: t.permNotifications, clipboard: t.permClipboard, midi: t.permMIDI,
  }

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

              {adCount > 0 && (
                <div className="privacy-stat">
                  <span className="privacy-stat-num">{adCount}</span>
                  <span className="privacy-stat-label">{t.adsBlockedPage(adCount)}</span>
                </div>
              )}

              {cryptoMiningCount > 0 && (
                <div className="privacy-stat">
                  <span className="privacy-stat-num">{cryptoMiningCount}</span>
                  <span className="privacy-stat-label">{t.cryptoMinersBlockedPage(cryptoMiningCount)}</span>
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
              {/* Global defaults applied to sites with no explicit choice */}
              <div className="privacy-section-title">{t.permDefaultsTitle}</div>
              {PERM_TYPES.map(type => (
                <div key={type} className="privacy-toggle-row">
                  <div className="privacy-toggle-text">
                    <div className="privacy-toggle-label">{PERM_LABELS[type]}</div>
                  </div>
                  <select
                    className="autolock-select"
                    value={permDefaults[type] || 'ask'}
                    onChange={e => updateDefault(type, e.target.value)}
                  >
                    <option value="ask">{t.permAsk}</option>
                    <option value="allow">{t.allow}</option>
                    <option value="block">{t.block}</option>
                  </select>
                </div>
              ))}

              {/* Per-site overrides */}
              <div className="privacy-section-title">{t.permSitesTitle}</div>
              {permEntries.length === 0
                ? <div className="panel-empty">{t.noSavedPermissions}</div>
                : permEntries.map(({ origin, perm, allowed }, i) => (
                    <div key={i} className="privacy-toggle-row">
                      <span className="panel-item-icon">{allowed ? <CheckCircleIcon size={16} style={{ color: 'var(--safe)' }} /> : <SlashCircleIcon size={16} style={{ color: 'var(--danger)' }} />}</span>
                      <div className="privacy-toggle-text" style={{ flex: 1, minWidth: 0 }}>
                        <div className="privacy-toggle-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{hostOf(origin)}</div>
                        <div className="privacy-toggle-desc">{PERM_LABELS[perm] || perm}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          className="autolock-select"
                          value={allowed ? 'allow' : 'block'}
                          onChange={e => setSitePerm(origin, perm, e.target.value === 'allow')}
                        >
                          <option value="allow">{t.allow}</option>
                          <option value="block">{t.block}</option>
                        </select>
                        <button className="perm-reset-btn" title={t.permReset} onClick={() => resetSitePerm(origin, perm)}>
                          <XIcon size={12} />
                        </button>
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
