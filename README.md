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
A content script is injected into every page via Chrome DevTools Protocol (`Page.addScriptToEvaluateOnNewDocument`) before any page JavaScript runs, including across cross-origin navigations. *Toggleable from the Privacy panel (default on).*

**Per-session, per-site identity (the "farbling" model).** All randomisation derives from a single seed, `cyrb53(sessionKey + '|' + registrableDomain)`, where `sessionKey` is random per app launch and kept in memory only. The result:

- **Stable within a site for the session** — reading the same canvas or audio buffer twice returns identical bytes, so tamper-detection scripts see nothing suspicious.
- **Different on every other site**, and **reset on every restart** — so the fingerprint can't be correlated across sites or sessions.

Protections applied per page:

| Vector | Mitigation |
|---|---|
| Canvas fingerprint | Seeded ±1 LSB noise on `getImageData`, `toDataURL`, and `toBlob` (rendered via an offscreen clone, so the visible canvas is never corrupted; covers WebGL-backed canvases too) |
| AudioContext fingerprint | Seeded sub-threshold noise across all samples of `getChannelData` / `copyFromChannel` (applied once per buffer so it never accumulates) and every `AnalyserNode` readout |
| WebGL renderer/vendor | Replaced with a plausible GPU from a coherent profile pool (ANGLE/D3D11, Apple Metal, …) chosen by the per-site seed; `readPixels` output is seed-noised |
| User-Agent | Rotated per site, per session from a pool of real current Chrome profiles — also hides the Electron/ServeSafe identifiers |
| `navigator.platform` / `userAgentData` | Overridden to stay consistent with the chosen User-Agent profile |
| `navigator.hardwareConcurrency` | Locked to `4` |
| `navigator.deviceMemory` | Locked to `8` |
| `navigator.getBattery` | Removed |
| Network connection API | Normalised to 4G / 100ms RTT / 10 Mbps |
| `window.name` | Write-locked to `''` |
| Media device IDs | `enumerateDevices` returns empty `deviceId` / `groupId` |
| Keyboard layout | `getLayoutMap` returns an empty Map |

The seed, profile pool, and User-Agent selection live in `electron/fingerprint.js` and are mirrored byte-for-byte in the injected `electron/antiFingerprint.js`, so the UA header set by the main process always agrees with the platform/GPU the page sees.

---

### Encrypted DNS (DNS-over-HTTPS)
DNS resolution is routed entirely over HTTPS using Chromium's host resolver (`app.configureHostResolver`) in `secure` mode — **every** lookup goes to a DoH resolver (Cloudflare primary, Google fallback) and there is **no fallback to plaintext system DNS**, so queries can't be observed or tampered with on the local network. *Toggleable from the Privacy panel (default on);* turning it off reverts to plain system DNS. The host-resolver cache is flushed on every change so the new mode takes effect immediately.

---

### Zero Telemetry & Data Minimization
ServeSafe never starts the crash reporter and ships no auto-updater, so Electron itself uploads nothing. On top of that, Chromium's own background "phone-home" subsystems are disabled at process start — the LibreWolf / Waterfox model:

- `disable-background-networking` (variations/field-trial fetches, captive-portal probes, GCM), `disable-component-update`, `disable-domain-reliability`, `disable-breakpad`, `no-pings` (hyperlink auditing), `disable-sync`, `disable-field-trial-config`
- Feature kills for services that call Google directly: Optimization Hints, Autofill server communication, Media Router / Cast discovery, Translate, Segmentation Platform, Privacy Sandbox / Topics
- Google API keys neutralised via environment variables

These are a permanent hardening baseline (command-line switches are read before the app is ready, so they're not a runtime toggle).

---

### Bounce Tracking & Redirect Protection
Defeats "redirect tracking", where a tracker domain briefly becomes the top-level page to read/write its own first-party cookies before forwarding you on. *Toggleable from the Privacy panel (default on).* Two complementary defences (`electron/bounceTracker.js`):

- **Debouncing** — when a top-level navigation targets a known redirector carrying its real destination in a query parameter (`google.com/url?q=`, `l.facebook.com/l.php?u=`, SafeLinks, Reddit, LinkedIn, `href.li`, …, plus a generic `?url=` extraction for any tracker host), the request is redirected straight to the destination at the network layer — the tracker domain is **never contacted**.
- **Storage purge** (Firefox's Bounce Tracking Protection model) — when a navigation is routed *through* a tracker host (a server-redirect hop or a quick JS redirect) with no user interaction, that host's cookies and site storage are wiped so it can't keep a cross-site identifier.

---

### Global Privacy Control & Do Not Track
The standardized opt-out signals are asserted two ways so sites honour them whether they check the request or the DOM:

- **Request headers** — `Sec-GPC: 1` and `DNT: 1` are added to every outgoing request (see *Request Header Privacy*).
- **DOM properties** — `navigator.globalPrivacyControl` and `navigator.doNotTrack` are injected at document-start to match, since Chromium doesn't expose `globalPrivacyControl` natively and many consent-management platforms read it via JavaScript.

Both are driven by the existing *Do Not Track* and *Global Privacy Control* toggles; toggling reloads open tabs so the DOM values update.

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

### Fine-Grained Permission Controls
Camera, microphone, geolocation, notification, clipboard, and MIDI requests are shown in an in-app toast rather than a native OS prompt. Each sensitive API has granular, site-specific control:

- **Per-site overrides** — every site's decision can be set to **Allow** or **Block**, or reset back to **Ask**, from the Privacy panel.
- **Global per-type defaults** — set a default policy (Ask / Allow / Block) for each permission type that applies to any site without an explicit choice (e.g. "always block notifications").
- **Camera / microphone split** — Electron's combined `media` request is split into independent Camera and Microphone permissions; a `getUserMedia` asking for both is granted only if both are allowed.
- **Resolution order** — a per-site override wins, otherwise the global default; `Ask` prompts and remembers the answer.

Decisions are stored with full-origin keys using bracket notation. Dot-separated origins (e.g. `https://example.com`) are stored as a single key, preventing path-collision attacks where a crafted origin could overwrite unrelated permission entries. The origin and permission type bound to a prompt are tracked in the main process and never trusted from the renderer's echoed values, so a compromised renderer can't answer a prompt for one origin while silently saving a grant for another.

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
  main.js             — main process: window, tabs, IPC, session, request filtering,
                        DoH, telemetry hardening, permissions, bounce protection
  preload.js          — context bridge (exposes typed API to renderer)
  storeKey.js         — encrypted store: key management, HMAC binding, migration
  privacy.js          — privacy settings read/write
  trackerData.js      — tracker domain list and URL pattern matching (sync, no deps)
  fingerprint.js      — per-session/per-site identity model: seed, UA profile pool,
                        and the injected content-script builder
  antiFingerprint.js  — CDP-injected content script (runs before page JS)
  bounceTracker.js    — redirect debouncing + bounce-tracker storage purge
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
