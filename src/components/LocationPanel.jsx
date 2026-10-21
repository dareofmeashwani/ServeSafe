import React, { useState, useEffect } from 'react'

export const LOCATIONS = [
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

export function LocationPanel({ onClose }) {
  const [selected, setSelected] = useState('auto')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.browser.getLocation().then(loc => setSelected(loc?.id || 'auto'))
  }, [])

  const choose = async (loc) => {
    if (saving || loc.id === selected) return
    setSaving(true)
    await window.browser.setLocation(loc)
    setSelected(loc.id)
    setSaving(false)
  }

  const activeLoc = LOCATIONS.find(l => l.id === selected) || LOCATIONS[0]

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span>🌍 Browser Location</span>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="location-active-row">
          <span className="location-active-flag">{activeLoc.flag}</span>
          <div>
            <div className="location-active-name">
              {activeLoc.id === 'auto'
                ? 'Using system location'
                : `${activeLoc.name}${activeLoc.city ? `, ${activeLoc.city}` : ''}`}
            </div>
            {activeLoc.lat !== null && (
              <div className="location-active-coords">
                {activeLoc.lat.toFixed(4)}°, {activeLoc.lng.toFixed(4)}°
              </div>
            )}
          </div>
        </div>

        <div className="panel-list">
          {LOCATIONS.map(loc => (
            <div
              key={loc.id}
              className={`panel-item location-item ${loc.id === selected ? 'location-selected' : ''}`}
              onClick={() => choose(loc)}
            >
              <span className="location-flag">{loc.flag}</span>
              <div className="panel-item-text">
                <div className="panel-item-title">
                  {loc.id === 'auto' ? 'System Default' : loc.name}
                  {loc.city ? `, ${loc.city}` : ''}
                </div>
                {loc.lat !== null && (
                  <div className="panel-item-url">{loc.lat.toFixed(2)}°, {loc.lng.toFixed(2)}°</div>
                )}
              </div>
              {loc.id === selected && <span className="location-check">✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
