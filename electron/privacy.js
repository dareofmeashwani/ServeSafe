const { getStore } = require('./storeKey')
const { isTracker, TRACKER_DOMAINS } = require('./trackerData')

const DEFAULT_SETTINGS = {
  doNotTrack: true,
  globalPrivacyControl: true,
  blockTrackers: true,
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

module.exports = { getSettings, saveSettings, isTracker, TRACKER_DOMAINS }
