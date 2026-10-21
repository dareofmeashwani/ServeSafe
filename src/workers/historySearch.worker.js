let items = []

self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'LOAD': {
      items = data.payload.items || []
      self.postMessage({ type: 'LOADED', count: items.length })
      break
    }
    case 'SEARCH': {
      const { query, requestId } = data.payload
      let results
      if (!query || !query.trim()) {
        results = items
      } else {
        const q = query.toLowerCase()
        results = items.filter(h =>
          h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)
        )
      }
      self.postMessage({ type: 'RESULTS', requestId, results })
      break
    }
    case 'INVALIDATE': {
      items = []
      break
    }
  }
}
