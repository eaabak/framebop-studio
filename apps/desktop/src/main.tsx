// The typeface ships inside the app bundle. Nothing is fetched at runtime.
import "@fontsource-variable/inter";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startLanguage } from "./i18n";

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing from index.html.");

// The interface's language is known before anything is drawn, so the
// first screen never flashes in another language.
void startLanguage().then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
