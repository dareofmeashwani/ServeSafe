// Fingerprint identity model (main-process side).
//
// Produces a per-SESSION, per-SITE identity so the browser is both untrackable
// (fingerprint differs on every site and resets every launch) and undetectable
// (within one site, repeated reads are byte-identical — nothing looks "noised").
//
//   seed = cyrb53(SESSION_KEY + '|' + registrableDomain(host))
//
// SESSION_KEY is random per app launch and kept in memory only (never persisted),
// so the whole identity rotates on every restart. The SAME cyrb53 + registrable-
// domain + PROFILES array is duplicated verbatim in the injected content script
// (antiFingerprint.js) so the User-Agent chosen here always matches the platform /
// GPU / userAgentData the page sees. PROFILES itself lives ONLY here and is
// injected into the client script as JSON, so the drift-prone data has one home.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Random per-launch key — in memory only. New launch ⇒ new identity everywhere.
const SESSION_KEY = crypto.randomBytes(16).toString('hex')

// Coherent, current Chrome identity profiles. Each ties a platform to a plausible
// GPU so the UA, navigator.platform, userAgentData and WebGL renderer never
// contradict each other. UA strings hide Electron entirely.
const PROFILES = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Win32', uaPlatform: 'Windows', platformVersion: '15.0.0', arch: 'x86',
    chromeMajor: '131', chromeFull: '131.0.6778.86',
    gpuVendor: 'Google Inc. (NVIDIA)',
    gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Win32', uaPlatform: 'Windows', platformVersion: '10.0.0', arch: 'x86',
    chromeMajor: '131', chromeFull: '131.0.6778.86',
    gpuVendor: 'Google Inc. (Intel)',
    gpuRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'MacIntel', uaPlatform: 'macOS', platformVersion: '14.1.0', arch: 'arm',
    chromeMajor: '131', chromeFull: '131.0.6778.86',
    gpuVendor: 'Google Inc. (Apple)',
    gpuRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Win32', uaPlatform: 'Windows', platformVersion: '15.0.0', arch: 'x86',
    chromeMajor: '131', chromeFull: '131.0.6778.86',
    gpuVendor: 'Google Inc. (AMD)',
    gpuRenderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
]

// ── Shared primitives — MUST stay byte-identical to the copies in antiFingerprint.js ──
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'com.au', 'net.au',
  'org.au', 'co.nz', 'com.br', 'co.in', 'com.cn', 'com.mx', 'com.sg',
])

function registrableDomain(hostname) {
  if (!hostname) return ''
  if (/^[\d.]+$/.test(hostname) || hostname === 'localhost' || hostname.indexOf('.') === -1) return hostname
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname
  const last2 = parts.slice(-2).join('.')
  if (MULTI_SUFFIX.has(last2)) return parts.slice(-3).join('.')
  return last2
}
// ──────────────────────────────────────────────────────────────────────────────

function pickProfile(hostname) {
  const seed = cyrb53(SESSION_KEY + '|' + registrableDomain(hostname))
  return PROFILES[seed % PROFILES.length]
}

// User-Agent for a given page URL (null if unparseable → leave UA untouched).
function uaForUrl(url) {
  try { return pickProfile(new URL(url).hostname).ua } catch { return null }
}

// Builds the injected content script once: substitutes the live session key and
// the PROFILES array into the antiFingerprint.js template.
let _clientSource = null
function clientSource() {
  if (_clientSource) return _clientSource
  const tmpl = fs.readFileSync(path.join(__dirname, 'antiFingerprint.js'), 'utf8')
  _clientSource = tmpl
    .replaceAll('__FP_SESSION_KEY__', () => SESSION_KEY)
    .replaceAll('__FP_PROFILES__', () => JSON.stringify(PROFILES))
  return _clientSource
}

module.exports = { SESSION_KEY, PROFILES, cyrb53, registrableDomain, pickProfile, uaForUrl, clientSource }
