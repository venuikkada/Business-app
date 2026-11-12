import { useI18n, type Lang } from "../i18n";
import { patch } from "../lib/api";

const LABELS: Record<Lang, string> = { en: "English", hi: "हिन्दी", te: "తెలుగు", hinglish: "Hinglish" };

export function LanguagePicker({ compact, saveToProfile }: { compact?: boolean; saveToProfile?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      aria-label={t("lang.label")}
      value={lang}
      style={compact ? { width: "auto", minHeight: 36, padding: "4px 8px" } : undefined}
      onChange={(e) => {
        const l = e.target.value as Lang;
        setLang(l);
        if (saveToProfile) patch("/me", { language: l }).catch(() => {});
      }}
    >
      {(Object.keys(LABELS) as Lang[]).map((l) => (
        <option key={l} value={l}>{LABELS[l]}</option>
      ))}
    </select>
  );
}
