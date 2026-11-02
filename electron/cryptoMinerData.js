// Static cryptomining domain list — used as a fallback before the filter engine
// loads and as the primary matching source (no dedicated engine is needed for mining).
// Covers in-browser miners (Coinhive variants, CryptoLoot, JSEcoin, etc.) and
// direct WebSocket connections to known mining pool endpoints.

const CRYPTO_MINER_DOMAINS = new Set([
  // ── Coinhive & direct variants ────────────────────────────────────────────────
  'coinhive.com', 'coin-hive.com', 'authedmine.com', 'cnhv.co', 'coinhiveproxy.com',

  // ── CryptoLoot ────────────────────────────────────────────────────────────────
  'cryptoloot.pro', 'crypto-loot.com', 'cryptoloot.com',

  // ── JSEcoin ───────────────────────────────────────────────────────────────────
  'jsecoin.com', 'load.jsecoin.com',

  // ── Minero ────────────────────────────────────────────────────────────────────
  'minero.pw', 'minero.cc',

  // ── WebMine / WebMinePool ─────────────────────────────────────────────────────
  'webmine.pro', 'webminepool.com', 'webminecdn.com', 'wss.webminepool.com',

  // ── Papoto ────────────────────────────────────────────────────────────────────
  'papoto.com',

  // ── DeepMiner ────────────────────────────────────────────────────────────────
  'deepminer.xyz',

  // ── MinerAlt ─────────────────────────────────────────────────────────────────
  'mineralt.io', 'ws.mineralt.io',

  // ── MoneyMaker / HashForCash ──────────────────────────────────────────────────
  'moneymaker.rocks', 'hashforcash.us',

  // ── Listat / Stataly ──────────────────────────────────────────────────────────
  'listat.biz', 'stataly.com', 'lmodr.biz',

  // ── CloudCoins / MineCrunch / MineMyTraffic ───────────────────────────────────
  'cloudcoins.co', 'minecrunch.co', 'minemytraffic.com',

  // ── Miscellaneous in-browser miners ──────────────────────────────────────────
  'monerominer.rocks', 'cpu-miner.net', 'cryptonight.eu',
  'coin-have.com', 'coinpirate.cf', 'hashingitout.it',
  'minecoin.pw', 'wsocket.pw', 'hashg.net', 'coinspark.io',
  'coindrive.online', 'xmrminer.com', 'coiminer.com',
  'crypto-webminer.com', 'cryptowebminer.com', 'coinblocker.live',
  'surrealcrypto.com', 'hash-to-coins.com', 'bitdig.online',
  'coinhub.ltd', 'polymer.xyz', 'myr.io',

  // ── Known XMR / mining pool WebSocket endpoints ───────────────────────────────
  'pool.minexmr.com', 'xmr.crypto-pool.fr', 'moneropool.com',
  'supportxmr.com', 'xmrpool.net', 'monerohash.com',
  'donate.xmrpool.eu', 'hashvault.pro', 'nanopool.org',
  'xmrpool.eu', 'pool.supportxmr.com', 'de.minexmr.com',
  'ca.minexmr.com', 'sg.minexmr.com',
])

function isCryptoMiner(url) {
  if (typeof url !== 'string') return false
  try {
    const { hostname } = new URL(url)
    if (CRYPTO_MINER_DOMAINS.has(hostname)) return true
    // Subdomain check: e.g. ws.pool.minexmr.com → pool.minexmr.com
    const parts = hostname.split('.')
    for (let i = 1; i < parts.length - 1; i++) {
      if (CRYPTO_MINER_DOMAINS.has(parts.slice(i).join('.'))) return true
    }
    return false
  } catch { return false }
}

module.exports = { CRYPTO_MINER_DOMAINS, isCryptoMiner }
