const { getStore } = require('./storeKey')
const { isTracker, TRACKER_DOMAINS } = require('./trackerData')
const { isAd } = require('./adData')

const DEFAULT_SETTINGS = {
  doNotTrack: true,
  globalPrivacyControl: true,
  blockTrackers: true,
  blockAds: true,
  httpsOnly: false,
  blockThirdPartyCookies: true,
}

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...getStore().get('privacySettings', {}) }
}

function saveSettings(patch) {
  const current = getSettings()
  getStore().set('privacySettings', { ...current, ...patch })
  return getSettings()
}

module.exports = { getSettings, saveSettings, isTracker, isAd, TRACKER_DOMAINS }
