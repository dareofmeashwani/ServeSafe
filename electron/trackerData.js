// Pure tracker-matching data — no electron-store dependency.
// Safe to require() from Worker Threads.

const TRACKER_DOMAINS = new Set([
  // ── Google advertising & analytics ──────────────────────────────────────────
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
  'googletagservices.com', 'googlesyndication.com', 'doubleclick.net',
  'adservice.google.com', 'pagead2.googlesyndication.com',
  'googleadservices.com', 'google-analytics.com', 'googleoptimize.com',
  'tns-counter.ru', 'g.doubleclick.net',

  // ── Facebook / Meta ──────────────────────────────────────────────────────────
  'connect.facebook.net',    // Facebook Pixel SDK
  'an.facebook.com',         // Audience Network
  'audience-network.com',
  'atlassolutions.com',      // Atlas (Facebook ad measurement)
  'facebook.net',

  // ── Microsoft advertising & analytics ───────────────────────────────────────
  'bat.bing.com',            // Universal Event Tracking
  'clarity.ms',              // Microsoft Clarity session recording
  'c.bing.com',              // Bing tracking
  'ads.microsoft.com',
  'bingads.microsoft.com',
  'msn.com', // - only tracking subdomains hit this but domain match covers them

  // ── Twitter / X ──────────────────────────────────────────────────────────────
  'ads-twitter.com',
  'static.ads-twitter.com',
  'analytics.twitter.com',

  // ── LinkedIn ─────────────────────────────────────────────────────────────────
  'ads.linkedin.com',
  'px.ads.linkedin.com',
  'dc.ads.linkedin.com',
  'snap.licdn.com',          // LinkedIn Insight Tag (not Snapchat)

  // ── TikTok ───────────────────────────────────────────────────────────────────
  'analytics.tiktok.com',
  'ads.tiktok.com',
  'ad.tiktok.com',
  'mssdk-va.tiktok.com',

  // ── Pinterest ────────────────────────────────────────────────────────────────
  'ct.pinterest.com',
  'log.pinterest.com',
  'analytics.pinterest.com',

  // ── Snapchat ─────────────────────────────────────────────────────────────────
  'tr.snapchat.com',
  'sc-static.net',

  // ── Amazon advertising ───────────────────────────────────────────────────────
  'amazon-adsystem.com',
  'fls-na.amazon.com',

  // ── Adobe Marketing Cloud ────────────────────────────────────────────────────
  'omtrdc.net',              // Adobe Analytics data collection
  '2o7.net',                 // Legacy Omniture
  'demdex.net',              // Adobe Audience Manager
  'omniture.com',
  'adobedc.net',
  'sc.omtrdc.net',
  'adobe-target.tt.omtrdc.net',

  // ── Oracle / BlueKai / Eloqua ────────────────────────────────────────────────
  'bluekai.com',
  'krxd.net',                // Krux DMP (acquired by Salesforce)
  'eloqua.com',
  'btttag.com',              // Oracle BlueKai

  // ── Salesforce Marketing Cloud ───────────────────────────────────────────────
  'krux.com',
  'pardot.com',
  'rtp.salesforce.com',
  'exacttarget.com',

  // ── HubSpot ──────────────────────────────────────────────────────────────────
  'hs-analytics.net',
  'hubspot.com',             // HubSpot tracking pixel / forms

  // ── Nielsen / Comscore ───────────────────────────────────────────────────────
  'scorecardresearch.com',
  'quantserve.com',
  'nielsen.com',
  'exelator.com',
  'ati-host.net',

  // ── AppNexus / Xandr / Index Exchange ────────────────────────────────────────
  'adnxs.com',
  'appnexus.com',
  'indexexchange.com',

  // ── Broad ad networks ────────────────────────────────────────────────────────
  'adform.net', 'advertising.com', 'adtech.de',
  'openx.net', 'pubmatic.com', 'rubiconproject.com', 'casalemedia.com',
  'contextweb.com', 'outbrain.com', 'taboola.com',
  'criteo.com', 'criteo.net',
  'adsrvr.org',              // The Trade Desk
  'thetradedesk.com', 'tradedesk.com',
  'moatads.com', 'moatpixel.com',
  'rlcdn.com', 'ipredictive.com',
  'media.net', 'bidswitch.net', 'smartadserver.com', 'sovrn.com',
  'lijit.com', 'springserve.net', 'yieldmo.com', 'sharethrough.com',
  'lkqd.net', 'improvedigital.com', 'triplelift.com',
  'spotxchange.com', 'spotx.tv',
  '33across.com', 'rhythmone.com',
  'emxdgt.com',              // EMX Digital
  'nativo.com', 'adyoulike.com',
  'teads.tv',                // Teads video ads
  'connatix.com', 'undertone.com', 'zemanta.com',
  'brightroll.com',
  'exelate.com', 'eyeota.com',
  'pulsepoint.com',
  'addthis.com',             // Oracle AddThis social tracking widget
  'sharethis.com',           // ShareThis tracking widget
  'tradedoubler.com', 'valueclick.com', 'linksynergy.com',
  'zedo.com', 'yieldmanager.com', 'specificclick.net',
  'adsafe.org',

  // ── Analytics / product analytics ────────────────────────────────────────────
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'logrocket.com',
  'smartlook.com', 'inspectlet.com', 'crazyegg.com', 'clicktale.net',
  'mixpanel.com', 'amplitude.com', 'heap.io',
  'segment.io', 'segment.com',
  'intercom.io', 'intercomcdn.com',
  'kissmetrics.com', 'chartbeat.com',
  'parsely.com',
  'optimizely.com', 'vwo.com', 'ab.tasty',
  'convert.com', 'kameleoon.com',
  'sessionstack.com',

  // ── Tag management (tracking orchestration) ───────────────────────────────────
  'tealium.com', 'tealiumiq.com',
  'ensighten.com',
  'signal.co',               // Signal tag/data onboarding

  // ── Customer data platforms ───────────────────────────────────────────────────
  'mparticle.com', 'lytics.io',
  'zeotap.com',

  // ── Mobile / app attribution ─────────────────────────────────────────────────
  'adjust.com',
  'appsflyer.com',
  'kochava.com',
  'branch.io',
  'singular.net',

  // ── Identity resolution / data brokers ───────────────────────────────────────
  'tapad.com',
  'id5-sync.com',
  'liveintent.com',
  'liveramp.com',
  'neustar.biz',
  'acxiom.com',
  'lotame.com',
  'intentiq.com',

  // ── Device fingerprinting services ───────────────────────────────────────────
  'fingerprintjs.com',       // FingerprintJS open source
  'fingerprint.com',         // FingerprintJS Pro
  'iovation.com',            // TransUnion device fingerprinting
  'threatmetrix.com',        // LexisNexis ThreatMetrix
  'tiqcdn.com',              // Tealium CDN / tag mgmt
  'deviceatlas.com',
  'scientiamobile.com',

  // ── Push notification SDKs (often include tracking) ───────────────────────────
  'onesignal.com',
  'pushwoosh.com',

  // ── Anti-fraud / real user monitoring ────────────────────────────────────────
  'doubleverify.com',
  'integralads.com',         // IAS
  'adsafeprotected.com',
  'sizmek.com',
  'flashtalking.com',

  // ── New Relic / Dynatrace / Datadog (RUM beacons) ────────────────────────────
  'nr-data.net',             // New Relic
  'newrelic.com',

  // ── IP geolocation lookup (fingerprinting via IP metadata) ───────────────────
  'ip-api.com',
  'ipapi.co',
  'freegeoip.app',
  'ipinfo.io',
])

