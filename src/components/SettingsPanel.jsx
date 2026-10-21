import React, { useState, useEffect } from 'react'
import { useT, useLang } from '../LanguageContext.jsx'
import { SettingsIcon, GlobeIcon, ChevronLeftIcon, XIcon } from './Icons.jsx'

const LOCATIONS = [
  { id: 'auto',  name: 'System Default',   city: '',            flag: '🌐', lat: null,     lng: null },
  { id: 'us-ny', name: 'United States',    city: 'New York',    flag: '🇺🇸', lat: 40.7128,  lng: -74.0060 },
  { id: 'us-la', name: 'United States',    city: 'Los Angeles', flag: '🇺🇸', lat: 34.0522,  lng: -118.2437 },
  { id: 'gb',    name: 'United Kingdom',   city: 'London',      flag: '🇬🇧', lat: 51.5074,  lng: -0.1278 },
  { id: 'de',    name: 'Germany',          city: 'Berlin',      flag: '🇩🇪', lat: 52.5200,  lng: 13.4050 },
  { id: 'fr',    name: 'France',           city: 'Paris',       flag: '🇫🇷', lat: 48.8566,  lng: 2.3522 },
  { id: 'jp',    name: 'Japan',            city: 'Tokyo',       flag: '🇯🇵', lat: 35.6762,  lng: 139.6503 },
  { id: 'in',    name: 'India',            city: 'Mumbai',      flag: '🇮🇳', lat: 19.0760,  lng: 72.8777 },
  { id: 'au',    name: 'Australia',        city: 'Sydney',      flag: '🇦🇺', lat: -33.8688, lng: 151.2093 },
  { id: 'br',    name: 'Brazil',           city: 'São Paulo',   flag: '🇧🇷', lat: -23.5505, lng: -46.6333 },
  { id: 'ca',    name: 'Canada',           city: 'Toronto',     flag: '🇨🇦', lat: 43.6532,  lng: -79.3832 },
  { id: 'sg',    name: 'Singapore',        city: '',            flag: '🇸🇬', lat: 1.3521,   lng: 103.8198 },
  { id: 'ae',    name: 'UAE',              city: 'Dubai',       flag: '🇦🇪', lat: 25.2048,  lng: 55.2708 },
  { id: 'nl',    name: 'Netherlands',      city: 'Amsterdam',   flag: '🇳🇱', lat: 52.3676,  lng: 4.9041 },
  { id: 'ch',    name: 'Switzerland',      city: 'Zurich',      flag: '🇨🇭', lat: 47.3769,  lng: 8.5417 },
  { id: 'kr',    name: 'South Korea',      city: 'Seoul',       flag: '🇰🇷', lat: 37.5665,  lng: 126.9780 },
  { id: 'ru',    name: 'Russia',           city: 'Moscow',      flag: '🇷🇺', lat: 55.7558,  lng: 37.6173 },
  { id: 'za',    name: 'South Africa',     city: 'Cape Town',   flag: '🇿🇦', lat: -33.9249, lng: 18.4241 },
]

export function SettingsPanel({ onClose }) {
  const t = useT()
  const { lang, changeLang, LANGUAGES } = useLang()
  const [view, setView] = useState('main')   // 'main' | 'language' | 'location'
  const [selectedLoc, setSelectedLoc] = useState('auto')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.browser.getLocation().then(loc => setSelectedLoc(loc?.id || 'auto'))
  }, [])

  const chooseLocation = async (loc) => {
    if (saving || loc.id === selectedLoc) return
    setSaving(true)
    await window.browser.setLocation(loc)
    setSelectedLoc(loc.id)
    setSaving(false)
  }

  const activeLoc   = LOCATIONS.find(l => l.id === selectedLoc) || LOCATIONS[0]
  const currentLang = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0]

  const panelTitle =
    view === 'language' ? t.language :
    view === 'location' ? t.browserLocation :
    t.settingsTitle

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          {view !== 'main' && (
            <button className="settings-back-btn" onClick={() => setView('main')}><ChevronLeftIcon size={18} /></button>
          )}
          <span>{view === 'main' ? <SettingsIcon size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> : ''}{panelTitle}</span>
          <button onClick={onClose}><XIcon size={14} /></button>
        </div>

        {/* ── Main menu ─────────────────────────────────────────────────── */}
        {view === 'main' && (
          <div className="panel-list">
            <div className="panel-item settings-menu-item" onClick={() => setView('language')}>
              <span className="panel-item-icon"><GlobeIcon size={16} /></span>
              <div className="panel-item-text">
                <div className="panel-item-title">{t.language}</div>
              </div>
              <span className="settings-menu-value">{currentLang.nativeLabel}</span>
              <span className="settings-menu-arrow">›</span>
            </div>

            <div className="panel-item settings-menu-item" onClick={() => setView('location')}>
              <span className="panel-item-icon">{activeLoc.flag}</span>
              <div className="panel-item-text">
                <div className="panel-item-title">{t.browserLocation}</div>
              </div>
              <span className="settings-menu-value">
                {activeLoc.id === 'auto' ? t.systemDefault : `${activeLoc.name}${activeLoc.city ? `, ${activeLoc.city}` : ''}`}
              </span>
              <span className="settings-menu-arrow">›</span>
            </div>
          </div>
        )}

        {/* ── Language picker ───────────────────────────────────────────── */}
        {view === 'language' && (
          <div className="panel-list">
            {LANGUAGES.map(l => (
              <div
                key={l.code}
                className={`panel-item location-item ${l.code === lang ? 'location-selected' : ''}`}
                onClick={() => changeLang(l.code)}
              >
                <div className="panel-item-text">
                  <div className="panel-item-title">{l.nativeLabel}</div>
                  <div className="panel-item-url">{l.label}</div>
                </div>
                {l.code === lang && <span className="location-check">✓</span>}
              </div>
            ))}
          </div>
        )}

        {/* ── Location picker ───────────────────────────────────────────── */}
        {view === 'location' && (
          <div className="panel-list">
            {LOCATIONS.map(loc => (
              <div
                key={loc.id}
                className={`panel-item location-item ${loc.id === selectedLoc ? 'location-selected' : ''}`}
                onClick={() => chooseLocation(loc)}
              >
                <span className="location-flag">{loc.flag}</span>
                <div className="panel-item-text">
                  <div className="panel-item-title">
                    {loc.id === 'auto' ? t.systemDefault : loc.name}
                    {loc.city ? `, ${loc.city}` : ''}
                  </div>
                  {loc.lat !== null && (
                    <div className="panel-item-url">{loc.lat.toFixed(2)}°, {loc.lng.toFixed(2)}°</div>
                  )}
                </div>
                {loc.id === selectedLoc && <span className="location-check">✓</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
