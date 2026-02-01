'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { translations, Language, TranslationKeys, supportedLanguages } from './translations';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
  supportedLanguages: typeof supportedLanguages;
}

const I18nContext = createContext<I18nContextType | null>(null);

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.');
  let result: unknown = obj;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return path; // Return path as fallback
    }
  }
  return typeof result === 'string' ? result : path;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    // Load saved language preference
    const saved = localStorage.getItem('docsynth_language') as Language | null;
    if (saved && saved in translations) {
      setLanguageState(saved);
    } else {
      // Detect browser language
      const browserLang = navigator.language.split('-')[0] as Language;
      if (browserLang in translations) {
        setLanguageState(browserLang);
      }
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    if (lang in translations) {
      setLanguageState(lang);
      localStorage.setItem('docsynth_language', lang);
      document.documentElement.lang = lang;
    }
  }, []);

  const t = useMemo(() => translations[language], [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      supportedLanguages,
    }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

// Helper function for dynamic translation keys
export function useTranslation() {
  const { t, language } = useI18n();

  const translate = useCallback(
    (path: string, fallback?: string): string => {
      const result = getNestedValue(t as unknown as Record<string, unknown>, path);
      return result !== path ? result : (fallback ?? path);
    },
    [t]
  );

  return { t, translate, language };
}
