/**
 * The Framebop registry as a gallery: search, filters and cards. Every card
 * shows the one status from the engine (`gallery.status`); nothing here
 * decides whether a model works.
 */
import {
  GENERATION_CATEGORIES,
  type GalleryStatus,
  type GenerationCategory,
  type ModelStatus,
} from "@framebop/core";
import { LayoutGrid, List, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, cx } from "../../components/ui";
import { useStudio } from "../../store/studio";
import { CATEGORY_LABELS, GalleryBadge, ModelArt } from "./shared";
import { currentLanguage, formatBytes, t } from "../../i18n";

type HardwareFilter = "any" | "usable" | "possible" | "hide-unsupported";
type Sort = "recommended" | "name" | "size-asc" | "size-desc" | "checked";

/** Recommended order: what works first, what cannot work last. */
const STATUS_RANK: Record<GalleryStatus, number> = {
  ready: 0,
  downloading: 1,
  "installed-runtime-missing": 2,
  external: 3,
  "verification-failed": 4,
  compatible: 5,
  "compatibility-unknown": 6,
  insufficient: 7,
  unsupported: 8,
};

const HARDWARE_FILTERS: Record<
  HardwareFilter,
  { label: string; keep: (status: ModelStatus) => boolean }
> = {
  any: {
    get label() {
      return t("models:anyHardware");
    },
    keep: () => true,
  },
  usable: {
    get label() {
      return t("models:readyToUseNow");
    },
    keep: (status) => status.gallery.status === "ready",
  },
  possible: {
    get label() {
      return t("models:notRuledOutForThisComputer");
    },
    keep: (status) =>
      !["insufficient", "unsupported"].includes(status.gallery.status),
  },
  "hide-unsupported": {
    get label() {
      return t("models:hideUnsupported");
    },
    keep: (status) => status.gallery.status !== "unsupported",
  },
};

