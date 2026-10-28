import React, { useState, useEffect, useRef, useDeferredValue, useCallback, useLayoutEffect } from 'react'
import { useT } from '../LanguageContext.jsx'
import {
  GlobeIcon, LockIcon, AlertTriangleIcon, AlertOctagonIcon,
  ClockIcon, BookmarkIcon, ShieldIcon, SettingsIcon, EyeOffIcon,
  XIcon, PlusIcon, ReloadIcon, ChevronLeftIcon, ChevronRightIcon,
  SearchIcon,
} from './Icons.jsx'

const DEFAULT_SHORTCUTS = [
  { id: 'gs', label: 'Google',    icon: '🔍', url: 'https://google.com'   },
  { id: 'yt', label: 'YouTube',   icon: '▶️',  url: 'https://youtube.com'  },
  { id: 'gh', label: 'GitHub',    icon: '🐙', url: 'https://github.com'   },
  { id: 'wp', label: 'Wikipedia', icon: '📖', url: 'https://wikipedia.org' },
]

// ─── Tab Item (memoized — only re-renders when its own data or active state changes) ──
const TabItem = React.memo(function TabItem({ tab, isActive, onSwitch, onClose, onMove, dragRef, tabRef }) {
  const [dragOver, setDragOver] = useState(false)
  const t = useT()
  return (
    <div
      ref={tabRef}
      className={`tab ${isActive ? 'active' : ''} ${tab.incognito ? 'is-incognito' : ''} ${dragOver ? 'drag-over' : ''}`}
      draggable
      onDragStart={e => {
        dragRef.current = tab.id
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (dragRef.current && dragRef.current !== tab.id) {
          onMove(dragRef.current, tab.id)
        }
        dragRef.current = null
      }}
      onDragEnd={() => {
        setDragOver(false)
        dragRef.current = null
      }}
      onClick={() => onSwitch(tab.id)}
      title={tab.title || tab.url}
    >
      {tab.loading
        ? <div className="tab-spinner" />
        : tab.favicon
          ? <img className="tab-favicon" src={tab.favicon} alt="" onError={e => (e.target.style.display = 'none')} />
          : tab.incognito
            ? <EyeOffIcon size={16} className="tab-favicon" />
            : <GlobeIcon size={16} className="tab-favicon" />
      }
      <span className="tab-title">{tab.title || t.newTab}</span>
      <button
        className="tab-close"
        onClick={e => { e.stopPropagation(); onClose(tab.id) }}
        title={t.closeTabTitle}
      ><XIcon size={10} /></button>
    </div>
  )
}, (prev, next) => prev.tab === next.tab && prev.isActive === next.isActive && prev.onMove === next.onMove)

