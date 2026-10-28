// Pure ad-matching data — no electron-store dependency.
// Safe to require() from Worker Threads. Kept separate from trackerData.js so
// advertising and analytics/tracking can be toggled independently.

// ── Ad-serving / ad-network domains ─────────────────────────────────────────────
// Derived from common EasyList network entries. These serve or broker display,
// video, and native ads. Analytics/tracking domains live in trackerData.js.
const AD_DOMAINS = new Set([
  // ── Google display / video ads ──────────────────────────────────────────────
  'googlesyndication.com', 'pagead2.googlesyndication.com',
  'doubleclick.net', 'g.doubleclick.net', 'stats.g.doubleclick.net',
  'googleadservices.com', 'adservice.google.com', 'googletagservices.com',
  'partner.googleadservices.com', 'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net', 'adclick.g.doubleclick.net',
  'cm.g.doubleclick.net', 'ad.doubleclick.net',
  'afs.googlesyndication.com', 'tpc.googlesyndication.com',

  // ── Amazon ads ────────────────────────────────────────────────────────────────
  'amazon-adsystem.com', 'aax.amazon-adsystem.com', 'c.amazon-adsystem.com',
  's.amazon-adsystem.com', 'aax-us-east.amazon-adsystem.com',

  // ── Major SSPs / exchanges / DSPs ─────────────────────────────────────────────
  'adnxs.com', 'appnexus.com', 'secure.adnxs.com', 'ib.adnxs.com',
  'pubmatic.com', 'ads.pubmatic.com', 'image6.pubmatic.com', 'hbopenbid.pubmatic.com',
  'rubiconproject.com', 'fastlane.rubiconproject.com', 'optimized-by.rubiconproject.com',
  'openx.net', 'us-u.openx.net', 'openx.com',
  'casalemedia.com', 'as.casalemedia.com', 'dsum-sec.casalemedia.com',
  'indexexchange.com', 'casale.com', 'htlb.casalemedia.com',
  'contextweb.com', 'adsrvr.org', 'thetradedesk.com', 'tradedesk.com',
  'bidswitch.net', 'smartadserver.com', 'sascdn.com', 'sovrn.com', 'lijit.com',
  'springserve.net', 'yieldmo.com', 'sharethrough.com', 'lkqd.net',
  'improvedigital.com', 'triplelift.com', '3lift.com',
  'spotxchange.com', 'spotx.tv', '33across.com', 'rhythmone.com', '1rx.io',
  'emxdgt.com', 'nativo.com', 'adyoulike.com', 'teads.tv', 'connatix.com',
  'undertone.com', 'zemanta.com', 'brightroll.com', 'pulsepoint.com',
  'districtm.io', 'gumgum.com', 'adform.net', 'adformdsp.net',
  'media.net', 'adsafeprotected.com', 'servedby-buysellads.com', 'buysellads.com',
  'carbonads.com', 'carbonads.net', 'adroll.com', 'd.adroll.com',
  'advertising.com', 'adtech.de', 'adtechus.com', 'adtechjp.com',
  'yieldmanager.com', 'yieldlab.net', 'adtelligent.com',
  'smartyads.com', 'onetag-sys.com', 'onetag.com', 'adkernel.com',
  'engagebdr.com', 'conversantmedia.com', 'mediavine.com', 'adthrive.com',
  'ezoic.com', 'ezoic.net', 'ezodn.com', 'adpushup.com',

  // ── Criteo / retargeting ──────────────────────────────────────────────────────
  'criteo.com', 'criteo.net', 'static.criteo.net', 'bidder.criteo.com',
  'gum.criteo.com', 'dis.criteo.com', 'sslwidget.criteo.com',

  // ── Content recommendation / native ads ──────────────────────────────────────
  'outbrain.com', 'widgets.outbrain.com', 'traffic.outbrain.com',
  'taboola.com', 'cdn.taboola.com', 'trc.taboola.com', 'api.taboola.com',
  'revcontent.com', 'cdn.revcontent.com', 'trends.revcontent.com',
  'mgid.com', 'servicer.mgid.com', 'jsc.mgid.com',
  'content.ad', 'adblade.com', 'adsnative.com', 'plista.com', 'ligatus.com',

  // ── Verification / viewability ────────────────────────────────────────────────
  'moatads.com', 'moatpixel.com', 'doubleverify.com', 'integralads.com',
  'sizmek.com', 'flashtalking.com', 'serving-sys.com',

  // ── Popups / popunders / low-quality networks ────────────────────────────────
  'popads.net', 'popcash.net', 'propellerads.com', 'propellerclick.com',
  'onclickads.net', 'onclckds.com', 'onclicksuper.com', 'adcash.com',
  'adsterra.com', 'exoclick.com', 'exosrv.com', 'juicyads.com', 'trafficjunky.net',
  'hilltopads.net', 'clickadu.com', 'admaven.com', 'ad-maven.com',
  'mgcash.com', 'revenuehits.com', 'bidvertiser.com', 'infolinks.com',
  'clksite.com', 'adnium.com', 'trafficstars.com', 'tsyndicate.com',
  'go.pub2srv.com', 'poptm.com', 'popunder.net',

  // ── Mobile / in-app ad SDKs ───────────────────────────────────────────────────
  'applovin.com', 'applvn.com', 'unityads.unity3d.com', 'unity3d.com',
  'inmobi.com', 'inmobicdn.net', 'vungle.com', 'ironsrc.com', 'ironsource.mobi',
  'chartboost.com', 'adcolony.com', 'startappservice.com', 'startapp.com',
  'mopub.com', 'tapjoy.com', 'smaato.net', 'mobfox.com', 'fyber.com',

  // ── Affiliate ad networks ─────────────────────────────────────────────────────
  'tradedoubler.com', 'valueclick.com', 'linksynergy.com', 'commission-junction.com',
  'cj.com', 'impact-ad.jp', 'zedo.com', 'specificclick.net', 'adsafe.org',
])

