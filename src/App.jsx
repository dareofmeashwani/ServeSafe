import React, { useState, useEffect, useCallback, useRef, useTransition } from 'react'
import { TabBar, AddressBar, HistoryPanel, BookmarksPanel, NewTabPage } from './components/Browser.jsx'
import { CertWarning } from './components/CertWarning.jsx'
import { PermissionToast } from './components/PermissionToast.jsx'
import { DownloadBar } from './components/DownloadBar.jsx'
import { PrivacyPanel } from './components/PrivacyPanel.jsx'
import { SettingsPanel } from './components/SettingsPanel.jsx'
import { LockScreen } from './components/LockScreen.jsx'
import { LanguageProvider, useT } from './LanguageContext.jsx'

const isBrowser = !window.browser

// Fallback mock API for Vite browser preview (no Electron)
const api = isBrowser ? {
  createTab: () => Promise.resolve(`tab_${Date.now()}`),
  createIncognitoTab: () => Promise.resolve(`tab_incog_${Date.now()}`),
  closeTab: () => Promise.resolve(),
  switchTab: () => Promise.resolve(),
  navigate: (_id, url) => Promise.resolve(url),
  goBack: () => Promise.resolve(),
  goForward: () => Promise.resolve(),
  reload: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  getURL: () => Promise.resolve(''),
  isIncognito: () => Promise.resolve(false),
  getHistory: () => Promise.resolve([]),
  addHistory: () => Promise.resolve(),
  clearHistory: () => Promise.resolve(),
  removeHistory: () => Promise.resolve(),
  notifyNavigated: () => {},
  getBookmarks: () => Promise.resolve([]),
  addBookmark: () => Promise.resolve([]),
  removeBookmark: () => Promise.resolve([]),
  getPrivacySettings: () => Promise.resolve({ doNotTrack: true, globalPrivacyControl: true, blockTrackers: true, httpsOnly: false, blockThirdPartyCookies: true }),
  savePrivacySettings: (p) => Promise.resolve(p),
  clearData: () => Promise.resolve(),
  respondToCert: () => Promise.resolve(),
  addCertException: () => Promise.resolve(),
  respondToPermission: () => Promise.resolve(),
  getPermissions: () => Promise.resolve({}),
  clearPermissions: () => Promise.resolve(),
  getDownloads: () => Promise.resolve([]),
  openDownload: () => Promise.resolve(),
  showDownload: () => Promise.resolve(),
  getTrackerStats: () => Promise.resolve(0),
  getAdStats: () => Promise.resolve(0),
  getTheme: () => Promise.resolve('light'),
  overlayOpen: () => Promise.resolve(),
  overlayClose: () => Promise.resolve(),
  getLocation: () => Promise.resolve(null),
  setLocation: (loc) => Promise.resolve(loc),
  getLastSession: () => Promise.resolve(null),
  clearLastSession: () => Promise.resolve(),
  setChromeHeight: () => {},
  authenticateSystem: () => Promise.resolve({ success: true }),
  getAuthState: () => Promise.resolve({ attemptsLeft: 3 }),
  quitApp: () => {},
  activityPing: () => {},
  getAutoLockMinutes: () => Promise.resolve(5),
  setAutoLockMinutes: (m) => Promise.resolve(m),
  getAppLockEnabled: () => Promise.resolve(true),
  setAppLockEnabled: (v) => Promise.resolve(v),
  getShortcuts: () => Promise.resolve(null),
  setShortcuts: (s) => Promise.resolve(s),
  getLanguage: () => Promise.resolve('en'),
  setLanguage: (l) => Promise.resolve(l),
  on: () => () => {},
} : window.browser

