"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type Locale, type Translate } from "@/lib/i18n";

const localeStorageKey = "zone4youbooking.locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("cs");

  useEffect(() => {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (stored === "cs" || stored === "en") setLocaleState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale(nextLocale) {
        window.localStorage.setItem(localeStorageKey, nextLocale);
        setLocaleState(nextLocale);
      },
      t: (key, variables) => translate(locale, key, variables),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within AppProviders.");
  return context;
}
