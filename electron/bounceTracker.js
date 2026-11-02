// Bounce-tracking & redirect protection.
//
// Two complementary defences against "redirect tracking" / "bounce tracking",
// where a tracker domain briefly becomes the top-level (first-party) page so it
// can read/write its own cookies before forwarding you to the real destination:
//
//  1. DEBOUNCING (decloak) — many bounce links carry the real destination in a
//     query parameter (e.g. google.com/url?q=…, l.facebook.com/l.php?u=…, or any
//     known tracker host with a ?url=… param). We extract it and jump straight
//     there, so the tracker domain is never contacted at all.
//
//  2. STORAGE PURGE (Firefox's Bounce Tracking Protection model) — when a
//     navigation is briefly routed THROUGH a tracker host (a server redirect hop,
//     or a JS redirect) with no user interaction, we wipe that host's cookies and
//     storage so it can't accumulate a cross-site identifier.

const { isTracker } = require('./trackerData')

// Known redirector hosts and the query param(s) carrying the destination.
// `host` is matched as a suffix (host itself or any subdomain). `path`, if given,
// must prefix the URL path (keeps us from touching e.g. OAuth endpoints on the
// same host). The sentinel '__RAW_QUERY__' means "the whole query string is the
// destination" (href.li style).
const REDIRECTORS = [
  { host: 'google.com', path: '/url', params: ['q', 'url'] },
  { host: 'google.com', path: '/imgres', params: ['imgurl'] },
  { host: 'youtube.com', path: '/redirect', params: ['q'] },
  { host: 'l.facebook.com', params: ['u'] },
  { host: 'lm.facebook.com', params: ['u'] },
  { host: 'l.instagram.com', params: ['u'] },
  { host: 'l.messenger.com', params: ['u'] },
  { host: 'away.vk.com', params: ['to'] },
  { host: 'out.reddit.com', params: ['url'] },
  { host: 'www.linkedin.com', path: '/redir/redirect', params: ['url'] },
  { host: 't.umblr.com', params: ['z'] },
  { host: 'href.li', params: ['__RAW_QUERY__'] },
  { host: 'safelinks.protection.outlook.com', params: ['url'] },
  { host: 'url.au.m.mimecastprotect.com', params: ['url'] },
]

// Params tried on ANY host already classified as a tracker. Deliberately excludes
// login/OAuth-flavoured names (redirect_uri, next, continue, return) to avoid
// breaking sign-in flows even on tracker hosts.
const GENERIC_PARAMS = ['url', 'u', 'target', 'dest', 'destination', 'redirect', 'redir', 'to', 'out', 'goto', 'link']

function findRule(hostname, pathname) {
  const h = (hostname || '').toLowerCase()
  for (const rule of REDIRECTORS) {
    if (h !== rule.host && !h.endsWith('.' + rule.host)) continue
    if (rule.path && !pathname.startsWith(rule.path)) continue
    return rule
  }
  return null
}

// Returns a plausible http(s) destination from a raw param value, undoing up to
// two layers of percent-encoding. Null if the value isn't an absolute URL.
function extractDest(raw) {
  if (!raw) return null
  let v = raw
  for (let i = 0; i < 2 && /^https?%3a/i.test(v); i++) {
    try { v = decodeURIComponent(v) } catch { break }
  }
  return /^https?:\/\//i.test(v) ? v : null
}

// If `rawUrl` is a redirector carrying its destination, returns that destination
// URL (always a different host). Otherwise null.
function decloak(rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const rule = findRule(u.hostname, u.pathname)
  const params = rule ? rule.params : (isTracker(rawUrl) ? GENERIC_PARAMS : null)
  if (!params) return null

  const candidates = []
  for (const p of params) {
    if (p === '__RAW_QUERY__') candidates.push(decodeURIComponent(u.search.slice(1)))
    else {
      const val = u.searchParams.get(p)
      if (val) candidates.push(val)
    }
  }

  for (const c of candidates) {
    const dest = extractDest(c)
    if (!dest) continue
    try {
      const d = new URL(dest)
      if (d.hostname && d.hostname !== u.hostname) return d.toString()
    } catch {}
  }
  return null
}

// True if a host is a bounce-tracker worth purging after a transient visit.
function isBounceTrackerHost(host) {
  if (!host) return false
  if (findRule(host, '/')) return true
  return isTracker('https://' + host + '/')
}

// Wipes cookies + site storage for a host that we were only bounced through.
// Best-effort and fire-and-forget; every call is guarded so a failure on one
// origin/cookie never aborts the rest.
async function purgeHost(sess, host) {
  if (!sess || !host) return
  const clean = host.replace(/^www\./, '')
  const storages = ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem']

  for (const h of new Set([host, clean, 'www.' + clean])) {
    for (const scheme of ['https://', 'http://']) {
      try { await sess.clearStorageData({ origin: scheme + h, storages }) } catch {}
    }
  }

  // Cookies are domain-scoped, so clearStorageData(origin) can miss them — remove
  // each one explicitly by the URL it belongs to.
  try {
    const cookies = await sess.cookies.get({ domain: clean })
    for (const c of cookies) {
      const d = c.domain.replace(/^\./, '')
      const url = (c.secure ? 'https://' : 'http://') + d + (c.path || '/')
      try { await sess.cookies.remove(url, c.name) } catch {}
    }
  } catch {}
}

module.exports = { decloak, isBounceTrackerHost, purgeHost }