// ─── App: lock gate ───────────────────────────────────────────────────────────
// locked === null  →  waiting for initial state from main process (no render)
// locked === true  →  show LockScreen
// locked === false →  show BrowserApp
export default function App() {
  const [locked, setLocked] = useState(isBrowser ? false : null)

  // Resolve initial lock state — if the user has disabled app lock, skip the
  // lock screen entirely.  getAuthState returns { appLockEnabled, attemptsLeft }.
  useEffect(() => {
    if (isBrowser) return
    api.getAuthState().then(state => {
      setLocked(state?.appLockEnabled !== false && state?.isLocked !== false)
    })
  }, [])

  // Listen for main-process auto-lock signal (idle timeout)
  useEffect(() => {
    const cleanup = api.on('lock-app', () => setLocked(true))
    return () => cleanup?.()
  }, [])

  if (locked === null) return null   // brief loading before first IPC reply

  return (
    <LanguageProvider>
      {locked ? (
        <LockScreen
          onUnlock={() => setLocked(false)}
          onExit={() => api.quitApp?.()}
        />
      ) : (
        <BrowserApp />
      )}
    </LanguageProvider>
  )
}

// ─── BrowserApp: full browser UI (only mounts after auth) ─────────────────────
function BrowserApp() {
  const t = useT()
  // ── Tabs ────────────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)

  // ── Panels ──────────────────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // ── Security ─────────────────────────────────────────────────────────────────
  const [certWarning, setCertWarning] = useState(null)        // { id, tabId, url, error, certSubject }
  const [certErrorTabs, setCertErrorTabs] = useState(new Set()) // tabIds with active cert errors

  // ── Privacy ──────────────────────────────────────────────────────────────────
  const [permissionRequest, setPermissionRequest] = useState(null) // { id, origin, permission }
  const [trackerCounts, setTrackerCounts] = useState({})           // { tabId: number }
  const [adCounts, setAdCounts] = useState({})                     // { tabId: number }
  const [httpsBlockedUrl, setHttpsBlockedUrl] = useState(null)

  // ── Downloads ────────────────────────────────────────────────────────────────
  const [downloads, setDownloads] = useState([])

  // ── Misc ─────────────────────────────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState([])
  const [theme, setTheme] = useState('light')

  const activeTab = tabs.find(t => t.id === activeId) || null
  const [, startTransition] = useTransition()
  const chromeRef = useRef(null)

  // ─── Report chrome height to main process (fixes BrowserView y-offset) ───────
  useEffect(() => {
    const el = chromeRef.current
    if (!el) return
    const report = () => {
      const bottom = el.getBoundingClientRect().bottom
      if (bottom > 0) api.setChromeHeight?.(Math.ceil(bottom))
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [])

  // ─── Activity tracking — resets the main-process idle timer ─────────────────
  // Throttled to one IPC call per 10 s to avoid flooding the main process.
  // Mouse/keyboard/scroll events on the React chrome are enough; web-page input
  // events are handled directly in main.js via webContents.before-input-event.
  useEffect(() => {
    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing > 10_000) {
        lastPing = now
        api.activityPing?.()
      }
    }
    window.addEventListener('mousemove', ping, { passive: true })
    window.addEventListener('keydown',   ping, { passive: true })
    window.addEventListener('click',     ping, { passive: true })
    window.addEventListener('scroll',    ping, { passive: true, capture: true })
    return () => {
      window.removeEventListener('mousemove', ping)
      window.removeEventListener('keydown',   ping)
      window.removeEventListener('click',     ping)
      window.removeEventListener('scroll',    ping)
    }
  }, [])

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    api.getTheme().then(t => {
      setTheme(t)
      document.documentElement.setAttribute('data-theme', t)
    })
    api.getBookmarks().then(setBookmarks)

    // Restore last session, or open a fresh new tab on first launch.
    ;(async () => {
      const session = await api.getLastSession?.()
      if (session?.tabs?.length > 0) {
        // Create all tabs as background (no showTab flash) then switch to the active one.
        const entries = []
        for (const t of session.tabs) {
          const id = await api.createTab(t.url, { background: true })
          entries.push({
            id,
            url: t.url,
            title: t.title || 'Loading…',
            favicon: null,
            loading: true,
            canGoBack: false,
            canGoForward: false,
            incognito: false,
          })
        }
        setTabs(entries)
        const activeIdx = session.tabs.findIndex(t => t.wasActive)
        const activeEntry = entries[activeIdx >= 0 ? activeIdx : entries.length - 1]
        await api.switchTab(activeEntry.id)
        setActiveId(activeEntry.id)
        await api.clearLastSession?.()
      } else {
        openNewTab()
      }
    })()
  }, [])

  // ─── IPC event wiring (stable — registered once) ──────────────────────────────
  useEffect(() => {
    const cleanups = [
      // Security overlays — urgent, no transition
      api.on('cert-error', (data) => {
        api.overlayOpen?.()  // hide BrowserView so cert warning is visible
        setCertWarning(data)
        setCertErrorTabs(prev => new Set([...prev, data.tabId]))
      }),
      api.on('permission-request', (data) => setPermissionRequest(data)),
      api.on('https-only-blocked', ({ url }) => setHttpsBlockedUrl(url)),

      // Downloads — non-urgent, deferred
      api.on('download-started', (dl) => startTransition(() => setDownloads(prev => [...prev, dl]))),
      api.on('download-updated', ({ id, state, received, total }) =>
        startTransition(() => setDownloads(prev => prev.map(d => d.id === id ? { ...d, state, received, total } : d)))
      ),
      api.on('download-done', ({ id, state, savePath, filename }) =>
        startTransition(() => setDownloads(prev => prev.map(d => d.id === id ? { ...d, state, savePath, filename } : d)))
      ),

      // Tab opened from context menu (Open Link in New Tab, etc.)
      api.on('tab-created', ({ tabId, url, incognito, switchTo }) => {
        setTabs(prev => [...prev, {
          id: tabId, url: url || '', title: 'New Tab', favicon: null,
          loading: !!url, canGoBack: false, canGoForward: false, incognito: !!incognito,
        }])
        if (switchTo) setActiveId(tabId)
      }),

      // Menu: open new tabs
      api.on('menu-new-tab', () => openNewTab()),
      api.on('menu-new-incognito', () => openIncognitoTab()),
    ].filter(Boolean)

    return () => cleanups.forEach(fn => typeof fn === 'function' && fn())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── IPC event wiring (tab-context — re-register on tab switch) ───────────────
  useEffect(() => {
    const cleanups = [
      // Urgent navigation updates — unwrapped
      api.on('tab-navigated', ({ tabId, url }) => {
        updateTab(tabId, { url })
        setCertErrorTabs(prev => { const next = new Set(prev); next.delete(tabId); return next })
        setCertWarning(prev => (prev?.tabId === tabId ? null : prev))
      }),
      api.on('tab-loading', ({ tabId, loading }) => updateTab(tabId, { loading })),
      api.on('tab-nav-state', ({ tabId, canGoBack, canGoForward }) =>
        updateTab(tabId, { canGoBack, canGoForward })
      ),

      // Non-urgent tab updates — deferred
      api.on('tab-title-updated', ({ tabId, title }) => {
        startTransition(() => {
          updateTab(tabId, { title })
          setTabs(prev => {
            const tab = prev.find(t => t.id === tabId)
            if (tab?.url && !tab.incognito) api.notifyNavigated(tab.url, title, tabId)
            return prev
          })
        })
      }),
      api.on('tab-favicon-updated', ({ tabId, favicon }) =>
        startTransition(() => updateTab(tabId, { favicon }))
      ),
      api.on('tracker-blocked', ({ tabId, count }) =>
        startTransition(() => setTrackerCounts(prev => ({ ...prev, [tabId]: count })))
      ),
      api.on('ad-blocked', ({ tabId, count }) =>
        startTransition(() => setAdCounts(prev => ({ ...prev, [tabId]: count })))
      ),

      // Menu: tab actions (need activeId closure)
      api.on('menu-close-tab', () => setActiveId(id => { if (id) closeTab(id); return id })),
      api.on('menu-reload', () => setActiveId(id => { if (id) api.reload(id); return id })),
    ].filter(Boolean)

    return () => cleanups.forEach(fn => typeof fn === 'function' && fn())
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Tab helpers ──────────────────────────────────────────────────────────────
  const updateTab = useCallback((id, patch) =>
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)), [])

  const openNewTab = useCallback(async (url = '') => {
    const id = await api.createTab(url || undefined)
    setTabs(prev => [...prev, { id, url: url || '', title: 'New Tab', favicon: null, loading: !!url, canGoBack: false, canGoForward: false, incognito: false }])
    setActiveId(id)
    return id
  }, [])

  const openIncognitoTab = useCallback(async (url = '') => {
    const id = await api.createIncognitoTab(url || undefined)
    setTabs(prev => [...prev, { id, url: url || '', title: 'New Incognito Tab', favicon: null, loading: !!url, canGoBack: false, canGoForward: false, incognito: true }])
    setActiveId(id)
    return id
  }, [])

  const closeTab = useCallback(async (id) => {
    await api.closeTab(id)
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (id === activeId && next.length > 0) {
        const idx = Math.max(0, prev.findIndex(t => t.id === id) - 1)
        const fallback = next[Math.min(idx, next.length - 1)]
        api.switchTab(fallback.id)
        setActiveId(fallback.id)
      } else if (next.length === 0) {
        openNewTab()
      }
      return next
    })
    // Clean up related state
    setCertErrorTabs(prev => { const n = new Set(prev); n.delete(id); return n })
    setCertWarning(prev => prev?.tabId === id ? null : prev)
    setTrackerCounts(prev => { const n = { ...prev }; delete n[id]; return n })
    setAdCounts(prev => { const n = { ...prev }; delete n[id]; return n })
  }, [activeId, openNewTab])

  const switchTab = useCallback(async (id) => {
    await api.switchTab(id)
    setActiveId(id)  // must be immediate — BrowserView already swapped
  }, [])

  const moveTab = useCallback((fromId, toId) => {
    setTabs(prev => {
      const from = prev.findIndex(t => t.id === fromId)
      const to = prev.findIndex(t => t.id === toId)
      if (from === -1 || to === -1 || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const navigate = useCallback(async (url) => {
    if (!activeId) return
    const resolved = await api.navigate(activeId, url)
    updateTab(activeId, { url: resolved || url, loading: true })
    setHttpsBlockedUrl(null)
  }, [activeId])

  // ─── Panel helpers (hide BrowserView so React overlay renders on top) ────────
  const openPanel = useCallback((setter) => {
    api.overlayOpen?.()
    setter(true)
  }, [])

  const closePanel = useCallback((setter) => {
    setter(false)
    api.overlayClose?.()
  }, [])

  // ─── Bookmarks ────────────────────────────────────────────────────────────────
  const isBookmarked = activeTab ? bookmarks.some(b => b.url === activeTab.url) : false

  const toggleBookmark = async () => {
    if (!activeTab?.url) return
    const updated = isBookmarked
      ? await api.removeBookmark(activeTab.url)
      : await api.addBookmark(activeTab.url, activeTab.title)
    setBookmarks(updated)
  }

  // ─── Certificate warning handlers ────────────────────────────────────────────
  const handleCertGoBack = () => {
    if (certWarning) {
      api.respondToCert(certWarning.id, false)
      if (activeId) api.goBack(activeId)
      setCertWarning(null)
      setCertErrorTabs(prev => { const n = new Set(prev); n.delete(certWarning.tabId); return n })
      api.overlayClose?.()
    }
  }

  const handleCertProceed = () => {
    if (certWarning) {
      api.respondToCert(certWarning.id, true)
      setCertWarning(null)
      api.overlayClose?.()
    }
  }

  // ─── Permission handlers ──────────────────────────────────────────────────────
  const handlePermAllow = (id, origin, permission) => {
    api.respondToPermission(id, true, origin, permission)
    setPermissionRequest(null)
  }

  const handlePermDeny = (id, origin, permission) => {
    api.respondToPermission(id, false, origin, permission)
    setPermissionRequest(null)
  }

  // ─── Download handlers ────────────────────────────────────────────────────────
  const dismissDownload = (dlId) =>
    setDownloads(prev => prev.map(d => d.id === dlId ? { ...d, dismissed: true } : d))

  // ─── Render ───────────────────────────────────────────────────────────────────
  const showNewTabPage = !activeTab?.url || activeTab.url === '' || activeTab.url === 'about:blank'
  const hasCertError = certErrorTabs.has(activeId)
  const trackerCount = trackerCounts[activeId] || 0
  const adCount = adCounts[activeId] || 0

  return (
    <>
      <div className="browser-chrome" ref={chromeRef}>
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSwitch={switchTab}
          onClose={closeTab}
          onNew={() => openNewTab()}
          onNewIncognito={() => openIncognitoTab()}
          onMove={moveTab}
          onOverlayOpen={api.overlayOpen}
          onOverlayClose={api.overlayClose}
        />
        <AddressBar
          url={activeTab?.url || ''}
          loading={activeTab?.loading || false}
          canGoBack={activeTab?.canGoBack || false}
          canGoForward={activeTab?.canGoForward || false}
          isBookmarked={isBookmarked}
          hasCertError={hasCertError}
          trackerCount={trackerCount}
          adCount={adCount}
          onNavigate={navigate}
          onBack={() => activeId && api.goBack(activeId)}
          onForward={() => activeId && api.goForward(activeId)}
          onReload={() => activeId && api.reload(activeId)}
          onStop={() => activeId && api.stop(activeId)}
          onBookmark={toggleBookmark}
          onOpenHistory={() => openPanel(setShowHistory)}
          onOpenBookmarks={() => openPanel(setShowBookmarks)}
          onOpenPrivacy={() => openPanel(setShowPrivacy)}
          onOpenSettings={() => openPanel(setShowSettings)}
        />
      </div>

      {/* HTTPS-only blocked notification */}
      {httpsBlockedUrl && (
        <div className="https-blocked-bar">
          <span>🔒 {t.httpsBlocked} <strong>{httpsBlockedUrl}</strong></span>
          <button onClick={() => setHttpsBlockedUrl(null)}>✕</button>
        </div>
      )}

      {/* New tab page */}
      {showNewTabPage && activeId && (
        <NewTabPage onNavigate={navigate} isIncognito={activeTab?.incognito} />
      )}

      {/* Certificate warning (covers the BrowserView area) */}
      {certWarning && certWarning.tabId === activeId && (
        <CertWarning
          warning={certWarning}
          onGoBack={handleCertGoBack}
          onProceed={handleCertProceed}
        />
      )}

      {/* Permission toast */}
      {permissionRequest && (
        <PermissionToast
          request={permissionRequest}
          onAllow={handlePermAllow}
          onDeny={handlePermDeny}
        />
      )}

      {/* Download bar */}
      <DownloadBar
        downloads={downloads}
        onOpen={(p) => api.openDownload(p)}
        onShow={(p) => api.showDownload(p)}
        onDismiss={dismissDownload}
      />

      {/* Side panels */}
      {showSettings && (
        <SettingsPanel onClose={() => closePanel(setShowSettings)} />
      )}
      {showHistory && (
        <HistoryPanel
          onClose={() => closePanel(setShowHistory)}
          onNavigate={(url) => { navigate(url); closePanel(setShowHistory) }}
        />
      )}
      {showBookmarks && (
        <BookmarksPanel
          onClose={() => closePanel(setShowBookmarks)}
          onNavigate={(url) => { navigate(url); closePanel(setShowBookmarks) }}
        />
      )}
      {showPrivacy && (
        <PrivacyPanel
          onClose={() => closePanel(setShowPrivacy)}
          activeTabId={activeId}
          trackerCount={trackerCount}
          adCount={adCount}
        />
      )}
    </>
  )
}