// ── URL path / substring patterns ──────────────────────────────────────────────
// Matched against pathname + search. Chosen to minimize false positives: each
// token is specific to ad delivery and rarely appears in legitimate content paths.
const AD_PATH_PATTERNS = [
  '/pagead/', '/pagead2/', '/adsense/', '/adservice/', '/adserver/',
  '/adserving/', '/ad_server/', '/adframe', '/adserve', '/ad_engine',
  '/adchoices', '/ad-choices', '/advertisement', '/advertising/',
  '/banner_ads/', '/bannerads/', '/banners/ads', '/popunder', '/pop-under',
  '/prebid', '/openrtb', '/vast/', '/vmap/', '/doubleclick/',
  '/googleads/', '/google_ads', '/gampad/', '/safeframe/',
  '/sponsored/', '/native-ads/', '/nativeads/', '/promoted/',
  '/interstitial', '/preroll', '/midroll', '/postroll',
  '/adtech/', '/admanager/', '/ad_manager/', '/adcontent/',
  '/getad', '/get_ads', '/showad', '/show_ads', '/servead', '/serve_ad',
]

// ── Cosmetic filter selectors ────────────────────────────────────────────────────
// Hide common ad containers that remain after their network requests are blocked,
// preventing empty gaps / collapsed-but-visible placeholders. Static class/id
// patterns cover the overwhelming majority of real-world ad slots.
const AD_COSMETIC_SELECTORS = [
  'ins.adsbygoogle',
  '.adsbygoogle',
  'iframe[id^="google_ads_iframe"]',
  'iframe[id^="aswift_"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="/ads/"]',
  'div[id^="div-gpt-ad"]',
  'div[id^="google_ads_"]',
  'div[id^="ad-"]',
  'div[id^="ads-"]',
  'div[id$="-ad"]',
  'div[id$="_ad"]',
  'div[id*="-ads-"]',
  'div[class^="ad-"]',
  'div[class*=" ad-"]',
  'div[class^="ads-"]',
  'div[class*=" ads-"]',
  'div[class$="-ad"]',
  'div[class$="-ads"]',
  'div[class*="advert"]',
  'div[class*="-advertisement"]',
  'div[class*="sponsored"]',
  '.adsbox', '.ad-banner', '.ad-container', '.ad-wrapper', '.ad-slot',
  '.ad-unit', '.ad-placeholder', '.advertisement', '.advert', '.sponsor-ad',
  '.banner-ad', '.banner-ads', '.dfp-ad', '.gpt-ad', '.outbrain', '.OUTBRAIN',
  '.taboola', '[class*="taboola"]', '[id*="taboola"]', '.trc_related_container',
  'aside[aria-label="Advertisement"]', 'div[aria-label="Advertisement"]',
  'ins[class*="adsbygoogle"]',
]

const AD_COSMETIC_CSS =
  AD_COSMETIC_SELECTORS.join(',\n') +
  ' {\n  display: none !important;\n  min-height: 0 !important;\n  height: 0 !important;\n}\n'

function isAd(url) {
  let hostname = ''
  let pathname = ''
  try {
    const u = new URL(url)
    hostname = u.hostname
    pathname = (u.pathname + u.search).toLowerCase()
  } catch {
    return false
  }
  if (AD_DOMAINS.has(hostname)) return true
  for (const known of AD_DOMAINS) {
    if (hostname.endsWith('.' + known)) return true
  }
  for (const pat of AD_PATH_PATTERNS) {
    if (pathname.includes(pat)) return true
  }
  return false
}

module.exports = {
  AD_DOMAINS,
  AD_PATH_PATTERNS,
  AD_COSMETIC_SELECTORS,
  AD_COSMETIC_CSS,
  isAd,
}
