const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  shell,
  dialog,
  Menu,
  clipboard,
  nativeTheme,
  systemPreferences,
} = require('electron')
const path = require('path')
const fs = require('fs')
const storeKey = require('./storeKey')
const security = require('./security')
const privacy = require('./privacy')
const filterEngine = require('./filterEngine')

let store  // set to the encrypted electron-store instance in app.whenReady()
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged// Anti-fingerprinting script — loaded once, injected into every page via CDP
const antiFingerprintScript = fs.readFileSync(
  path.join(__dirname, 'antiFingerprint.js'), 'utf8'
)

// ─── macOS GPU helper fix (development / unsigned builds) ─────────────────────
// Without code-signing entitlements the separate GPU helper process can't get
// sandbox extensions to its own app bundle or VideoProcessing.framework.
// Running the GPU thread in-process (main process is not sandboxed) avoids
// spawning the helper entirely, fixing both errors without affecting rendering.
if (process.platform === 'darwin' && !app.isPackaged) {
  app.commandLine.appendSwitch('in-process-gpu')
}

// Prevent WebRTC from leaking the local LAN IP — only the public interface is used
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'default_public_interface_only')

// ─── Per-window state ─────────────────────────────────────────────────────────
// Each BrowserWindow gets its own state object so multiple windows are fully
// isolated: separate tab sets, BrowserViews, overlay flags, chrome heights, etc.
const windowStates = new Map()  // winId -> state

function createWindowState(win) {
  return {
    win,
    browserViews:       new Map(),  // tabId -> BrowserView
    trackerStats:       new Map(),  // tabId -> count
    adStats:            new Map(),  // tabId -> count
    activeTabId:        null,
    chromeHeight:       88,
    chromeHeightTimer:  null,
    overlayActive:      false,
  }
}

// ─── Window state lookups ──────────────────────────────────────────────────────
function getWS(senderWebContents) {
  for (const ws of windowStates.values()) {
    if (ws.win.webContents === senderWebContents) return ws
  }
  return null
}

function getWSByViewWebContentsId(wcId) {
  for (const ws of windowStates.values()) {
    for (const view of ws.browserViews.values()) {
      try { if (view.webContents.id === wcId) return ws } catch {}
    }
  }
  return null
}

function sendToWindow(ws, channel, payload) {
  if (ws && ws.win && !ws.win.isDestroyed()) ws.win.webContents.send(channel, payload)
}

// ─── Global state (shared across all windows) ─────────────────────────────────
const incognitoTabs = new Set()  // tabIds using the incognito session (globally unique)
const downloads = []             // in-memory download list, shown in all windows

// Pending permission requests: id -> callback (keyed globally; permissions span windows)
const pendingPermissions = new Map()
let permCounter = 0
function newPermId() { return `perm_${++permCounter}` }

// Worker pool for request filtering (initialized in app.whenReady)

// Debounced history write state
let historyBatch = null
let historyFlushTimer = null

// ── Auto-lock idle tracking ────────────────────────────────────────────────────
let isAppLocked = true       // mirrors the renderer lock state; idle timer skips when true
let lastActivity = Date.now()
let idleCheckTimer = null

function resetActivity() {
  lastActivity = Date.now()
}

// ── URL validation helpers ─────────────────────────────────────────────────────
const MAX_URL_LENGTH = 2048
const MAX_TITLE_LENGTH = 500

const DEFAULT_SHORTCUTS = [
  { id: 'gs', label: 'Google',    icon: '🔍', url: 'https://google.com'   },
  { id: 'yt', label: 'YouTube',   icon: '▶️',  url: 'https://youtube.com'  },
  { id: 'gh', label: 'GitHub',    icon: '🐙', url: 'https://github.com'   },
  { id: 'wp', label: 'Wikipedia', icon: '📖', url: 'https://wikipedia.org' },
]

function isSafeUrl(url) {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch { return false }
}

// ── IPC lock guard ─────────────────────────────────────────────────────────────
// Wraps sensitive IPC handlers so they throw while the app is locked.
// Prevents a compromised renderer from accessing user data before authentication.
function requireUnlocked(handler) {
  return async (event, ...args) => {
    if (isAppLocked) throw new Error('[ServeSafe] browser is locked')
    return handler(event, ...args)
  }
}

