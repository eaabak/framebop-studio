import type { StudioTab } from "@framebop/core";
import {
  AlertCircle,
  Boxes,
  Check,
  ChevronDown,
  Clapperboard,
  ClipboardList,
  Dna,
  FileText,
  FolderOpen,
  type LucideIcon,
  Stethoscope,
  MonitorPlay,
  Rocket,
  Settings,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../lib/bridge";
import { openPanel } from "../lib/dialogs";
import { clientOs } from "../lib/platform";
import { useStudio } from "../store/studio";
import { IconButton, Spinner, cx } from "./ui";
import { t } from "../i18n";
import { LogoMark, Wordmark } from "./Logo";

const TABS: { id: StudioTab; label: string; icon: LucideIcon }[] = [
  {
    id: "projects",
    get label() {
      return t("navigation:projects");
    },
    icon: FolderOpen,
  },
  {
    id: "script",
    get label() {
      return t("navigation:script");
    },
    icon: FileText,
  },
  {
    id: "scenes",
    get label() {
      return t("navigation:scenes");
    },
    icon: Clapperboard,
  },
  {
    id: "blueprint",
    get label() {
      return t("navigation:blueprint");
    },
    icon: ClipboardList,
  },
  {
    id: "production",
    get label() {
      return t("navigation:production");
    },
    icon: MonitorPlay,
  },
  {
    id: "export",
    get label() {
      return t("navigation:export");
    },
    icon: Rocket,
  },
  {
    id: "doctor",
    get label() {
      return t("navigation:doctor");
    },
    icon: Stethoscope,
  },
  {
    id: "models",
    get label() {
      return t("navigation:models");
    },
    icon: Boxes,
  },
  {
    id: "research",
    get label() {
      return t("navigation:videoDna");
    },
    icon: Dna,
  },
];

// On macOS the window has no title bar of its own: the traffic lights float
// over the top-left of this bar, so content starts to their right.
const overlaysTrafficLights = bridge.mode === "desktop" && clientOs === "macos";

function SaveIndicator() {
  const saveState = useStudio((state) => state.saveState);
  const flush = useStudio((state) => state.flush);

  if (saveState === "error") {
    return (
      <button
        type="button"
        onClick={() => void flush()}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10"
      >
        <AlertCircle className="size-3.5" aria-hidden />
        {t("navigation:notSavedRetry")}
      </button>
    );
  }
  return (
    <div
      className="flex items-center gap-1.5 px-2 text-xs text-fg-dim"
      role="status"
      aria-live="polite"
    >
      {saveState === "saved" ? (
        <>
          <Check className="size-3.5" aria-hidden />
          {t("navigation:saved")}
        </>
      ) : (
        <>
          <Spinner className="size-3.5" />
          {t("navigation:saving")}
        </>
      )}
    </div>
  );
}

/** The main road through an episode, in order; everything else is a tool. */
const MAIN: { id: StudioTab; step: number | null }[] = [
  { id: "projects", step: null },
  { id: "script", step: 1 },
  { id: "scenes", step: 2 },
  { id: "export", step: 3 },
];

const TOOLS: {
  id: StudioTab;
  description: () => string;
}[] = [
  { id: "blueprint", description: () => t("navigation:toolBlueprint") },
  { id: "production", description: () => t("navigation:toolProduction") },
  { id: "models", description: () => t("navigation:toolModels") },
  { id: "research", description: () => t("navigation:toolResearch") },
  { id: "doctor", description: () => t("navigation:toolDoctor") },
];

/** Planning, jobs, models, research and inspection, out of the main road. */
function ToolsMenu() {
  const tab = useStudio((state) => state.tab);
  const setTab = useStudio((state) => state.setTab);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const current = TOOLS.find((tool) => tool.id === tab);
  const currentEntry = current
    ? TABS.find((item) => item.id === current.id)
    : null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs leading-none font-medium whitespace-nowrap transition-colors max-[1180px]:px-2",
          current
            ? "bg-accent/15 text-fg shadow-[inset_0_0_0_1px_rgb(255_122_31/0.45)]"
            : "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
        )}
      >
        <Wrench className="size-3.5" aria-hidden />
        <span className="max-[1180px]:sr-only">
          {currentEntry ? currentEntry.label : t("navigation:tools")}
        </span>
        <ChevronDown className="size-3 text-fg-dim" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="glass-menu absolute right-0 top-9 z-30 flex w-72 flex-col gap-0.5 rounded-xl border p-1.5 whitespace-normal"
        >
          {TOOLS.map((tool) => {
            const entry = TABS.find((item) => item.id === tool.id);
            if (!entry) return null;
            const Icon = entry.icon;
            return (
              <button
                key={tool.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTab(tool.id);
                  setOpen(false);
                }}
                className={cx(
                  "flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.06]",
                  tab === tool.id && "bg-accent/10",
                )}
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-accent"
                  aria-hidden
                />
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-fg">
                    {entry.label}
                  </span>
                  <span className="text-2xs leading-4 text-fg-dim">
                    {tool.description()}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const tab = useStudio((state) => state.tab);
  const setTab = useStudio((state) => state.setTab);

  return (
    <header
      data-tauri-drag-region
      className={cx(
        "glass-bar relative z-10 flex h-12 shrink-0 items-center justify-between pr-3",
        overlaysTrafficLights ? "pl-[88px]" : "pl-4",
      )}
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <LogoMark tile={false} className="pointer-events-none size-6" />
        <Wordmark className="pointer-events-none text-[15px]" />
      </div>

      <nav
        aria-label={t("navigation:workspaces")}
        className="glass absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border p-1 whitespace-nowrap"
      >
        {MAIN.map(({ id, step }) => {
          const entry = TABS.find((item) => item.id === id);
          if (!entry) return null;
          const { label, icon: Icon } = entry;
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              title={label}
              onClick={() => setTab(id)}
              className={cx(
                // Labels stay on one line in every language; in a narrow
                // window only the icons show, with the label as a tooltip.
                "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs leading-none font-medium whitespace-nowrap transition-colors duration-150 max-[1180px]:px-2",
                active
                  ? "bg-accent/15 text-fg shadow-[inset_0_0_0_1px_rgb(255_122_31/0.45),0_2px_10px_-2px_rgb(255_122_31/0.35)]"
                  : "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
              )}
            >
              {step ? (
                <span
                  aria-hidden
                  className={cx(
                    "flex size-4 items-center justify-center rounded-full text-[10px] font-semibold",
                    active
                      ? "bg-accent text-black"
                      : "bg-white/10 text-fg-muted",
                  )}
                >
                  {step}
                </span>
              ) : (
                <Icon
                  className={cx("size-3.5", active && "text-accent")}
                  strokeWidth={2}
                  aria-hidden
                />
              )}
              <span className="max-[1180px]:sr-only">
                {id === "export" ? t("navigation:video") : label}
              </span>
            </button>
          );
        })}
        <ToolsMenu />
      </nav>

      <div className="flex items-center gap-1">
        <SaveIndicator />
        <IconButton
          label={t("navigation:settings")}
          icon={Settings}
          onClick={() => openPanel("settings")}
        />
      </div>
    </header>
  );
}
