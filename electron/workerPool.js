const { Worker } = require('worker_threads')
const path = require('path')
const { randomUUID } = require('crypto')

const WORKER_PATH = path.join(__dirname, 'workers', 'requestFilter.js')

class RequestFilterPool {
  constructor(size = 2) {
    this._size = size
    this._workers = []
    this._pending = new Map()
    this._robin = 0
    this._settings = {}
    this._blocklist = []

    for (let i = 0; i < size; i++) this._spawn(i)
  }

  _spawn(index) {
    const w = new Worker(WORKER_PATH, {
      workerData: { settings: this._settings, blocklist: this._blocklist },
    })
    w.on('message', (msg) => {
      const resolve = this._pending.get(msg.id)
      if (resolve) {
        this._pending.delete(msg.id)
        resolve(msg)
      }
    })
    w.on('error', (err) => console.error(`[RequestFilterPool] worker ${index} error:`, err))
    w.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[RequestFilterPool] worker ${index} exited with code ${code}, restarting`)
        this._workers[index] = null
        this._spawn(index)
      }
    })
    this._workers[index] = w
  }

  check(url, webContentsId) {
    return new Promise((resolve) => {
      const id = randomUUID()
      this._pending.set(id, resolve)
      const worker = this._workers[this._robin % this._size]
      this._robin++
      if (worker) {
        worker.postMessage({ type: 'CHECK', id, url, webContentsId })
      } else {
        // Worker restarting — resolve safe (don't block requests)
        this._pending.delete(id)
        resolve({ id, url, webContentsId, cancel: false })
      }
    })
  }

  updateConfig(settings, blocklist) {
    this._settings = settings
    this._blocklist = blocklist
    for (const w of this._workers) {
      if (w) w.postMessage({ type: 'UPDATE_CONFIG', settings, blocklist })
    }
  }

  terminate() {
    for (const w of this._workers) {
      if (w) w.terminate()
    }
    this._workers = []
  }
}

module.exports = { RequestFilterPool }