// ─── Security: block dangerous protocols globally ─────────────────────────────
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    // Block schemes that can be abused for injection or phishing.
    // data: / blob: can host full HTML pages that look like real sites.
    // file: bypasses origin isolation.
    // Only http:, https:, and about: are permitted.
    if (/^(javascript|vbscript|data|blob|file):/i.test(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

// ─── Session setup helper (used for both default and incognito sessions) ───────
function setupSession(sess, { incognito = false } = {}) {
  const SAFE_PERMISSIONS = ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']

  // Permission request handler — show UI for camera/mic/geo/notifications
  sess.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (SAFE_PERMISSIONS.includes(permission)) { callback(true); return }

    // Auto-grant geolocation when a custom location is active
    if (permission === 'geolocation') {
      const loc = store.get('location', null)
      if (loc && loc.id !== 'auto') { callback(true); return }
    }

    // Check for a previously saved decision
    const origin = (() => { try { return new URL(wc.getURL()).origin } catch { return '' } })()
    // Use bracket notation: origins contain dots which dot-prop would split as path segments,
    // causing 'https://example.com' to collide with other keys.
    const saved = store.get('permissions', {})?.[origin]?.[permission]
    if (saved !== undefined) { callback(saved === true); return }

    const id = newPermId()
    pendingPermissions.set(id, callback)

    // Auto-deny after 30 seconds
    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.get(id)(false)
        pendingPermissions.delete(id)
      }
    }, 30_000)

    // Find the window that owns this webContents and send to it
    const ownerWS = getWSByViewWebContentsId(wc.id) || [...windowStates.values()][0]
    sendToWindow(ownerWS, 'permission-request', { id, origin, permission })
  })

  sess.setPermissionCheckHandler((wc, permission) => {
    if (SAFE_PERMISSIONS.includes(permission)) return true
    const origin = (() => { try { return new URL(wc.getURL()).origin } catch { return '' } })()
    return store.get('permissions', {})?.[origin]?.[permission] === true
  })

  // Request blocking: synchronous check — all lookups are in-memory Set/array operations.
  // Must be synchronous; Electron 44's network service crashes when onBeforeRequest
  // callbacks are async and concurrent requests pile up before the promise resolves.
  sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const settings = privacy.getSettings()
    let cancel = false
    let reason = null

    try {
      const { hostname } = new URL(details.url)
      const blocklist = store?.get('blocklist', []) ?? []

      if (blocklist.includes(hostname)) {
        cancel = true; reason = 'blocklist'
      } else if (settings.httpsOnly && details.url.startsWith('http://') &&
                 hostname !== 'localhost' && !hostname.startsWith('127.')) {
        cancel = true; reason = 'https-only'
      } else if (settings.blockTrackers && filterEngine.matchTrackers(details)) {
        cancel = true; reason = 'tracker'
      } else if (settings.blockAds && filterEngine.matchAds(details)) {
        cancel = true; reason = 'ad'
      }
    } catch { /* unparseable URL — allow through */ }

    if (cancel && (reason === 'tracker' || reason === 'ad')) {
      const ownerWS = getWSByViewWebContentsId(details.webContentsId)
      if (ownerWS) {
        let tabId
        for (const [id, v] of ownerWS.browserViews) {
          try { if (v.webContents.id === details.webContentsId) { tabId = id; break } } catch {}
        }
        if (tabId) {
          if (reason === 'tracker') {
            const count = (ownerWS.trackerStats.get(tabId) || 0) + 1
            ownerWS.trackerStats.set(tabId, count)
            sendToWindow(ownerWS, 'tracker-blocked', { tabId, url: details.url, count })
          } else {
            const count = (ownerWS.adStats.get(tabId) || 0) + 1
            ownerWS.adStats.set(tabId, count)
            sendToWindow(ownerWS, 'ad-blocked', { tabId, url: details.url, count })
          }
        }
      }
    }
    if (cancel && reason === 'https-only') {
      const ownerWS = getWSByViewWebContentsId(details.webContentsId)
        || [...windowStates.values()][0]
      sendToWindow(ownerWS, 'https-only-blocked', { url: details.url })
    }

    cb({ cancel })
  })

  // Request header privacy: strip fingerprinting vectors, enforce privacy signals
  sess.webRequest.onBeforeSendHeaders((details, cb) => {
    const settings = privacy.getSettings()
    const headers = { ...details.requestHeaders }

    // Privacy opt-out signals
    if (settings.doNotTrack) headers['DNT'] = '1'
    if (settings.globalPrivacyControl) headers['Sec-GPC'] = '1'

    // Strip all Client Hints — these expose OS, CPU arch, browser version to every server
    for (const h of [
      'Sec-CH-UA', 'Sec-CH-UA-Mobile', 'Sec-CH-UA-Platform',
      'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Full-Version',
      'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Model', 'Sec-CH-UA-WoW64',
      'Sec-CH-UA-Form-Factors',
      'Sec-CH-Prefers-Color-Scheme', 'Sec-CH-Prefers-Reduced-Motion',
      'Sec-CH-DPR', 'Sec-CH-Viewport-Width', 'Sec-CH-Width',
    ]) delete headers[h]

    // Normalize Accept-Language — full locale (e.g. de-DE) is a fingerprint vector
    headers['Accept-Language'] = 'en-US,en;q=0.9'

    // Remove Google's proprietary Chrome client-data header sent to Google domains
    delete headers['X-Client-Data']

    // Strip cross-origin Referer to prevent source-page tracking across sites.
    // Same-origin Referer is kept (required for CSRF tokens, form submissions).
    if (headers['Referer']) {
      try {
        const reqOrigin = new URL(details.url).origin
        const refOrigin = new URL(headers['Referer']).origin
        if (reqOrigin !== refOrigin) delete headers['Referer']
      } catch {
        delete headers['Referer']
      }
    }

    // Block Cookie header on cross-origin (third-party) sub-resource requests
    if (settings.blockThirdPartyCookies && headers['Cookie'] && details.referrer) {
      try {
        const reqHost = new URL(details.url).hostname
        const refHost = new URL(details.referrer).hostname
        const isThirdParty = reqHost !== refHost
          && !reqHost.endsWith('.' + refHost)
          && !refHost.endsWith('.' + reqHost)
        if (isThirdParty) delete headers['Cookie']
      } catch {}
    }

    cb({ requestHeaders: headers })
  })

  // Response header privacy: block third-party Set-Cookie to prevent supercookies
  sess.webRequest.onHeadersReceived((details, cb) => {
    const settings = privacy.getSettings()
    const headers = { ...details.responseHeaders }

    // Inject a strict Content-Security-Policy on any renderer window to
    // prevent XSS from escalating into full IPC access via window.browser.
    // BrowserView webContents have different IDs so they are not affected.
    const isRendererWindow = [...windowStates.values()].some(ws =>
      !ws.win.isDestroyed() && ws.win.webContents.id === details.webContentsId
    )
    if (isRendererWindow) {
      headers['Content-Security-Policy'] = [isDev
        // Dev: allow eval + inline (Vite HMR & @vitejs/plugin-react preamble) and localhost WebSocket
        ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:* http://localhost:*; object-src 'none'; base-uri 'self';"
        // Prod: no eval, no external connections
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'self';",
      ]
    }

    if (settings.blockThirdPartyCookies && headers['set-cookie'] && details.referrer) {
      try {
        const reqHost = new URL(details.url).hostname
        const refHost = new URL(details.referrer).hostname
        const isThirdParty = reqHost !== refHost
          && !reqHost.endsWith('.' + refHost)
          && !refHost.endsWith('.' + reqHost)
        if (isThirdParty) delete headers['set-cookie']
      } catch {}
    }

    cb({ responseHeaders: headers })
  })

  // Download tracking — broadcast to all open windows
  sess.on('will-download', (event, item) => {
    const dlId = `dl_${Date.now()}`
    const filename = item.getFilename()
    const dl = { id: dlId, filename, url: item.getURL(), state: 'progressing', received: 0, total: item.getTotalBytes(), savePath: '' }
    downloads.push(dl)
    for (const ws of windowStates.values()) sendToWindow(ws, 'download-started', { ...dl })

    item.on('updated', (_, state) => {
      dl.state = state
      dl.received = item.getReceivedBytes()
      dl.total = item.getTotalBytes()
      for (const ws of windowStates.values()) sendToWindow(ws, 'download-updated', { id: dlId, state, received: dl.received, total: dl.total })
    })

    item.once('done', (_, state) => {
      dl.state = state
      dl.savePath = item.getSavePath()
      for (const ws of windowStates.values()) sendToWindow(ws, 'download-done', { id: dlId, state, savePath: dl.savePath, filename })
    })
  })
}

