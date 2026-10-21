import { useState, useCallback, useRef } from 'react'

export function useTabStore() {
  const counter = useRef(0)
  const nextId = () => `tab_${++counter.current}_${Date.now()}`

  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)

  const addTab = useCallback((id, url = '') => {
    const tab = { id, url, title: 'New Tab', favicon: null, loading: false, canGoBack: false, canGoForward: false }
    setTabs(prev => [...prev, tab])
    setActiveId(id)
  }, [])

  const removeTab = useCallback((id) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      return next
    })
    setActiveId(prev => {
      if (prev !== id) return prev
      const remaining = tabs.filter(t => t.id !== id)
      return remaining.length ? remaining[remaining.length - 1].id : null
    })
  }, [tabs])

  const updateTab = useCallback((id, patch) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  return { tabs, activeId, setActiveId, addTab, removeTab, updateTab, nextId }
}