// ─── Tab Bar ──────────────────────────────────────────────────────────────────
export const TabBar = React.memo(function TabBar({ tabs, activeId, onSwitch, onClose, onNew, onNewIncognito, onMove, onOverlayOpen, onOverlayClose }) {
  const t = useT()
  const dragRef = useRef(null)
  const barRef = useRef(null)
  const actionsRef = useRef(null)
  const tabRefs = useRef({}) // { [id]: HTMLElement }
  const [overflowStart, setOverflowStart] = useState(Infinity)
  const [showMenu, setShowMenu] = useState(false)

  const compute = useCallback(() => {
    const bar = barRef.current
    if (!bar) return

    // Padding reserved by CSS (macOS traffic lights + right padding)
    const PADDING = 80 + 8
    const actionsW = actionsRef.current?.offsetWidth ?? 62
    const MORE_BTN = 38 // "▾ N" button
    const totalForTabs = bar.clientWidth - PADDING - actionsW

    const fit = (limit) => {
      let used = 0
      for (let i = 0; i < tabs.length; i++) {
        const el = tabRefs.current[tabs[i].id]
        const w = (el instanceof HTMLElement ? el.offsetWidth : 120) + 2 // +2 gap
        if (used + w > limit) return i
        used += w
      }
      return Infinity
    }

    // First pass: do all tabs fit without a "more" button?
    if (fit(totalForTabs) === Infinity) {
      setOverflowStart(Infinity)
      return
    }
    // Second pass: reserve space for the "more" button
    const c = fit(totalForTabs - MORE_BTN)
    setOverflowStart(Math.max(1, c === Infinity ? tabs.length : c))
  }, [tabs])

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [compute])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showMenu) return
    const close = () => setShowMenu(false)
    document.addEventListener('click', close, { once: true })
    return () => document.removeEventListener('click', close)
  }, [showMenu])

  // Hide BrowserView while dropdown is open (it sits on top natively in Electron)
  useEffect(() => {
    if (!showMenu) return
    onOverlayOpen?.()
    return () => onOverlayClose?.()
  }, [showMenu, onOverlayOpen, onOverlayClose])

  const visibleTabs = overflowStart === Infinity ? tabs : tabs.slice(0, overflowStart)
  const overflowTabs = overflowStart === Infinity ? [] : tabs.slice(overflowStart)
  const hasActiveInOverflow = overflowTabs.some(tab => tab.id === activeId)

  return (
    <div className="tab-bar" ref={barRef}>
      {visibleTabs.map(tab => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeId}
          onSwitch={onSwitch}
          onClose={onClose}
          onMove={onMove}
          dragRef={dragRef}
          tabRef={el => { tabRefs.current[tab.id] = el }}
        />
      ))}

      {overflowTabs.length > 0 && (
        <div className="tab-overflow-wrap" onClick={e => e.stopPropagation()}>
          <button
            className={`tab-overflow-btn${hasActiveInOverflow ? ' has-active' : ''}`}
            onClick={() => setShowMenu(v => !v)}
            title={t.moreTabsTitle ?? 'More tabs'}
          >
            ▾ {overflowTabs.length}
          </button>
          {showMenu && (
            <div className="tab-overflow-dropdown">
              {overflowTabs.map(tab => (
                <div
                  key={tab.id}
                  className={`tab-overflow-item${tab.id === activeId ? ' active' : ''}`}
                  onClick={() => { onSwitch(tab.id); setShowMenu(false) }}
                >
                  {tab.favicon
                    ? <img className="tab-overflow-favicon" src={tab.favicon} alt="" onError={e => (e.target.style.display = 'none')} />
                    : tab.incognito
                      ? <EyeOffIcon size={14} />
                      : <GlobeIcon size={14} />
                  }
                  <span className="tab-overflow-title">{tab.title || t.newTab}</span>
                  <button
                    className="tab-close"
                    onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                    title={t.closeTabTitle}
                  ><XIcon size={10} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={actionsRef} className="tab-bar-actions">
        <button className="new-tab-btn" onClick={onNew} title={t.newTabBtnTitle}><PlusIcon size={16} /></button>
        <button className="new-tab-btn incognito-btn" onClick={onNewIncognito} title={t.newIncognitoTabTitle}><EyeOffIcon size={14} /></button>
      </div>
    </div>
  )
})

// ─── Security Badge ───────────────────────────────────────────────────────────
function SecurityBadge({ url, hasCertError, trackerCount, adCount, onToggle }) {
  const t = useT()
  const isSecure = url && url.startsWith('https://')
  const isInsecure = url && url.startsWith('http://') && !url.startsWith('http://localhost')

  let icon, cls, title
  if (hasCertError) {
    icon = <AlertOctagonIcon size={14} />; cls = 'insecure'; title = t.certError
  } else if (isSecure) {
    icon = <LockIcon size={14} />; cls = 'secure'; title = t.secureConnection
  } else if (isInsecure) {
    icon = <AlertTriangleIcon size={14} />; cls = 'insecure'; title = t.notSecure
  } else {
    icon = <GlobeIcon size={14} />; cls = ''; title = t.noPage
  }

  const blockedCount = (trackerCount || 0) + (adCount || 0)

  return (
    <div className="security-badge-wrap">
      <button className={`security-icon-btn ${cls}`} onClick={onToggle} title={title}>
        {icon}
        {blockedCount > 0 && <span className="tracker-badge">{blockedCount}</span>}
      </button>
    </div>
  )
}

// ─── Address Bar ──────────────────────────────────────────────────────────────
export function AddressBar({
  url, loading, canGoBack, canGoForward,
  isBookmarked, hasCertError, trackerCount, adCount,
  onNavigate, onBack, onForward, onReload, onStop,
  onBookmark, onOpenHistory, onOpenBookmarks, onOpenPrivacy, onOpenSettings,
}) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [showSecurityPopover, setShowSecurityPopover] = useState(false)
  const inputRef = useRef(null)
  const t = useT()

  useEffect(() => {
    if (!focused) setInput(url || '')
  }, [url, focused])

  // Close security popover when clicking elsewhere
  useEffect(() => {
    if (!showSecurityPopover) return
    const close = () => setShowSecurityPopover(false)
    document.addEventListener('click', close, { once: true })
    return () => document.removeEventListener('click', close)
  }, [showSecurityPopover])

  const handleSubmit = (e) => {
    e.preventDefault()
    onNavigate(input.trim())
  }

  const handleFocus = () => {
    setFocused(true)
    setInput(url || '')
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleBlur = () => {
    setFocused(false)
    setInput(url || '')
  }

  const isSecure = url && url.startsWith('https://')
  let certIssuerLine = null
  if (isSecure && !hasCertError) {
    let hostname = ''
    try { hostname = new URL(url).hostname } catch {}
    certIssuerLine = hostname
  }

  return (
    <div className="nav-bar">
      <button className="nav-btn" onClick={onBack} disabled={!canGoBack} title={t.back}><ChevronLeftIcon size={16} /></button>
      <button className="nav-btn" onClick={onForward} disabled={!canGoForward} title={t.forward}><ChevronRightIcon size={16} /></button>
      <button className="nav-btn" onClick={loading ? onStop : onReload} title={loading ? t.stop : t.reload}>
        {loading ? <XIcon size={16} /> : <ReloadIcon size={16} />}
      </button>

      <div className="address-bar-wrap">
        <SecurityBadge
          url={url}
          hasCertError={hasCertError}
          trackerCount={trackerCount}
          adCount={adCount}
          onToggle={(e) => { e.stopPropagation(); setShowSecurityPopover(v => !v) }}
        />

        {showSecurityPopover && (
          <div className="security-popover" onClick={e => e.stopPropagation()}>
            {hasCertError && <div className="popover-row danger">{t.certErrorShort}</div>}
            {!hasCertError && isSecure && <div className="popover-row safe">{t.connectionSecure}</div>}
            {!hasCertError && !isSecure && <div className="popover-row warn">{t.connectionNotEncrypted}</div>}
            {certIssuerLine && <div className="popover-row muted">{t.siteLabel}: {certIssuerLine}</div>}
            {trackerCount > 0 && <div className="popover-row">{t.trackersBlocked(trackerCount)}</div>}
            {adCount > 0 && <div className="popover-row">{t.adsBlocked(adCount)}</div>}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex' }}>
          <input
            ref={inputRef}
            className="address-input"
            value={focused ? input : (url || '')}
            onChange={e => setInput(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={t.searchPlaceholder}
            spellCheck={false}
            autoComplete="off"
          />
        </form>

        <button
          className={`bookmark-btn ${isBookmarked ? 'bookmarked' : ''}`}
          onClick={onBookmark}
          title={isBookmarked ? t.removeBookmark : t.addBookmark}
        ><BookmarkIcon size={16} filled={isBookmarked} /></button>
      </div>

      <button className="nav-btn" onClick={onOpenHistory} title={t.history}><ClockIcon size={16} /></button>
      <button className="nav-btn" onClick={onOpenBookmarks} title={t.bookmarks}><BookmarkIcon size={16} /></button>
      <button className="nav-btn privacy-shield-btn" onClick={onOpenPrivacy} title={t.privacySecurity}><ShieldIcon size={16} /></button>
      <button className="nav-btn" onClick={onOpenSettings} title={t.settingsTitle}><SettingsIcon size={16} /></button>
    </div>
  )
}

// ─── History Panel ────────────────────────────────────────────────────────────
export function HistoryPanel({ onClose, onNavigate }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const workerRef = useRef(null)
  const deferredQuery = useDeferredValue(query)
  const isPending = query !== deferredQuery
  const t = useT()

  // Start worker, load all items once
  useEffect(() => {
    const w = new Worker(new URL('../workers/historySearch.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = w
    w.onmessage = ({ data }) => {
      if (data.type === 'RESULTS') setResults(data.results)
      if (data.type === 'LOADED') {
        // Initial load: show all items
        w.postMessage({ type: 'SEARCH', payload: { query: '', requestId: 0 } })
      }
    }
    window.browser.getHistory().then(items => {
      w.postMessage({ type: 'LOAD', payload: { items } })
    })
    return () => w.terminate()
  }, [])

  // Re-search whenever deferred query changes
  useEffect(() => {
    workerRef.current?.postMessage({
      type: 'SEARCH',
      payload: { query: deferredQuery, requestId: Date.now() },
    })
  }, [deferredQuery])

  const remove = async (url) => {
    await window.browser.removeHistory(url)
    workerRef.current?.postMessage({ type: 'INVALIDATE' })
    setResults(prev => prev.filter(h => h.url !== url))
  }

  const clearAll = async () => {
    await window.browser.clearHistory()
    workerRef.current?.postMessage({ type: 'INVALIDATE' })
    setResults([])
  }

  const fmt = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span>{t.history}</span>
          <button onClick={onClose}><XIcon size={14} /></button>
        </div>
        <div className="panel-search">
          <input autoFocus placeholder={t.searchHistory} value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="panel-list" style={{ opacity: isPending ? 0.6 : 1, transition: 'opacity 0.15s' }}>
          {results.length === 0
            ? <div className="panel-empty">{t.noHistory}</div>
            : results.map((h, i) => (
              <div key={i} className="panel-item" onClick={() => { onNavigate(h.url); onClose() }}>
                <span className="panel-item-icon"><ClockIcon size={14} /></span>
                <div className="panel-item-text">
                  <div className="panel-item-title">{h.title || h.url}</div>
                  <div className="panel-item-url">{h.url}</div>
                </div>
                <span className="panel-item-time">{fmt(h.visitedAt)}</span>
                <button className="panel-item-del" onClick={e => { e.stopPropagation(); remove(h.url) }}><XIcon size={10} /></button>
              </div>
            ))
          }
        </div>
        {results.length > 0 && (
          <div className="panel-footer">
            <button onClick={clearAll}>{t.clearAllHistory}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bookmarks Panel ──────────────────────────────────────────────────────────
export function BookmarksPanel({ onClose, onNavigate }) {
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const t = useT()

  useEffect(() => {
    window.browser.getBookmarks().then(setItems)
  }, [])

  const filtered = deferredQuery
    ? items.filter(b => b.url.includes(deferredQuery) || (b.title || '').toLowerCase().includes(deferredQuery.toLowerCase()))
    : items

  const remove = async (url) => {
    const updated = await window.browser.removeBookmark(url)
    setItems(updated)
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span>{t.bookmarks}</span>
          <button onClick={onClose}><XIcon size={14} /></button>
        </div>
        <div className="panel-search">
          <input autoFocus placeholder={t.searchBookmarks} value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="panel-list">
          {filtered.length === 0
            ? <div className="panel-empty">{t.noBookmarks}</div>
            : filtered.map((b, i) => (
              <div key={i} className="panel-item" onClick={() => { onNavigate(b.url); onClose() }}>
                <span className="panel-item-icon"><BookmarkIcon size={14} filled /></span>
                <div className="panel-item-text">
                  <div className="panel-item-title">{b.title || b.url}</div>
                  <div className="panel-item-url">{b.url}</div>
                </div>
                <button className="panel-item-del" onClick={e => { e.stopPropagation(); remove(b.url) }}><XIcon size={10} /></button>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ─── New Tab Page ─────────────────────────────────────────────────────────────
export function NewTabPage({ onNavigate, isIncognito }) {
  const [query, setQuery] = useState('')
  const [shortcuts, setShortcuts] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const urlInputRef = useRef(null)
  const t = useT()

  useEffect(() => {
    window.browser?.getShortcuts?.()
      .then(s => setShortcuts(s ?? DEFAULT_SHORTCUTS))
      .catch(() => setShortcuts(DEFAULT_SHORTCUTS))
  }, [])

  useEffect(() => {
    if (adding) urlInputRef.current?.focus()
  }, [adding])

  const persist = async (next) => {
    const saved = await window.browser?.setShortcuts?.(next)
    setShortcuts(saved ?? next)
  }

  const handleSearch = (e) => {
    e.preventDefault()
    if (query.trim()) onNavigate(query.trim())
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    const url = newUrl.trim()
    if (!url) return
    let hostname = url
    try { hostname = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '') } catch {}
    const label = newLabel.trim() || hostname
    const icon  = newIcon.trim()  || label[0]?.toUpperCase() || '🔗'
    const resolvedUrl = url.startsWith('http') ? url : 'https://' + url
    await persist([...(shortcuts ?? []), { id: String(Date.now()), label, icon, url: resolvedUrl }])
    setAdding(false)
    setNewUrl('')
    setNewLabel('')
    setNewIcon('')
  }

  const handleDelete = async (id) => {
    await persist((shortcuts ?? []).filter(s => s.id !== id))
  }

  return (
    <div className={`new-tab-page ${isIncognito ? 'incognito-page' : ''}`}>
      <div className="new-tab-logo">{isIncognito ? <EyeOffIcon size={48} /> : <ShieldIcon size={48} />}</div>
      <div className="new-tab-title">{isIncognito ? t.incognitoMode : 'ServeSafe'}</div>
      {isIncognito && (
        <p className="incognito-notice">{t.incognitoNotice}</p>
      )}
      <form className="new-tab-search" onSubmit={handleSearch}>
        <input
          autoFocus
          placeholder={t.searchOrEnter}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="submit"><SearchIcon size={18} /></button>
      </form>

      {!isIncognito && shortcuts !== null && (
        <div className="new-tab-shortcuts">
          {shortcuts.map(s => (
            <div key={s.id} className="shortcut-wrap">
              <div className="shortcut-item" onClick={() => onNavigate(s.url)}>
                <div className="shortcut-icon">{s.icon}</div>
                <span className="shortcut-label">{s.label}</span>
              </div>
              <button
                className="shortcut-delete"
                title={t.removeShortcut}
                onClick={e => { e.stopPropagation(); handleDelete(s.id) }}
              ><XIcon size={8} /></button>
            </div>
          ))}

          {adding ? (
            <form className="shortcut-add-form" onSubmit={handleAdd}>
              <input
                ref={urlInputRef}
                className="shortcut-add-input"
                placeholder={t.shortcutUrlPlaceholder}
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                required
              />
              <input
                className="shortcut-add-input"
                placeholder={t.shortcutLabelPlaceholder}
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
              />
              <input
                className="shortcut-add-input shortcut-add-icon"
                placeholder={t.shortcutIconPlaceholder}
                value={newIcon}
                onChange={e => setNewIcon(e.target.value)}
                maxLength={8}
              />
              <div className="shortcut-add-actions">
                <button type="submit" className="shortcut-add-confirm">{t.add}</button>
                <button type="button" className="shortcut-add-cancel" onClick={() => { setAdding(false); setNewUrl(''); setNewLabel(''); setNewIcon('') }}>{t.cancel}</button>
              </div>
            </form>
          ) : (
            shortcuts.length < 20 && (
              <div className="shortcut-wrap">
                <div className="shortcut-item shortcut-add-btn" onClick={() => setAdding(true)}>
                  <div className="shortcut-icon shortcut-add-icon-tile"><PlusIcon size={24} /></div>
                  <span className="shortcut-label">{t.addShortcut}</span>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