// ─── Window creation ───────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 10 },
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
  })

  const ws = createWindowState(win)
  windowStates.set(win.id, ws)

  if (isDev) {
    win.loadURL('http://localhost:5173')
    // Only auto-open DevTools for the first window to avoid clutter
    if (windowStates.size === 1) win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('close', () => {
    // Save open (non-incognito) tabs so they can be restored on next launch.
    // Only save for the last remaining window — earlier-closed windows are not persisted.
    if (windowStates.size === 1) {
      const tabs = []
      ws.browserViews.forEach((view, tabId) => {
        if (incognitoTabs.has(tabId)) return
        const url = view.webContents.getURL()
        if (url && url !== 'about:blank') {
          tabs.push({ url, title: view.webContents.getTitle() || url, wasActive: tabId === ws.activeTabId })
        }
      })
      if (tabs.length > 0) {
        if (!tabs.some(t => t.wasActive)) tabs[tabs.length - 1].wasActive = true
        store.set('lastSession', { tabs })
      } else {
        store.delete('lastSession')
      }
    }
  })

  win.on('closed', () => {
    ws.browserViews.forEach(v => { incognitoTabs.delete(v._tabId); v.webContents.destroy() })
    ws.browserViews.clear()
    windowStates.delete(win.id)
  })

  win.on('resize', () => {
    if (ws.activeTabId && ws.browserViews.has(ws.activeTabId)) {
      layoutBrowserView(ws, ws.browserViews.get(ws.activeTabId))
    }
  })

  buildMenu()
  return win
}

// Keep `sendToRenderer` for menu actions — targets the focused window.
function sendToRenderer(channel, payload) {
  const win = BrowserWindow.getFocusedWindow() || [...windowStates.values()][0]?.win
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}


// ─── BrowserView layout ────────────────────────────────────────────────────────
function layoutBrowserView(ws, view) {
  if (!ws.win || ws.overlayActive) return
  const url = view.webContents.getURL()
  if (!url || url === 'about:blank') {
    // New-tab page: keep view fully detached so React renders through unobstructed.
    ws.win.removeBrowserView(view)
    return
  }
  if (!ws.win.getBrowserViews().includes(view)) ws.win.addBrowserView(view)
  const [w, h] = ws.win.getContentSize()
  view.setBounds({ x: 0, y: ws.chromeHeight, width: w, height: Math.max(1, h - ws.chromeHeight) })
}

