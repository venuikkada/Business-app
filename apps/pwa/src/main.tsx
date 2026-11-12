import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { SessionProvider } from "./lib/session";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
);

// Installable PWA + opens offline. Only in production builds (avoids stale dev caches).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
