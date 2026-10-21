// Manages the per-device store encryption key and the single shared encrypted Store.
//
// Security model
// ──────────────
// • A random 32-byte key is generated on first launch and written to .sskey after
//   being encrypted by the OS credential store (macOS Keychain via safeStorage,
//   Windows DPAPI, Linux Secret Service).  0o600 permissions restrict access to
//   the owner account.
//
// • Before handing the decrypted key to electron-store the key is put through a
//   second derivation step (APP_BINDING_SALT HMAC).  This means a third-party
//   Electron app that reads the same OS Keychain entry ("Electron Key" on
//   unsigned macOS builds) still cannot reconstruct the store encryption key
//   without knowing APP_BINDING_SALT and the userData path.
//
// • When safeStorage is unavailable (Linux without GNOME Keyring / KWallet) a
//   random key is stored in .sskeyf at 0o600 and HMAC-bound to /etc/machine-id
//   so the file is non-transferable to another machine.
//
// • On a data-wipe both key files are deleted.  The ciphertext in servesafe.json
//   is permanently unreadable even if the bytes are forensically recovered.
//
// Key format versioning
// ─────────────────────
// .sskey content (before safeStorage encryption): "ss2:<base64url-raw-key>"
// Files without the "ss2:" prefix are v1 (old format, raw key = store key
// directly, no app-binding).  Detection triggers a key rotation; the old store
// data becomes unreadable and electron-store silently starts fresh.
//
// Call storeKey.init() inside app.whenReady() before any store access.

const path    = require('path')
const fs      = require('fs')
const os      = require('os')
const { safeStorage, app } = require('electron')
const { randomBytes, createHmac } = require('crypto')

// Embedded in the derived key so the raw Keychain value alone is not enough.
// Changing this value invalidates all existing encrypted stores.
const APP_BINDING_SALT = 'servesafe-v2-2024'

// Version tag stored inside .sskey (before OS encryption).
const KEY_TAG = 'ss2:'

let _store = null

// ─── Public API ────────────────────────────────────────────────────────────────

async function init() {
  if (_store !== null) return
  const { default: Store } = await import('electron-store')
  const key = loadOrCreateKey()

  try {
    _store = new Store({ name: 'servesafe', encryptionKey: key })
  } catch (err) {
    // Store file is corrupt (bad JSON or wrong encryption key). Delete it and
    // start fresh — better to lose stored prefs than to crash on every launch.
    console.warn('[storeKey] Store file corrupt, resetting:', err.message)
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'servesafe.json')) } catch {}
    _store = new Store({ name: 'servesafe', encryptionKey: key })
  }

  migrateUnencrypted()
}

function getStore() {
  if (_store === null) throw new Error('storeKey.init() must be called inside app.whenReady()')
  return _store
}