// ─── Tab helpers ───────────────────────────────────────────────────────────────
function createBrowserView(ws, tabId, url = 'about:blank', { incognito = false } = {}) {
  const viewSession = incognito ? session.fromPartition('incognito') : session.defaultSession

  const view = new BrowserView({
    webPreferences: {
      session: viewSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableBlinkFeatures: '',
    },
  })

  if (incognito) {
    incognitoTabs.add(tabId)
    // Set up the incognito session if it hasn't been set up yet
    if (!viewSession._servesafeSetup) {
      setupSession(viewSession, { incognito: true })
      viewSession._servesafeSetup = true
    }
  }

  // ── Certificate error handler (proper warning, not silent ignore) ──
  view.webContents.on('certificate-error', (event, url, error, cert, callback) => {
    event.preventDefault()
    try {
      const hostname = new URL(url).hostname
      if (security.hasException(hostname)) { callback(true); return }
      const id = security.storeCertCallback(callback)
      sendToWindow(ws, 'cert-error', {
        id, tabId, url, error,
        certSubject: cert.subjectName || hostname,
      })
    } catch {
      callback(false)
    }
  })

  // ── Navigation events → renderer ──
  view.webContents.on('did-navigate', (_, navUrl) => {
    resetActivity()
    sendToWindow(ws, 'tab-navigated', { tabId, url: navUrl })
    ws.trackerStats.set(tabId, 0) // reset tracker count on full navigation
    ws.adStats.set(tabId, 0)      // reset ad count on full navigation
    view._cosmeticKey = null      // CSS cleared by navigation; allow re-inject on dom-ready
    if (tabId === ws.activeTabId) layoutBrowserView(ws, view)
    // Re-apply location on every full navigation — each cross-origin nav creates a
    // fresh renderer process that loses any previously set CDP override.
    const loc = store.get('location', null)
    if (loc && loc.id !== 'auto') applyLocationToView(view, loc)
  })
  // Cosmetic ad filtering — re-inject on each document load (insertCSS is per-document)
  view.webContents.on('dom-ready', () => applyCosmeticFilter(view))
  view.webContents.on('did-navigate-in-page', (_, navUrl) =>
    sendToWindow(ws, 'tab-navigated', { tabId, url: navUrl })
  )
  view.webContents.on('page-title-updated', (_, title) =>
    sendToWindow(ws, 'tab-title-updated', { tabId, title })
  )
  view.webContents.on('page-favicon-updated', (_, favicons) =>
    sendToWindow(ws, 'tab-favicon-updated', { tabId, favicon: favicons[0] || null })
  )
  view.webContents.on('did-start-loading', () =>
    sendToWindow(ws, 'tab-loading', { tabId, loading: true })
  )
  view.webContents.on('did-stop-loading', () => {
    sendToWindow(ws, 'tab-loading', { tabId, loading: false })
    sendToWindow(ws, 'tab-nav-state', {
      tabId,
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
    })
  })

  ws.browserViews.set(tabId, view)
  // Keyboard/mouse input inside the BrowserView resets the idle timer
  view.webContents.on('before-input-event', () => resetActivity())
  setupAntiFingerprint(view)  // inject fingerprint protection before first page load
  if (url && url !== 'about:blank') view.webContents.loadURL(sanitizeURL(url))

  setupContextMenu(ws, view, tabId)
  return view
}

// ─── Context menu for BrowserViews ────────────────────────────────────────────
function openInNewTab(ws, url, switchTo = true, incognito = false) {
  const newTabId = `tab_${Date.now()}`
  createBrowserView(ws, newTabId, url, { incognito })
  if (switchTo) showTab(ws, newTabId)
  sendToWindow(ws, 'tab-created', { tabId: newTabId, url, incognito, switchTo })
}

function setupContextMenu(ws, view, tabId) {
  view.webContents.on('context-menu', (_, params) => {
    const sections = []

    // Link actions
    if (params.linkURL) {
      sections.push([
        { label: 'Open Link in New Tab', click: () => openInNewTab(ws, params.linkURL, true, incognitoTabs.has(tabId)) },
        { label: 'Open Link in Background Tab', click: () => openInNewTab(ws, params.linkURL, false, incognitoTabs.has(tabId)) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      ])
    }

    // Image actions
    if (params.mediaType === 'image' && params.srcURL) {
      sections.push([
        { label: 'Open Image in New Tab', click: () => openInNewTab(ws, params.srcURL, true, incognitoTabs.has(tabId)) },
        { label: 'Save Image As…', click: () => view.webContents.downloadURL(params.srcURL) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
      ])
    }

    // Editable field actions
    if (params.isEditable) {
      sections.push([
        { label: 'Cut', enabled: params.editFlags.canCut, click: () => view.webContents.cut() },
        { label: 'Copy', enabled: params.editFlags.canCopy, click: () => view.webContents.copy() },
        { label: 'Paste', enabled: params.editFlags.canPaste, click: () => view.webContents.paste() },
        { label: 'Select All', enabled: params.editFlags.canSelectAll, click: () => view.webContents.selectAll() },
      ])
    } else if (params.selectionText.trim()) {
      // Text selection in read-only area
      const preview = params.selectionText.trim().slice(0, 40)
      const label = params.selectionText.trim().length > 40 ? `${preview}…` : preview
      sections.push([
        { label: 'Copy', click: () => view.webContents.copy() },
        {
          label: `Search for "${label}"`,
          click: () => openInNewTab(
            ws,
            `https://www.google.com/search?q=${encodeURIComponent(params.selectionText.trim())}`,
            true,
            incognitoTabs.has(tabId)
          ),
        },
      ])
    }

    // Navigation
    sections.push([
      { label: 'Back', enabled: view.webContents.canGoBack(), click: () => view.webContents.goBack() },
      { label: 'Forward', enabled: view.webContents.canGoForward(), click: () => view.webContents.goForward() },
      { label: 'Reload', click: () => view.webContents.reload() },
    ])

    // Page actions
    sections.push([
      { label: 'Save Page As…', click: () => view.webContents.downloadURL(params.pageURL) },
      { label: 'View Page Source', click: () => openInNewTab(ws, `view-source:${params.pageURL}`, true) },
    ])

    // Developer tools (dev only)
    if (isDev) {
      sections.push([
        { label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) },
      ])
    }

    const template = []
    sections.forEach(section => {
      if (!section.length) return
      if (template.length) template.push({ type: 'separator' })
      template.push(...section)
    })

    if (template.length) Menu.buildFromTemplate(template).popup({ window: ws.win })
  })
}

function sanitizeURL(input) {
  if (typeof input !== 'string') return 'about:blank'
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^localhost(:\d+)?(\/.*)?$/.test(trimmed)) return `http://${trimmed}`
  if (/^[\w-]+(\.[a-z]{2,})(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

function showTab(ws, tabId) {
  // Detach every view first — only one is ever in the window at a time.
  ws.browserViews.forEach(view => ws.win.removeBrowserView(view))
  ws.activeTabId = tabId
  const view = ws.browserViews.get(tabId)
  if (view) layoutBrowserView(ws, view)
}

// ─── History ───────────────────────────────────────────────────────────────────
function addHistory(url, title, tabId) {
  if (!isSafeUrl(url) || incognitoTabs.has(tabId)) return
  if (!historyBatch) historyBatch = store.get('history', [])
  const safeTitle = (typeof title === 'string' ? title : url).slice(0, MAX_TITLE_LENGTH)
  historyBatch.unshift({ url: url.slice(0, MAX_URL_LENGTH), title: safeTitle, visitedAt: Date.now() })
  clearTimeout(historyFlushTimer)
  historyFlushTimer = setTimeout(() => {
    store.set('history', historyBatch.slice(0, 5000))
    historyBatch = null
  }, 2000)
}

// ─── IPC: Tab management ───────────────────────────────────────────────────────
ipcMain.handle('tab-create', requireUnlocked((event, { url, background = false } = {}) => {
  const ws = getWS(event.sender)
  if (!ws) return
  const tabId = `tab_${Date.now()}`
  createBrowserView(ws, tabId, url)
  if (!background) showTab(ws, tabId)
  return tabId
}))

ipcMain.handle('tab-create-incognito', requireUnlocked((event, { url } = {}) => {
  const ws = getWS(event.sender)
  if (!ws) return
  const tabId = `tab_incognito_${Date.now()}`
  createBrowserView(ws, tabId, url, { incognito: true })
  showTab(ws, tabId)
  return tabId
}))

ipcMain.handle('tab-close', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  if (!ws) return
  const view = ws.browserViews.get(tabId)
  if (view) {
    ws.win.removeBrowserView(view)
    view.webContents.destroy()
    ws.browserViews.delete(tabId)
    incognitoTabs.delete(tabId)
    ws.trackerStats.delete(tabId)
    ws.adStats.delete(tabId)
  }
}))

ipcMain.handle('tab-switch', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  if (ws && ws.browserViews.has(tabId)) showTab(ws, tabId)
}))

