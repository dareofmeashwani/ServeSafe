const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED_EVENTS = [
  'tab-navigated', 'tab-title-updated', 'tab-favicon-updated',
  'tab-loading', 'tab-nav-state',
  'tab-created',
  'menu-new-tab', 'menu-close-tab', 'menu-reload', 'menu-force-reload',
  'menu-new-incognito',
  // Security / privacy
  'cert-error', 'permission-request',
  'https-only-blocked', 'tracker-blocked', 'ad-blocked',
  // Downloads
  'download-started', 'download-updated', 'download-done',
  // App lock
  'lock-app',
]

contextBridge.exposeInMainWorld('browser', {
  // ── Tabs ──────────────────────────────────────────────────────────────────
  createTab: (url, opts = {}) => ipcRenderer.invoke('tab-create', { url, ...opts }),
  createIncognitoTab: (url) => ipcRenderer.invoke('tab-create-incognito', { url }),
  closeTab: (tabId) => ipcRenderer.invoke('tab-close', { tabId }),
  switchTab: (tabId) => ipcRenderer.invoke('tab-switch', { tabId }),
  navigate: (tabId, url) => ipcRenderer.invoke('tab-navigate', { tabId, url }),
  goBack: (tabId) => ipcRenderer.invoke('tab-go-back', { tabId }),
  goForward: (tabId) => ipcRenderer.invoke('tab-go-forward', { tabId }),
  reload: (tabId) => ipcRenderer.invoke('tab-reload', { tabId }),
  stop: (tabId) => ipcRenderer.invoke('tab-stop', { tabId }),
  getURL: (tabId) => ipcRenderer.invoke('tab-get-url', { tabId }),
  isIncognito: (tabId) => ipcRenderer.invoke('tab-is-incognito', { tabId }),

  // ── History ───────────────────────────────────────────────────────────────
  getHistory: (query) => ipcRenderer.invoke('history-get', { query }),
  addHistory: (url, title, tabId) => ipcRenderer.invoke('history-add', { url, title, tabId }),
  clearHistory: () => ipcRenderer.invoke('history-clear'),
  removeHistory: (url) => ipcRenderer.invoke('history-remove', { url }),
  notifyNavigated: (url, title, tabId) => ipcRenderer.send('renderer-navigated', { url, title, tabId }),

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  getBookmarks: () => ipcRenderer.invoke('bookmarks-get'),
  addBookmark: (url, title) => ipcRenderer.invoke('bookmarks-add', { url, title }),
  removeBookmark: (url) => ipcRenderer.invoke('bookmarks-remove', { url }),

  // ── Privacy ───────────────────────────────────────────────────────────────
  getPrivacySettings: () => ipcRenderer.invoke('privacy-get'),
  savePrivacySettings: (patch) => ipcRenderer.invoke('privacy-save', patch),
  clearData: (flags) => ipcRenderer.invoke('clear-data', flags),

  // ── Security ─────────────────────────────────────────────────────────────
  respondToCert: (id, proceed) => ipcRenderer.invoke('cert-response', { id, proceed }),
  addCertException: (hostname) => ipcRenderer.invoke('cert-add-exception', { hostname }),
  respondToPermission: (id, allow, origin, permission) =>
    ipcRenderer.invoke('permission-response', { id, allow, origin, permission }),
  getPermissions: () => ipcRenderer.invoke('permissions-get'),
  clearPermissions: () => ipcRenderer.invoke('permissions-clear'),

  // ── Downloads ────────────────────────────────────────────────────────────
  getDownloads: () => ipcRenderer.invoke('downloads-get'),
  openDownload: (savePath) => ipcRenderer.invoke('download-open', { savePath }),
  showDownload: (savePath) => ipcRenderer.invoke('download-show', { savePath }),

  // ── Tracker stats ─────────────────────────────────────────────────────────
  getTrackerStats: (tabId) => ipcRenderer.invoke('tracker-stats-get', { tabId }),

  // ── Ad stats ──────────────────────────────────────────────────────────────
  getAdStats: (tabId) => ipcRenderer.invoke('ad-stats-get', { tabId }),

  // ── Chrome height reporting (renderer → main for correct BrowserView layout) ──
  setChromeHeight: (cssHeight) => ipcRenderer.send('set-chrome-height', cssHeight),

  // ── Location spoofing ─────────────────────────────────────────────────────
  getLocation: () => ipcRenderer.invoke('location-get'),
  setLocation: (loc) => ipcRenderer.invoke('location-set', loc),

  // ── Session persistence ───────────────────────────────────────────────────────
  getLastSession: () => ipcRenderer.invoke('session-get'),
  clearLastSession: () => ipcRenderer.invoke('session-clear'),

  // ── New-tab shortcuts ──────────────────────────────────────────────────────
  getShortcuts: () => ipcRenderer.invoke('shortcuts-get'),
  setShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts-set', shortcuts),

  // ── App lock ──────────────────────────────────────────────────────────────────
  authenticateSystem: (reason) => ipcRenderer.invoke('app-auth', { reason }),
  getAuthState: () => ipcRenderer.invoke('app-auth-state'),
  quitApp: () => ipcRenderer.invoke('app-quit'),
  // Fire-and-forget ping so the main-process idle timer knows the user is active
  activityPing: () => ipcRenderer.send('activity-ping'),
  getAutoLockMinutes: () => ipcRenderer.invoke('autolock-get'),
  setAutoLockMinutes: (minutes) => ipcRenderer.invoke('autolock-set', minutes),
  getAppLockEnabled: () => ipcRenderer.invoke('app-lock-enabled-get'),
  setAppLockEnabled: (enabled) => ipcRenderer.invoke('app-lock-enabled-set', enabled),

  // ── Language ──────────────────────────────────────────────────────────────────
  getLanguage: () => ipcRenderer.invoke('language-get'),
  setLanguage: (lang) => ipcRenderer.invoke('language-set', lang),

  // ── Theme ─────────────────────────────────────────────────────────────────
  getTheme: () => ipcRenderer.invoke('get-theme'),

  // ── Overlay (hide/restore BrowserView so React panels appear on top) ──────
  overlayOpen: () => ipcRenderer.invoke('overlay-open'),
  overlayClose: () => ipcRenderer.invoke('overlay-close'),

  // ── Event subscription ────────────────────────────────────────────────────
  on: (channel, fn) => {
    if (!ALLOWED_EVENTS.includes(channel)) return
    const wrapped = (_, ...args) => fn(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
})
