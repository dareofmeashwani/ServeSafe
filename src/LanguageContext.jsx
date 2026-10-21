import React, { createContext, useContext, useState, useEffect } from 'react'
import { locales, LANGUAGES } from './locales/index.js'

const LanguageContext = createContext({ t: locales.en, lang: 'en', changeLang: () => {}, LANGUAGES })

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState('en')

  useEffect(() => {
    window.browser?.getLanguage?.()
      .then(l => { if (l && locales[l]) setLang(l) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const locale = locales[lang] || locales.en
    document.documentElement.dir = locale.dir || 'ltr'
    document.documentElement.lang = lang
  }, [lang])

  const changeLang = async (newLang) => {
    if (!locales[newLang]) return
    await window.browser?.setLanguage?.(newLang).catch(() => {})
    setLang(newLang)
  }

  return (
    <LanguageContext.Provider value={{ t: locales[lang] || locales.en, lang, changeLang, LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useT   = () => useContext(LanguageContext).t
export const useLang = () => useContext(LanguageContext)
