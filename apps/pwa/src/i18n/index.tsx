import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import en from "./en.json";
import hi from "./hi.json";
import te from "./te.json";
import hinglish from "./hinglish.json";

export const LANGS = { en, hi, te, hinglish } as const;
export type Lang = keyof typeof LANGS;
export type Key = keyof typeof en;
const STORE = "cb.lang";

type T = (key: Key | string, vars?: Record<string, string | number>) => string;
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: T }>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORE) as Lang | null;
    return saved && saved in LANGS ? saved : "en";
  });
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORE, l);
    document.documentElement.lang = l === "hinglish" ? "hi-Latn" : l;
    setLangState(l);
  }, []);
  const t = useCallback<T>(
    (key, vars) => {
      let s: string = (LANGS[lang] as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** Server error -> message in the user's language (falls back to the server's English text). */
export function useErrorText() {
  const t = useT();
  // Stable between renders (screens use it inside effect dependencies).
  return useCallback(
    (e: unknown) => {
      const err = e as { code?: string; message?: string };
      const k = `err.${err?.code}`;
      const tr = t(k);
      return tr !== k ? tr : err?.message ?? t("err.server_error");
    },
    [t],
  );
}
