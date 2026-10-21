# ServeSafe Browser

A privacy-first desktop browser built with Electron 44, React 19, and Vite 8. Every feature is designed around one principle: what you do stays on your machine.

---

## Features

### App Lock
The browser requires system authentication before the UI is shown. On macOS this uses Touch ID with an automatic fallback to your login password (via `LAPolicy.deviceOwnerAuthentication`). The browser window never renders until authentication succeeds.

- **3-strike wipe** — three consecutive failed authentication attempts permanently erase all stored data: history, bookmarks, cookies, cache, IndexedDB, service workers, and the encryption key. The app then quits automatically.
- **Persistent attempt counter** — failed attempts are tracked across restarts so the 3-strike limit cannot be reset by relaunching.
- **Idle auto-lock** — the browser locks itself after a configurable period of inactivity. Options: Never, 1, 5, 10, 15, or 30 minutes. Configurable from the Privacy panel. Both React chrome events and BrowserView input events reset the idle timer independently.

---

### Encrypted Storage
All locally stored data — history, bookmarks, privacy settings, permissions, session state — is written to a single AES-256-GCM encrypted file (`servesafe.json`).

The encryption key is:
- Generated once as 32 cryptographically random bytes
- Protected by the OS credential store (`safeStorage`): macOS Keychain, Windows DPAPI, or Linux Secret Service
- Stored in `.sskey` at `0o600` permissions (owner-only)
- **App-bound via HMAC** — a second derivation step (`HMAC-SHA256(rawKey, APP_SALT + '\0' + userData)`) means another application that reads the same Keychain entry cannot reconstruct the store key
- **Key format versioning** — `.sskey` content is prefixed with `ss2:`. Files without this prefix are v1 (old format); detection triggers automatic key rotation and a fresh store

On Linux systems without a keyring daemon, a random key is stored in `.sskeyf` at `0o600` and HMAC-bound to `/etc/machine-id`, making the file non-transferable to another machine.

**Migration security** — when upgrading from an unencrypted `config.json`, only known-safe keys are copied (`history`, `bookmarks`, `privacySettings`, `permissions`, `location`, `lastSession`, `autoLockMinutes`). Arbitrary keys in a pre-positioned config file are silently dropped.

When a data wipe occurs, both key files are deleted. The ciphertext on disk becomes permanently unreadable even if recovered forensically.

---

### Anti-Fingerprinting
A content script is injected into every page via Chrome DevTools Protocol (`Page.addScriptToEvaluateOnNewDocument`) before any page JavaScript runs, including across cross-origin navigations.

Protections applied per page:

| Vector | Mitigation |
|---|---|
| Canvas fingerprint | ±1 LSB noise added to `toDataURL` / `toBlob` output, randomised per page load |
| AudioContext fingerprint | Sub-threshold noise (`±5e-8`) added to `AudioBuffer.getChannelData` |
| WebGL renderer/vendor | Replaced with generic Intel strings via prototype intercept |
| WebGL patch detectability | WeakSet used internally — the patch is invisible to page scripts |
| `navigator.hardwareConcurrency` | Locked to `4` |
| `navigator.deviceMemory` | Locked to `8` |
| `navigator.getBattery` | Removed |
| Network connection API | Normalised to 4G / 100ms RTT / 10 Mbps |
| `window.name` | Write-locked to `''` |
| Media device IDs | `enumerateDevices` returns empty `deviceId` / `groupId` |
| Keyboard layout | `getLayoutMap` returns an empty Map |

---

### Tracker & Request Blocking
All network requests are evaluated synchronously in the main process before they leave the app. Blocking is performed inline on the `onBeforeRequest` event — all lookups are in-memory Set / array operations that complete in microseconds.

- **Domain blocklist** — 150+ known tracker, ad, and analytics domains (Google Analytics, Facebook Pixel, Microsoft Clarity, TikTok Pixel, DoubleVerify, fingerprint.com, LiveRamp, and many more)
- **URL pattern matching** — blocks tracker endpoints by path pattern (`/gtm.js`, `/clarity.js`, `/pixel.gif`, `/beacon.php`, etc.) regardless of domain
- **Per-tab counter** — each tab tracks how many requests were blocked; the count is shown live in the Privacy panel and address bar badge

---

### Request Header Privacy
Applied to every outgoing request via `onBeforeSendHeaders`:

| Header action | What it prevents |
|---|---|
| Strips all 15 Client Hints headers (`Sec-CH-UA-*`, `Sec-CH-DPR`, etc.) | OS, CPU architecture, and browser version exposure |
| Normalises `Accept-Language` to `en-US,en;q=0.9` | Locale-based fingerprinting |
| Removes `X-Client-Data` | Google's proprietary Chrome telemetry header |
| Strips cross-origin `Referer` | Source-page tracking across sites |
| Blocks cross-origin `Cookie` header | Third-party cookie tracking on sub-resource requests |
| Blocks cross-origin `Set-Cookie` response header | Supercookie / tracking pixel persistence |
| Adds `DNT: 1` (when enabled) | Do Not Track signal |
| Adds `Sec-GPC: 1` (when enabled) | Global Privacy Control signal |