const TRACKER_PATTERNS = [
  // Google Analytics variants
  '/analytics.js', '/ga.js', '/gtag/js', '/gtm.js',
  // Facebook Pixel
  '/fbevents.js', '/fbq.js',
  // Generic tracking scripts
  '/pixel.js', '/tracking.js', '/beacon.js',
  '/fingerprint.min.js', '/fingerprint.js', '/fp.js',
  // Microsoft Clarity
  '/clarity.js',
  // Collection endpoints
  '/collect?v=',           // GA universal collect
  '/collect?',
  // Tracking pixels (GIF-based)
  '/__utm.gif', '/utm.gif',
  '/pixel.gif', '/p.gif', '/b.gif',
  // Vercel / Next.js analytics
  '/_vercel/insights', '/insights/script',
  // Generic tracking endpoints
  '/track.php', '/track.js', '/track.gif',
  '/click.php', '/click.gif',
  '/impression.gif', '/imp.php',
  '/beacon.php', '/beacon.gif',
]

function isTracker(url) {
  let hostname = ''
  let pathname = ''
  try {
    const u = new URL(url)
    hostname = u.hostname
    pathname = u.pathname + u.search
  } catch {
    return false
  }
  if (TRACKER_DOMAINS.has(hostname)) return true
  for (const known of TRACKER_DOMAINS) {
    if (hostname.endsWith('.' + known)) return true
  }
  for (const pat of TRACKER_PATTERNS) {
    if (pathname.includes(pat)) return true
  }
  return false
}

module.exports = { TRACKER_DOMAINS, TRACKER_PATTERNS, isTracker }