ipcMain.handle('tab-navigate', requireUnlocked((event, { tabId, url }) => {
  const ws = getWS(event.sender)
  if (!ws) return
  const view = ws.browserViews.get(tabId)
  if (view) {
    const safe = sanitizeURL(url)
    // Attach view immediately (may currently be detached for about:blank) so the
    // blank→loading→content transition plays in the BrowserView, not as the React
    // new-tab page disappearing mid-flight.
    if (tabId === ws.activeTabId && !ws.overlayActive && !ws.win.getBrowserViews().includes(view)) {
      ws.win.addBrowserView(view)
      const [w, h] = ws.win.getContentSize()
      view.setBounds({ x: 0, y: ws.chromeHeight, width: w, height: Math.max(1, h - ws.chromeHeight) })
    }
    view.webContents.loadURL(safe)
    return safe
  }
}))

ipcMain.handle('tab-go-back', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  const view = ws?.browserViews.get(tabId)
  if (view && view.webContents.canGoBack()) view.webContents.goBack()
}))

ipcMain.handle('tab-go-forward', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  const view = ws?.browserViews.get(tabId)
  if (view && view.webContents.canGoForward()) view.webContents.goForward()
}))

ipcMain.handle('tab-reload', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  ws?.browserViews.get(tabId)?.webContents.reload()
}))

ipcMain.handle('tab-stop', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  ws?.browserViews.get(tabId)?.webContents.stop()
}))

ipcMain.handle('tab-get-url', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  const view = ws?.browserViews.get(tabId)
  return view ? view.webContents.getURL() : ''
}))

ipcMain.handle('tab-is-incognito', requireUnlocked((_, { tabId }) => incognitoTabs.has(tabId)))

// ─── IPC: History ──────────────────────────────────────────────────────────────
ipcMain.handle('history-get', requireUnlocked((_, { query } = {}) => {
  const all = store.get('history', [])
  if (!query) return all
  const q = query.toLowerCase()
  return all.filter(h => h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q))
}))

ipcMain.handle('history-add', requireUnlocked((_, { url, title, tabId }) => addHistory(url, title, tabId)))

ipcMain.handle('history-clear', requireUnlocked(() => store.set('history', [])))

ipcMain.handle('history-remove', requireUnlocked((_, { url }) => {
  store.set('history', store.get('history', []).filter(h => h.url !== url))
}))

ipcMain.on('renderer-navigated', (_, { url, title, tabId }) => addHistory(url, title, tabId))

// ─── IPC: Bookmarks ────────────────────────────────────────────────────────────
ipcMain.handle('bookmarks-get', requireUnlocked(() => store.get('bookmarks', [])))

ipcMain.handle('bookmarks-add', requireUnlocked((_, { url, title }) => {
  if (!isSafeUrl(url)) return store.get('bookmarks', [])
  const safeTitle = (typeof title === 'string' ? title : url).slice(0, MAX_TITLE_LENGTH)
  const bookmarks = store.get('bookmarks', [])
  if (!bookmarks.some(b => b.url === url)) {
    bookmarks.push({ url, title: safeTitle, addedAt: Date.now() })
    store.set('bookmarks', bookmarks)
  }
  return store.get('bookmarks', [])
}))

ipcMain.handle('bookmarks-remove', requireUnlocked((_, { url }) => {
  store.set('bookmarks', store.get('bookmarks', []).filter(b => b.url !== url))
  return store.get('bookmarks', [])
}))

// ─── IPC: Privacy ──────────────────────────────────────────────────────────────
ipcMain.handle('privacy-get', requireUnlocked(() => privacy.getSettings()))