---

### Content Security Policy
A strict CSP is injected on every response to the main renderer window via `onHeadersReceived`. The policy is scoped exclusively to the renderer; BrowserView web content is not affected.

- **Production** — `script-src 'self'`, `connect-src 'none'`, no eval
- **Development** — loosened to allow Vite HMR WebSocket, `unsafe-eval`, and `unsafe-inline` (required by `@vitejs/plugin-react` preamble)

---

### IPC Security
Every sensitive IPC handler is wrapped with `requireUnlocked` — a guard that throws before executing if the app is in the locked state. This means a compromised renderer cannot access history, bookmarks, permissions, downloads, or any stored data while the lock screen is active.

Input validation is applied at all IPC boundaries:
- URLs are validated for `http:`/`https:` scheme and capped at 2 048 characters before being stored in history or bookmarks
- Geolocation coordinates are validated for type, finiteness, and range (lat ±90, lng ±180)
- Certificate exception hostnames are validated against a strict hostname regex
- Privacy settings only accept a fixed allowlist of known keys with boolean values
- Download open/show actions only work on paths recorded in the in-process downloads array

---

### WebRTC IP Leak Prevention
Chromium's WebRTC stack is configured at startup to only use the default public network interface:

```
webrtc-ip-handling-policy = default_public_interface_only
```

This prevents WebRTC from leaking your local LAN IP address to websites even when no VPN is in use.

---

### HTTPS-Only Mode
When enabled, all `http://` requests (except `localhost`) are cancelled before they leave the app. A notification bar explains the block and shows the original URL.

---

### Incognito Tabs
Incognito tabs run in an isolated Chromium session partition. No history is written, and no cookies or site data persist after the tab is closed. The new-tab page and tab strip both indicate incognito status visually.

---

### Permission Management
Camera, microphone, geolocation, and notification requests are shown in an in-app toast rather than a native OS prompt. Decisions can be saved per origin. All saved decisions are viewable and clearable from the Privacy panel.

Permissions are stored with full-origin keys using bracket notation. Dot-separated origins (e.g. `https://example.com`) are stored as a single key, preventing path-collision attacks where a crafted origin could overwrite unrelated permission entries.

---

### Session Restore
Open (non-incognito) tabs are saved on close and restored on the next launch, including scroll-to-active-tab behaviour. The saved session is cleared immediately after restore so a crash during restore does not cause a loop.

---

### Certificate Error Handling
TLS certificate errors are intercepted and shown as a full-page warning inside the browser chrome rather than silently accepted or rejected. Users can inspect the certificate subject, go back, or add a per-hostname exception. Tabs with active certificate errors are marked in the tab bar.

---

### Download Manager
An in-app download bar tracks active and completed downloads with progress, file size, and save path. Downloads can be opened in place or revealed in Finder / Explorer without leaving the browser.

---

### Location Spoofing
The browser can override the geolocation reported to websites via Chrome DevTools Protocol (`Emulation.setGeolocationOverride`). A preset list of cities is provided; the override is re-applied on every cross-origin navigation so it survives page transitions.

---

## Architecture

```
electron/
  main.js             — main process: window, tabs, IPC, session, request filtering
  preload.js          — context bridge (exposes typed API to renderer)
  storeKey.js         — encrypted store: key management, HMAC binding, migration
  privacy.js          — privacy settings read/write
  trackerData.js      — tracker domain list and URL pattern matching (sync, no deps)
  antiFingerprint.js  — CDP-injected content script (runs before page JS)
  security.js         — certificate exception store

src/
  App.jsx             — lock gate + BrowserApp root + idle activity tracking
  components/
    Browser.jsx       — TabBar, AddressBar, HistoryPanel, BookmarksPanel, NewTabPage
    LockScreen.jsx    — system auth UI
    CertWarning.jsx   — TLS error overlay
    PermissionToast.jsx
    DownloadBar.jsx
    PrivacyPanel.jsx  — privacy toggles + auto-lock timeout selector
    LocationPanel.jsx
```

---

## Development

```bash
npm install
npm run dev      # starts Vite dev server + Electron
npm run build    # production build via electron-builder
```

Requires Node.js 20+ and Electron 44. On macOS, the app lock uses `systemPreferences.promptTouchID` which requires macOS 10.15 or later.

> **Note:** In development (unsigned build), the app lock bypasses authentication on non-macOS platforms. On macOS, Touch ID / password authentication is fully active during development.
