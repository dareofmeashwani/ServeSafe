// Certificate management: pending callbacks + per-session exceptions

const pending = new Map() // id -> callback
const exceptions = new Set() // hostnames user chose to trust

let counter = 0
function newId() { return `cert_${++counter}_${Date.now()}` }

function storeCertCallback(callback) {
  const id = newId()
  pending.set(id, callback)
  // Auto-deny after 2 minutes if user never responds
  setTimeout(() => {
    if (pending.has(id)) {
      pending.get(id)(false)
      pending.delete(id)
    }
  }, 120_000)
  return id
}

function resolveCertCallback(id, allow) {
  if (!pending.has(id)) return
  pending.get(id)(allow === true)
  pending.delete(id)
}

function addException(hostname) { exceptions.add(hostname) }
function hasException(hostname) { return exceptions.has(hostname) }

module.exports = { storeCertCallback, resolveCertCallback, addException, hasException }