ipcMain.handle('privacy-save', requireUnlocked((_, patch) => {
  // Only persist known setting keys — reject arbitrary renderer-supplied keys
  const ALLOWED_KEYS = ['doNotTrack', 'globalPrivacyControl', 'blockTrackers', 'blockAds', 'httpsOnly', 'blockThirdPartyCookies']
  const safePatch = {}
  for (const key of ALLOWED_KEYS) {
    if (key in patch && typeof patch[key] === 'boolean') safePatch[key] = patch[key]
  }
  const updated = privacy.saveSettings(safePatch)
  // Re-apply third-party cookie setting to default session
  applyThirdPartyCookies(session.defaultSession, updated.blockThirdPartyCookies)
  // Live-apply cosmetic ad filtering to every open view (no reload needed)
  if ('blockAds' in safePatch) {
    for (const ws of windowStates.values()) {
      for (const view of ws.browserViews.values()) {
        if (updated.blockAds) applyCosmeticFilter(view)
        else removeCosmeticFilter(view)
      }
    }
  }
  return updated
}))

ipcMain.handle('clear-data', requireUnlocked(async (_, { history: clrHistory, cookies: clrCookies, cache: clrCache } = {}) => {
  if (clrHistory) store.set('history', [])
  const sess = session.defaultSession
  if (clrCookies) await sess.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb'] })
  if (clrCache) await sess.clearCache()
}))

// ─── IPC: Security / Certificates ─────────────────────────────────────────────
ipcMain.handle('cert-response', requireUnlocked((_, { id, proceed }) => {
  security.resolveCertCallback(id, proceed)
}))

ipcMain.handle('cert-add-exception', requireUnlocked((_, { hostname }) => {
  // Validate hostname format to prevent garbage cert exceptions
  if (typeof hostname !== 'string' || hostname.length === 0 || hostname.length > 253) return
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(hostname)) return
  security.addException(hostname)
}))

// ─── IPC: Permissions ──────────────────────────────────────────────────────────
ipcMain.handle('permission-response', requireUnlocked((_, { id, allow, origin, permission }) => {
  if (!pendingPermissions.has(id)) return  // reject unknown or replayed request IDs
  pendingPermissions.get(id)(allow === true)  // always boolean to the Electron callback
  pendingPermissions.delete(id)
  // Use bracket notation — dot-prop would split origin dots as path segments, enabling
  // path-collision attacks where 'https://bank' + 'com.camera' == 'https://bank.com' + 'camera'.
  if (origin && typeof origin === 'string' && origin.length <= 256 &&
      permission && typeof permission === 'string' && permission.length <= 64) {
    const perms = store.get('permissions', {})
    if (!perms[origin]) perms[origin] = {}
    perms[origin][permission] = allow === true
    store.set('permissions', perms)
  }
}))

ipcMain.handle('permissions-get', requireUnlocked(() => store.get('permissions', {})))

ipcMain.handle('permissions-clear', requireUnlocked(() => store.delete('permissions')))

// ─── IPC: Downloads ────────────────────────────────────────────────────────────
ipcMain.handle('downloads-get', requireUnlocked(() => downloads))

ipcMain.handle('download-open', requireUnlocked((_, { savePath }) => {
  // Only open a path that matches a completed download recorded in this session
  if (typeof savePath === 'string' && downloads.some(d => d.savePath === savePath && d.state === 'completed')) {
    shell.openPath(savePath)
  }
}))

ipcMain.handle('download-show', requireUnlocked((_, { savePath }) => {
  if (typeof savePath === 'string' && downloads.some(d => d.savePath === savePath)) {
    shell.showItemInFolder(savePath)
  }
}))

// ─── IPC: Tracker stats ────────────────────────────────────────────────────────
ipcMain.handle('tracker-stats-get', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  return ws?.trackerStats.get(tabId) || 0
}))

// ─── IPC: Ad stats ─────────────────────────────────────────────────────────────
ipcMain.handle('ad-stats-get', requireUnlocked((event, { tabId }) => {
  const ws = getWS(event.sender)
  return ws?.adStats.get(tabId) || 0
}))

// ─── IPC: Session persistence ─────────────────────────────────────────────────
ipcMain.handle('session-get', requireUnlocked(() => store.get('lastSession', null)))
ipcMain.handle('session-clear', requireUnlocked(() => store.delete('lastSession')))

// ─── IPC: New-tab shortcuts ────────────────────────────────────────────────────
ipcMain.handle('shortcuts-get', requireUnlocked(() =>
  store.get('shortcuts', DEFAULT_SHORTCUTS)
))

ipcMain.handle('shortcuts-set', requireUnlocked((_, shortcuts) => {
  if (!Array.isArray(shortcuts)) return store.get('shortcuts', DEFAULT_SHORTCUTS)
  const safe = shortcuts
    .filter(s => s && typeof s === 'object' && isSafeUrl(s.url))
    .slice(0, 20)
    .map(s => ({
      id:    String(s.id    || Date.now()).slice(0, 32),
      label: String(s.label || '').slice(0, 64),
      icon:  String(s.icon  || '🔗').slice(0, 8),
      url:   String(s.url).slice(0, MAX_URL_LENGTH),
    }))
  store.set('shortcuts', safe)
  return safe
}))

// ─── IPC: Overlay (hide BrowserView so React panels render over it) ────────────
ipcMain.handle('overlay-open', requireUnlocked((event) => {
  const ws = getWS(event.sender)
  if (!ws) return
  ws.overlayActive = true
  if (ws.activeTabId && ws.browserViews.has(ws.activeTabId)) {
    ws.win.removeBrowserView(ws.browserViews.get(ws.activeTabId))
  }
}))

ipcMain.handle('overlay-close', requireUnlocked((event) => {
  const ws = getWS(event.sender)
  if (!ws) return
  ws.overlayActive = false
  if (ws.activeTabId && ws.browserViews.has(ws.activeTabId)) {
    layoutBrowserView(ws, ws.browserViews.get(ws.activeTabId))
  }
}))