// Called during data-wipe so the ciphertext in servesafe.json becomes permanently
// unreadable: both key files are deleted and the next launch generates fresh ones.
function deleteKey() {
  for (const p of [osKeyPath(), fallbackKeyPath()]) {
    try { fs.unlinkSync(p) } catch {}
  }
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

function osKeyPath()       { return path.join(app.getPath('userData'), '.sskey')  }
function fallbackKeyPath() { return path.join(app.getPath('userData'), '.sskeyf') }

// ─── Key loading / creation ────────────────────────────────────────────────────

function loadOrCreateKey() {
  return safeStorage.isEncryptionAvailable()
    ? loadOrCreateOsKey()
    : loadOrCreateFallbackKey()
}

// ── OS-backed path (macOS Keychain / Windows DPAPI / Linux Secret Service) ────

function loadOrCreateOsKey() {
  const kf = osKeyPath()
  let raw

  if (fs.existsSync(kf)) {
    try {
      const decoded = safeStorage.decryptString(fs.readFileSync(kf))
      if (decoded.startsWith(KEY_TAG)) {
        raw = decoded.slice(KEY_TAG.length)
      } else {
        // v1 file: raw key was used directly as the store key (no app-binding).
        // Rotate to v2.  electron-store silently starts fresh on decryption failure.
        console.warn('[storeKey] v1 key detected — rotating to v2 (existing store data cleared)')
        raw = writeOsKey(kf)
      }
    } catch {
      raw = writeOsKey(kf)
    }
  } else {
    raw = writeOsKey(kf)
  }

  return deriveStoreKey(raw)
}

function writeOsKey(kf) {
  const raw = randomBytes(32).toString('base64url')
  ensureDir(kf)
  fs.writeFileSync(kf, safeStorage.encryptString(KEY_TAG + raw), { mode: 0o600 })
  return raw
}

// ── Fallback path (Linux without Secret Service) ──────────────────────────────
// safeStorage is unavailable — a random key is stored in .sskeyf at 0o600 and
// bound to /etc/machine-id so the file is useless outside this machine.

function loadOrCreateFallbackKey() {
  const kf = fallbackKeyPath()
  let raw

  if (fs.existsSync(kf)) {
    try {
      const content = fs.readFileSync(kf, 'utf8').trim()
      // Accept only the base64url key (43+ chars); anything else is treated as corrupt.
      raw = /^[A-Za-z0-9_-]{43,}$/.test(content) ? content : writeFallbackKey(kf)
    } catch {
      raw = writeFallbackKey(kf)
    }
  } else {
    // First run, or v1 (deterministic hash — no .sskeyf existed): start fresh.
    raw = writeFallbackKey(kf)
  }

  // Bind to machine-id: the key file alone is not sufficient on another machine.
  const bound = createHmac('sha256', raw)
    .update(readMachineId() + '\0' + app.getPath('userData'))
    .digest('base64url')

  return deriveStoreKey(bound)
}

function writeFallbackKey(kf) {
  const raw = randomBytes(32).toString('base64url')
  ensureDir(kf)
  fs.writeFileSync(kf, raw, { mode: 0o600 })
  return raw
}

function readMachineId() {
  // Stable system-assigned UUID present on systemd-based Linux distros.
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = fs.readFileSync(p, 'utf8').trim()
      if (id.length >= 16) return id
    } catch {}
  }
  // Weak last-resort: hostname changes don't break things catastrophically.
  return os.hostname() + '\0' + process.platform
}

// ─── Key derivation ────────────────────────────────────────────────────────────
// Final derivation step shared by both paths.  Binds the key material to this
// specific app installation via APP_BINDING_SALT + userData path.
//
// Threat blocked: an attacker who extracts the raw OS credential value (e.g. via
// another Electron app on an unsigned macOS build) cannot derive the store key
// without also knowing APP_BINDING_SALT (embedded in this binary).

function deriveStoreKey(material) {
  return createHmac('sha256', material)
    .update(APP_BINDING_SALT + '\0' + app.getPath('userData'))
    .digest('base64url')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

// ─── One-time migration from unencrypted config.json ──────────────────────────

function migrateUnencrypted() {
  if (_store.get('_encrypted_migrated')) return

  const oldPath = path.join(app.getPath('userData'), 'config.json')
  if (!fs.existsSync(oldPath)) {
    _store.set('_encrypted_migrated', true)
    return
  }

  const MIGRATION_ALLOWLIST = new Set([
    'history', 'bookmarks', 'privacySettings', 'permissions',
    'location', 'lastSession', 'autoLockMinutes',
  ])

  try {
    const raw = JSON.parse(fs.readFileSync(oldPath, 'utf8'))
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (MIGRATION_ALLOWLIST.has(key)) _store.set(key, value)
      }
    }
    _store.set('_encrypted_migrated', true)
    fs.renameSync(oldPath, oldPath + '.bak')
  } catch {
    _store.set('_encrypted_migrated', true)
  }
}

module.exports = { init, getStore, deleteKey }
