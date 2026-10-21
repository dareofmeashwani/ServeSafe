const { workerData, parentPort } = require('worker_threads')
const { isTracker } = require('../trackerData')

let settings = workerData?.settings || { blockTrackers: true, httpsOnly: false }
let blocklist = new Set(workerData?.blocklist || [])

function checkRequest(url, webContentsId) {
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    return { cancel: false }
  }

  // Custom blocklist
  if (blocklist.has(hostname)) {
    return { cancel: true, reason: 'blocklist' }
  }

  // HTTPS-only mode: block http:// (except localhost)
  if (settings.httpsOnly && url.startsWith('http://') && hostname !== 'localhost' && !hostname.startsWith('127.')) {
    return { cancel: true, reason: 'https-only' }
  }

  // Tracker blocking
  if (settings.blockTrackers && isTracker(url)) {
    return { cancel: true, reason: 'tracker' }
  }

  return { cancel: false }
}

parentPort.on('message', (msg) => {
  if (msg.type === 'CHECK') {
    const result = checkRequest(msg.url, msg.webContentsId)
    parentPort.postMessage({ id: msg.id, url: msg.url, webContentsId: msg.webContentsId, ...result })
  } else if (msg.type === 'UPDATE_CONFIG') {
    if (msg.settings) settings = msg.settings
    if (msg.blocklist) blocklist = new Set(msg.blocklist)
  }
})