// ─── IPC: Chrome height (renderer → main so BrowserView is positioned correctly) ──
ipcMain.on('set-chrome-height', (event, cssHeight) => {
  if (typeof cssHeight !== 'number' || cssHeight <= 0 || cssHeight > 300) return
  const ws = getWS(event.sender)
  if (!ws) return
  ws.chromeHeight = Math.ceil(cssHeight)
  // Debounce layout updates — rapid calls (e.g. from ResizeObserver) would otherwise
  // trigger setBounds while Blink is still processing the previous layout, causing
  // "Message rejected by blink.mojom.WidgetHost" IPC errors.
  clearTimeout(ws.chromeHeightTimer)
  ws.chromeHeightTimer = setTimeout(() => {
    if (ws.activeTabId && ws.browserViews.has(ws.activeTabId)) {
      layoutBrowserView(ws, ws.browserViews.get(ws.activeTabId))
    }
  }, 50)
})

// ─── Geolocation override via Chrome DevTools Protocol ────────────────────────
async function applyLocationToView(view, loc) {
  if (!view || view.webContents.isDestroyed()) return
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3')
    }
    if (!loc || loc.id === 'auto') {
      await view.webContents.debugger.sendCommand('Emulation.clearGeolocationOverride')
    } else {
      await view.webContents.debugger.sendCommand('Emulation.setGeolocationOverride', {
        latitude: loc.lat,
        longitude: loc.lng,
        accuracy: 100,
      })
    }
  } catch (err) {
    // DevTools may already be attached or view may not support it — non-fatal
  }
}

// ─── Cosmetic ad filtering ───────────────────────────────────────────────────
// Hides leftover ad containers whose network requests were already blocked, so
// pages don't show empty gaps or collapsed placeholders. CSS is injected per
// document (cleared on navigation) and tracked by key so it can be removed live
// when the user disables ad blocking without requiring a reload.
async function applyCosmeticFilter(view) {
  if (!view || view.webContents.isDestroyed()) return
  if (!privacy.getSettings().blockAds) { await removeCosmeticFilter(view); return }
  if (view._cosmeticKey) return // already applied to current document
  // Per-site element-hiding rules + scriptlets from the ads filter engine
  // (falls back to the static selector CSS until the engine has loaded).
  const { styles, scripts } = filterEngine.getCosmetics(view.webContents.getURL())
  try {
    if (styles) view._cosmeticKey = await view.webContents.insertCSS(styles)
  } catch { /* document may have navigated away mid-insert */ }
  // Scriptlets (anti-adblock defusing, element removal, etc.) — injected once per
  // document. Best-effort: page CSP or a mid-flight navigation may reject them.
  if (scripts.length) {
    try { await view.webContents.executeJavaScript(scripts.join('\n'), true) } catch {}
  }
}

async function removeCosmeticFilter(view) {
  if (!view || view.webContents.isDestroyed() || !view._cosmeticKey) return
  try {
    await view.webContents.removeInsertedCSS(view._cosmeticKey)
  } catch { /* key already invalidated by navigation */ }
  view._cosmeticKey = null
}


// Registers a script that runs at document-start in every page context, before
// any page JS. Survives cross-origin navigations because the registration lives
// on the webContents (not the renderer process).
async function setupAntiFingerprint(view) {
  if (!view || view.webContents.isDestroyed()) return
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3')
    }
    await view.webContents.debugger.sendCommand(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: antiFingerprintScript }
    )
  } catch (_) {
    // Non-fatal — view may not support DevTools (e.g. sandboxed subframes)
  }
}

// ─── IPC: Location ─────────────────────────────────────────────────────────────
ipcMain.handle('location-get', requireUnlocked(() => store.get('location', null)))

ipcMain.handle('location-set', requireUnlocked(async (_, loc) => {
  // Validate before storing — CDP rejects invalid values and we don't want garbage in the store
  if (loc !== null && loc !== undefined) {
    if (typeof loc !== 'object' || Array.isArray(loc)) return null
    if (typeof loc.lat !== 'number' || !Number.isFinite(loc.lat) || loc.lat < -90  || loc.lat > 90)  return null
    if (typeof loc.lng !== 'number' || !Number.isFinite(loc.lng) || loc.lng < -180 || loc.lng > 180) return null
  }
  const safeLoc = loc
    ? { id: String(loc.id || 'custom').slice(0, 64), lat: loc.lat, lng: loc.lng, label: String(loc.label || '').slice(0, 128) }
    : null
  store.set('location', safeLoc)
  for (const ws of windowStates.values()) {
    for (const view of ws.browserViews.values()) {
      await applyLocationToView(view, safeLoc)
    }
  }
  return safeLoc
}))
ipcMain.handle('get-theme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))

// ─── Third-party cookie helper ─────────────────────────────────────────────────
function applyThirdPartyCookies(sess, block) {
  // Electron doesn't have a direct API for 3P cookies; approximate via cookie filter
  // The cleanest cross-version approach: set a cookie policy on the session
  try {
    if (block) {
      sess.cookies.on('changed', () => {}) // placeholder; real enforcement needs Chromium flags
    }
  } catch {}
}

// ─── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => sendToRenderer('menu-new-tab', {}) },
        { label: 'New Incognito Tab', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendToRenderer('menu-new-incognito', {}) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendToRenderer('menu-close-tab', {}) },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => sendToRenderer('menu-reload', {}) },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendToRenderer('menu-force-reload', {}) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => {
          const focusedWin = BrowserWindow.getFocusedWindow()
          const ws = focusedWin ? windowStates.get(focusedWin.id) : null
          if (ws) ws.browserViews.get(ws.activeTabId)?.webContents.toggleDevTools()
        }},
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── App lock: data wipe ───────────────────────────────────────────────────────
async function nukeAllData() {
  // Wipe all electron-store data: history, bookmarks, settings, permissions, session, etc.
  store.clear()

  // Delete the encryption key file — next launch generates a fresh key so the wiped
  // store ciphertext is permanently unrecoverable even if the bytes are recovered.
  storeKey.deleteKey()

  // Wipe Chromium session data: cookies, localStorage, IndexedDB, service workers, cache
  const storages = [
    'appcache', 'cookies', 'filesystem', 'indexdb',
    'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage',
  ]
  const sessionsToClear = [session.defaultSession]
  try { sessionsToClear.push(session.fromPartition('incognito')) } catch {}

  for (const sess of sessionsToClear) {
    try { await sess.clearStorageData({ storages }) } catch {}
    try { await sess.clearCache() } catch {}
    try { await sess.clearAuthCache() } catch {}
    try { await sess.clearHostResolverCache() } catch {}
  }
}

