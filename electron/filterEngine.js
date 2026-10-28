// Filter-list ad & tracker blocking engine (Ghostery adblocker).
//
// Replaces the static domain-list matching in adData.js / trackerData.js with a
// real Adblock-Plus/uBlock filter engine so ads and trackers are blocked on any
// website — EasyList, EasyPrivacy, Peter Lowe's list, uBlock Origin filters,
// including network rules, cosmetic (element-hiding) rules, and scriptlets.
//
// Two independent engines are kept so the app's separate ad/tracker counters and
// the separate blockAds / blockTrackers toggles keep working:
//   • ads      — EasyList + uBlock ad lists + Peter Lowe (cosmetics enabled)
//   • trackers — EasyPrivacy + uBlock privacy (network-only; cosmetics off)
//
// Lifecycle (never blocks startup on the network):
//   1. init() loads each engine from a serialized cache in userData if present
//      (instant, works offline).
//   2. If the cache is missing or older than REFRESH_MS, a fresh engine is built
//      from the remote lists in the background and atomically swapped in, then
//      re-serialized to the cache.
//   3. Until an engine is ready, match* falls back to the static isAd / isTracker
//      lists so protection is never zero.

const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const {
  ElectronBlocker,
  Request,
  fromElectronDetails,
  adsLists,
  adsAndTrackingLists,
} = require('@ghostery/adblocker-electron')
const { isAd, AD_COSMETIC_CSS } = require('./adData')
const { isTracker } = require('./trackerData')

// Rebuild the cached engine if it's older than this (background refresh).
const REFRESH_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

// Ad lists carry cosmetics; the tracker-only lists are the privacy lists that
// appear in adsAndTrackingLists but not adsLists (EasyPrivacy + uBlock privacy).
const AD_LIST_URLS = adsLists
const TRACKER_LIST_URLS = adsAndTrackingLists.filter((u) => !adsLists.includes(u))

const engines = {
  ads: {
    instance: null,
    urls: AD_LIST_URLS,
    config: { loadCosmeticFilters: true, loadNetworkFilters: true },
    file: 'filter-engine-ads.bin',
    building: false,
  },
  trackers: {
    instance: null,
    urls: TRACKER_LIST_URLS,
    config: { loadCosmeticFilters: false, loadNetworkFilters: true },
    file: 'filter-engine-trackers.bin',
    building: false,
  },
}

function cachePath(file) {
  return path.join(app.getPath('userData'), file)
}

// Load a serialized engine from disk. Returns true only if the cache exists AND
// is fresh; a stale-but-valid cache is still loaded (so we have protection) but
// returns false to trigger a background refresh.
function loadFromCache(e) {
  const p = cachePath(e.file)
  try {
    const buf = fs.readFileSync(p)
    e.instance = ElectronBlocker.deserialize(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  } catch {
    // Missing file or ENGINE_VERSION mismatch — needs a fresh build.
    return false
  }
  try {
    return Date.now() - fs.statSync(p).mtimeMs < REFRESH_MS
  } catch {
    return false
  }
}

// Build a fresh engine from the remote lists and cache it. fromLists also fetches
// uBlock's resources.json so redirect and scriptlet rules resolve.
async function buildFromNetwork(e) {
  if (e.building) return
  e.building = true
  try {
    const blocker = await ElectronBlocker.fromLists(fetch, e.urls, e.config)
    e.instance = blocker // atomic swap
    try {
      const p = cachePath(e.file)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, Buffer.from(blocker.serialize()), { mode: 0o600 })
    } catch (err) {
      console.warn(`[filterEngine] cache write failed (${e.file}):`, err.message)
    }
  } catch (err) {
    // Offline / fetch failure — keep whatever (cached or null) instance we have.
    console.warn(`[filterEngine] build failed (${e.file}):`, err.message)
  } finally {
    e.building = false
  }
}

function initEngine(e) {
  const fresh = loadFromCache(e)
  if (!fresh) buildFromNetwork(e) // fire-and-forget background build/refresh
}

// ─── Public API ────────────────────────────────────────────────────────────────

// Kick off loading both engines. Returns immediately; never blocks startup.
function init() {
  initEngine(engines.ads)
  initEngine(engines.trackers)
}

// `details` is the Electron onBeforeRequest details object.
function matchAds(details) {
  const engine = engines.ads.instance
  if (!engine) return isAd(details.url)
  try {
    return engine.match(fromElectronDetails(details)).match === true
  } catch {
    return isAd(details.url)
  }
}

function matchTrackers(details) {
  const engine = engines.trackers.instance
  if (!engine) return isTracker(details.url)
  try {
    return engine.match(fromElectronDetails(details)).match === true
  } catch {
    return isTracker(details.url)
  }
}

// Cosmetic (element-hiding) rules + scriptlets for a page URL, from the ads engine.
// Falls back to the static selector CSS until the engine is ready.
function getCosmetics(frameUrl) {
  const engine = engines.ads.instance
  if (!engine || !frameUrl || !/^https?:/i.test(frameUrl)) {
    return { styles: AD_COSMETIC_CSS, scripts: [] }
  }
  try {
    // Request.fromRawDetails computes hostname + eTLD+1 domain via tldts.
    const { hostname, domain } = Request.fromRawDetails({ url: frameUrl, type: 'document' })
    const { styles, scripts } = engine.getCosmeticsFilters({ url: frameUrl, hostname, domain })
    return { styles: styles || '', scripts: Array.isArray(scripts) ? scripts : [] }
  } catch {
    return { styles: AD_COSMETIC_CSS, scripts: [] }
  }
}

module.exports = { init, matchAds, matchTrackers, getCosmetics }