function ModelCard({
  status,
  layout,
  onOpen,
}: {
  status: ModelStatus;
  layout: "grid" | "list";
  onOpen: () => void;
}) {
  const { entry } = status;
  const category = entry.categories[0] ?? null;
  const facts = [
    entry.quantization ?? entry.variant,
    entry.format.toUpperCase(),
    formatBytes(status.downloadSizeBytes),
  ];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          "group flex w-full overflow-hidden rounded-xl border border-line bg-raised text-left transition-colors duration-150 hover:border-line-strong hover:bg-overlay/60 focus-visible:border-accent focus-visible:outline-none",
          layout === "grid" ? "flex-col" : "flex-row items-stretch",
        )}
      >
        <ModelArt
          family={entry.family}
          category={category}
          className={layout === "grid" ? "h-24 w-full" : "w-28 shrink-0"}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-ui font-semibold text-fg">
                {entry.name}
              </h3>
              <p className="truncate text-2xs text-fg-dim">
                {entry.family} · {entry.provider || entry.repoId.split("/")[0]}
                {entry.origin === "imported" && t("models:importedByYou2")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {entry.categories.map((item) => (
              <Badge key={item}>{CATEGORY_LABELS[item]}</Badge>
            ))}
          </div>
          <p className="text-2xs text-fg-muted">
            {facts.join(" · ")} · {entry.license.name}
          </p>
          <div className="mt-auto flex flex-col gap-1">
            <GalleryBadge status={status} />
            <p className="line-clamp-2 text-2xs leading-4 text-fg-dim">
              {status.gallery.reason}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

export function Gallery({ onOpen }: { onOpen: (modelId: string) => void }) {
  const models = useStudio((state) => state.models);
  const registry = useStudio((state) => state.registryStatus);
  const refreshRegistry = useStudio((state) => state.refreshRegistry);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GenerationCategory | null>(null);
  const [hardware, setHardware] = useState<HardwareFilter>("any");
  const [origin, setOrigin] = useState<"all" | "registry" | "imported">("all");
  const [sort, setSort] = useState<Sort>("recommended");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [refreshing, setRefreshing] = useState(false);

  const counts = useMemo(() => {
    const result = new Map<GenerationCategory, number>();
    for (const status of models) {
      for (const item of status.entry.categories) {
        result.set(item, (result.get(item) ?? 0) + 1);
      }
    }
    return result;
  }, [models]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = models.filter(({ entry, ...status }) => {
      if (category && !entry.categories.includes(category)) return false;
      if (origin !== "all" && entry.origin !== origin) return false;
      if (!HARDWARE_FILTERS[hardware].keep({ entry, ...status })) return false;
      if (!needle) return true;
      return [
        entry.name,
        entry.family,
        entry.provider,
        entry.repoId,
        entry.variant,
        entry.description,
        entry.runtime.name,
        ...entry.categories.map((item) => CATEGORY_LABELS[item]),
      ].some((text) => text.toLowerCase().includes(needle));
    });
    const byName = (a: ModelStatus, b: ModelStatus) =>
      a.entry.name.localeCompare(b.entry.name);
    return [...matches].sort((a, b) => {
      switch (sort) {
        case "name":
          return byName(a, b);
        case "size-asc":
          return a.downloadSizeBytes - b.downloadSizeBytes;
        case "size-desc":
          return b.downloadSizeBytes - a.downloadSizeBytes;
        case "checked":
          return b.entry.verifiedOn.localeCompare(a.entry.verifiedOn);
        default:
          return (
            STATUS_RANK[a.gallery.status] - STATUS_RANK[b.gallery.status] ||
            byName(a, b)
          );
      }
    });
  }, [models, query, category, hardware, origin, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="control flex min-w-64 flex-1 items-center gap-2">
          <Search className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
          <input
            aria-label={t("models:searchModels")}
            placeholder={t("models:searchByNameFamilyCapabilityOr")}
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-dim"
          />
        </div>
        <select
          aria-label={t("models:hardware")}
          className="control w-auto"
          value={hardware}
          onChange={(event) =>
            setHardware(event.target.value as HardwareFilter)
          }
        >
          {Object.entries(HARDWARE_FILTERS).map(([value, filter]) => (
            <option key={value} value={value}>
              {filter.label}
            </option>
          ))}
        </select>
        <select
          aria-label={t("models:source2")}
          className="control w-auto"
          value={origin}
          onChange={(event) => setOrigin(event.target.value as typeof origin)}
        >
          <option value="all">{t("models:allSources")}</option>
          <option value="registry">{t("models:framebopRegistry")}</option>
          <option value="imported">{t("models:importedByYou")}</option>
        </select>
        <select
          aria-label={t("models:sort")}
          className="control w-auto"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="recommended">{t("models:recommended")}</option>
          <option value="name">{t("models:name")}</option>
          <option value="size-asc">{t("models:smallestDownload")}</option>
          <option value="size-desc">{t("models:largestDownload")}</option>
          <option value="checked">{t("models:mostRecentlyChecked")}</option>
        </select>
        <div
          role="group"
          aria-label={t("models:layout")}
          className="flex rounded-md border border-line bg-canvas p-0.5"
        >
          {(
            [
              ["grid", LayoutGrid, t("models:grid")],
              ["list", List, t("models:list")],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              aria-label={label}
              title={label}
              onClick={() => setLayout(value)}
              className={cx(
                "flex size-7 items-center justify-center rounded",
                layout === value
                  ? "bg-overlay text-fg"
                  : "text-fg-dim hover:text-fg",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div
        role="group"
        aria-label={t("models:category")}
        className="flex flex-wrap gap-1.5"
      >
        {[null, ...GENERATION_CATEGORIES].map((item) => {
          const count = item ? (counts.get(item) ?? 0) : models.length;
          return (
            <button
              key={item ?? "all"}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={cx(
                "rounded-full border px-3 py-1 text-2xs font-medium transition-colors",
                category === item
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-line-strong text-fg-muted hover:text-fg",
                count === 0 && category !== item && "opacity-50",
              )}
            >
              {item ? CATEGORY_LABELS[item] : t("models:all")}{" "}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong py-8">
          <EmptyState
            compact
            icon={Search}
            title={t("models:noModelMatches")}
            description={
              models.length === 0
                ? t("models:theRegistryIsEmpty")
                : t("models:tryAnotherSearchOrFewerFilters")
            }
          />
        </div>
      ) : (
        <ul
          className={cx(
            layout === "grid"
              ? "grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3"
              : "flex flex-col gap-2",
          )}
        >
          {shown.map((status) => (
            <ModelCard
              key={status.entry.id}
              status={status}
              layout={layout}
              onOpen={() => onOpen(status.entry.id)}
            />
          ))}
        </ul>
      )}

      {registry && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/60 px-4 py-3 text-2xs text-fg-dim">
          <span>
            {t("models:framebopRegistry2", {
              registryVersion: registry.registryVersion,
            })}{" "}
            {registry.source === "remote"
              ? t("models:fetchedAt", {
                  date: registry.fetchedAt
                    ? new Date(registry.fetchedAt).toLocaleString(
                        currentLanguage(),
                      )
                    : "",
                })
              : t("models:theCopyThatShipsWithThe")}{" "}
            {t("models:reviewedModelCount", { count: registry.modelCount })}
            {registry.importedCount > 0 &&
              t("models:importedByYou3", {
                importedCount: registry.importedCount,
              })}
            {t("models:everyEntryIsPinnedToAn")}
            {registry.lastError && (
              <span className="block text-warn">{registry.lastError}</span>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            busy={refreshing}
            disabled={!registry.remoteUrl}
            title={
              registry.remoteUrl
                ? t("models:fetch", { remoteUrl: registry.remoteUrl })
                : t("models:noRegistryAddressIsSetA")
            }
            onClick={async () => {
              setRefreshing(true);
              await refreshRegistry();
              setRefreshing(false);
            }}
          >
            {t("models:checkForRegistryUpdates")}
          </Button>
        </div>
      )}
    </div>
  );
}