// ─── App lock: system authentication ──────────────────────────────────────────
// Uses macOS LocalAuthentication (Touch ID → system password fallback).
// Tracks failed attempts persistently; wipes all data after 3 failures.
const MAX_AUTH_ATTEMPTS = 3

ipcMain.handle('app-auth', async (_, { reason } = {}) => {
  if (process.platform !== 'darwin') {
    store.delete('failedAuthAttempts')
    isAppLocked = false
    resetActivity()
    return { success: true, attemptsLeft: MAX_AUTH_ATTEMPTS }
  }

  let failed = store.get('failedAuthAttempts', 0)

  try {
    await systemPreferences.promptTouchID('unlock ServeSafe Browser')
    store.delete('failedAuthAttempts')
    isAppLocked = false
    resetActivity()
    return { success: true, attemptsLeft: MAX_AUTH_ATTEMPTS }
  } catch (err) {
    failed += 1
    const attemptsLeft = MAX_AUTH_ATTEMPTS - failed

    if (attemptsLeft <= 0) {
      await nukeAllData()
      // Force quit after 5 s as a fallback if renderer doesn't call app-quit
      setTimeout(() => app.quit(), 5000)
      return { success: false, wiped: true, attemptsLeft: 0 }
    }

    store.set('failedAuthAttempts', failed)
    return { success: false, attemptsLeft, error: err.message }
  }
})

ipcMain.handle('app-auth-state', () => ({
  attemptsLeft: Math.max(0, MAX_AUTH_ATTEMPTS - store.get('failedAuthAttempts', 0)),
  appLockEnabled: store.get('appLockEnabled', true),
  isLocked: isAppLocked,
}))

ipcMain.handle('app-lock-enabled-get', () => store.get('appLockEnabled', true))

ipcMain.handle('app-lock-enabled-set', (_, enabled) => {
  if (typeof enabled !== 'boolean') return
  store.set('appLockEnabled', enabled)
  if (!enabled) {
    // Disabling lock — immediately unlock and clear failed-attempt counter
    isAppLocked = false
    store.delete('failedAuthAttempts')
  }
  return enabled
})

ipcMain.handle('app-quit', () => app.quit())

// Activity ping from renderer (throttled at source) — resets the idle timer
ipcMain.on('activity-ping', () => resetActivity())

// ─── Auto-lock timeout setting ─────────────────────────────────────────────────
const VALID_AUTOLOCK_MINUTES = [0, 1, 5, 10, 15, 30]  // 0 = disabled

ipcMain.handle('autolock-get', () => store.get('autoLockMinutes', 5))

ipcMain.handle('autolock-set', (_, minutes) => {
  const m = VALID_AUTOLOCK_MINUTES.includes(minutes) ? minutes : 5
  store.set('autoLockMinutes', m)
  return m
})

const SUPPORTED_LANGUAGES = new Set(['en','ar','de','es','fr','hi','ja','ko','pt','zh'])

ipcMain.handle('language-get', () => store.get('language', 'en'))

ipcMain.handle('language-set', (_, lang) => {
  if (typeof lang !== 'string' || !SUPPORTED_LANGUAGES.has(lang)) return store.get('language', 'en')
  store.set('language', lang)
  return lang
})

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize the encrypted store FIRST — everything else reads from it
  await storeKey.init()
  store = storeKey.getStore()

  // Respect the user's app-lock preference — default enabled
  isAppLocked = store.get('appLockEnabled', true)

  // Start idle auto-lock timer (checks every 30 s; skips when already locked)
  idleCheckTimer = setInterval(() => {
    if (isAppLocked) return
    if (!store.get('appLockEnabled', true)) return  // lock feature disabled
    const minutes = store.get('autoLockMinutes', 5)
    if (minutes === 0) return  // 0 = disabled
    if (Date.now() - lastActivity >= minutes * 60_000) {
      isAppLocked = true
      // Hide active BrowserView in every window so the lock screen is visible.
      for (const ws of windowStates.values()) {
        ws.overlayActive = true
        if (ws.activeTabId && ws.browserViews.has(ws.activeTabId)) {
          ws.win.removeBrowserView(ws.browserViews.get(ws.activeTabId))
        }
        sendToWindow(ws, 'lock-app', {})
      }
    }
  }, 30_000)

  // Set up default session once
  setupSession(session.defaultSession)

  // Load the ad/tracker filter engines (cache-first; builds in the background).
  // Non-blocking: request filtering falls back to the static lists until ready.
  filterEngine.init()

  // Apply initial third-party cookie setting
  const settings = privacy.getSettings()
  applyThirdPartyCookies(session.defaultSession, settings.blockThirdPartyCookies)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  clearInterval(idleCheckTimer)
  if (process.platform !== 'darwin') app.quit()
})
