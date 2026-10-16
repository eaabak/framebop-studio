import type { EngineCapability, ModelChoice } from "@framebop/core";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  FolderPlus,
  Search,
  Wrench,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { bridge } from "../lib/bridge";
import { useStudio } from "../store/studio";
import { Button, ProgressBar, Spinner, cx } from "./ui";
import { formatBytes, t } from "../i18n";

interface ModelPickerProps {
  id: string;
  task: "image_generation" | "video_generation" | "audio_generation";
  adapterId: string;
  engineName: string;
  capability: EngineCapability;
  value: string;
  onChange: (value: string) => void;
  /** Told which listed model the value is, once the list is known. */
  onSelectedChoice?: (choice: ModelChoice | null) => void;
}

const KIND_LABELS: Record<ModelChoice["kind"], string> = {
  get engine() {
    return t("models:engine");
  },
  get installed() {
    return t("models:framebop");
  },
  get external() {
    return t("models:readOnly");
  },
  get download() {
    return t("models:download");
  },
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Changes whenever an installation starts, finishes or goes away. */
function useInstallationsKey(): string {
  return useStudio((state) =>
    state.models
      .map((status) => `${status.entry.id}:${status.installation?.state ?? ""}`)
      .join(","),
  );
}

function useModelChoices(
  task: ModelPickerProps["task"],
  adapterId: string,
  open: boolean,
) {
  const [choices, setChoices] = useState<ModelChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installations = useInstallationsKey();
  const sources = useStudio((state) => state.externalModels.length);
  const modelsState = useStudio((state) => state.modelsState);
  const refreshModels = useStudio((state) => state.refreshModels);

  // Model events update the store only once it has loaded the list.
  useEffect(() => {
    if (modelsState === "idle") void refreshModels();
  }, [modelsState, refreshModels]);

  useEffect(() => {
    let current = true;
    bridge
      .call("models.choices", { task, adapterId })
      .then((result) => {
        if (!current) return;
        setChoices(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(
          reason instanceof Error
            ? reason.message
            : t("models:theModelsCouldNotBeListed"),
        );
      });
    return () => {
      current = false;
    };
  }, [task, adapterId, installations, sources, open]);

  return { choices, error };
}

function Group({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div role="group" className="flex flex-col py-1">
      <div className="px-2.5 pt-1 pb-0.5 text-2xs font-semibold tracking-wide text-fg-dim uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  choice,
  selected,
  onPick,
}: {
  choice: ModelChoice;
  selected: boolean;
  onPick: () => void;
}) {
  const downloading =
    choice.kind === "download" &&
    choice.installationState !== null &&
    ["queued", "downloading", "verifying"].includes(choice.installationState);
  const enabled = choice.usable && !downloading;
  return (
    <button
      type="button"
      data-option
      role="option"
      aria-selected={selected}
      aria-disabled={!enabled}
      title={choice.reason}
      onClick={() => enabled && onPick()}
      className={cx(
        "flex w-full items-start gap-2 rounded px-2.5 py-1.5 text-left outline-none focus-visible:bg-overlay",
        enabled
          ? "hover:bg-overlay"
          : "cursor-default opacity-55 hover:bg-transparent",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-fg">
            {choice.name}
          </span>
          {choice.kind === "download" && (
            <CloudDownload
              className="size-3.5 shrink-0 text-fg-dim"
              aria-label={t("models:notDownloaded")}
            />
          )}
        </span>
        <span className="block truncate text-2xs text-fg-dim">
          {choice.detail}
        </span>
        {(!choice.usable || downloading) && (
          <span className="block text-2xs leading-4 text-fg-muted">
            {downloading
              ? t("models:downloadingSeeModelsDownloads")
              : choice.reason}
          </span>
        )}
      </span>
      {selected ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
      ) : (
        <span className="mt-0.5 shrink-0 text-2xs text-fg-dim">
          {KIND_LABELS[choice.kind]}
        </span>
      )}
    </button>
  );
}

const ACTIVE = ["queued", "downloading", "verifying"];

/**
 * A download started for this engine, shown under the picker while it runs,
 * so it does not vanish when the menu closes. Once the files are verified the
 * model is chosen.
 */
function DownloadProgress({
  modelId,
  choices,
  onReady,
}: {
  modelId: string;
  choices: ModelChoice[] | null;
  onReady: (reference: string) => void;
}) {
  const status = useStudio((state) =>
    state.models.find((item) => item.entry.id === modelId),
  );
  const cancelModelDownload = useStudio((state) => state.cancelModelDownload);
  const retryModelDownload = useStudio((state) => state.retryModelDownload);
  const installation = status?.installation ?? null;
  const ready = choices?.find(
    (choice) =>
      choice.modelId === modelId &&
      choice.kind !== "download" &&
      choice.usable &&
      choice.reference,
  );
  useEffect(() => {
    if (ready?.reference) onReady(ready.reference);
  }, [ready?.reference, onReady]);
  if (!status || !installation || ready) return null;
  const name = status.entry.name;
  const { state, bytesDone, bytesTotal } = installation;
  const active = ACTIVE.includes(state);
  const fraction = bytesTotal > 0 ? bytesDone / bytesTotal : null;
  return (
    <div
      role="status"
      className="flex flex-col gap-1.5 rounded-md border border-accent/30 bg-accent/5 p-2 text-2xs leading-4 text-fg-muted"
    >
      <span className="text-fg">
        {state === "verifying"
          ? t("models:pickerVerifying", { name })
          : state === "queued"
            ? t("models:pickerQueued", { name })
            : active
              ? t("models:pickerDownloading", {
                  name,
                  done: formatBytes(bytesDone),
                  total: formatBytes(bytesTotal),
                  percent: fraction === null ? 0 : Math.floor(fraction * 100),
                })
              : t("models:pickerStopped", {
                  name,
                  message: installation.error?.message ?? "",
                })}
      </span>
      {active && (
        <ProgressBar value={state === "downloading" ? fraction : null} />
      )}
      <div className="flex gap-1.5">
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void cancelModelDownload(modelId)}
          >
            {t("models:cancelDownload")}
          </Button>
        ) : (
          state !== "installed" && (
            <Button size="sm" onClick={() => void retryModelDownload(modelId)}>
              {t("models:resume")}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Chooses the model for a generation engine, in the manner of a native app's
 * model menu: searchable, with what is on this computer first and what can be
 * downloaded after. Models the engine cannot use are listed with the reason
 * instead of being hidden.
 */
export function ModelPicker({
  id,
  task,
  adapterId,
  engineName,
  capability,
  value,
  onChange,
  onSelectedChoice,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showUnusable, setShowUnusable] = useState(false);
  const { choices, error } = useModelChoices(task, adapterId, open);
  const models = useStudio((state) => state.models);
  const installModel = useStudio((state) => state.installModel);
  const addModelSource = useStudio((state) => state.addModelSource);
  const setTab = useStudio((state) => state.setTab);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Engines without a list of their own also take a name they know.
  const acceptsNames = capability.models.length === 0;

  const selected = choices?.find((choice) => choice.reference === value);
  const label = selected?.name ?? (value ? fileName(value) : null);

  useEffect(() => {
    if (choices) onSelectedChoice?.(selected ?? null);
    // Reported when the selection or the list changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, value]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (choices ?? []).filter(
      (choice) =>
        !needle ||
        choice.name.toLowerCase().includes(needle) ||
        choice.detail.toLowerCase().includes(needle),
    );
    const local = matches.filter((choice) => choice.kind !== "download");
    return {
      usable: local.filter((choice) => choice.usable),
      unusable: local.filter((choice) => !choice.usable),
      // Models this engine can run first; the others only say why not.
      download: matches
        .filter((choice) => choice.kind === "download")
        .sort((a, b) => Number(b.usable) - Number(a.usable)),
    };
  }, [choices, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };

  const pick = (reference: string) => {
    onChange(reference);
    close();
  };

  // The download started from here, followed until its model can be chosen.
  const [started, setStarted] = useState<string | null>(null);
  const download = async (choice: ModelChoice) => {
    const status = models.find((entry) => entry.entry.id === choice.modelId);
    if (!status) return;
    await installModel(status);
    setStarted(choice.modelId);
    close();
  };
  // One already under way (started earlier, or elsewhere) is shown too.
  const following =
    started ??
    choices?.find(
      (choice) =>
        choice.kind === "download" &&
        choice.installationState !== null &&
        ACTIVE.includes(choice.installationState),
    )?.modelId ??
    null;
  const chooseDownloaded = useCallback(
    (reference: string) => {
      setStarted(null);
      if (!value) onChange(reference);
    },
    [onChange, value],
  );

  // Arrow keys move between options; Escape closes.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = [
      ...(container.current?.querySelectorAll<HTMLElement>("[data-option]") ??
        []),
    ];
    if (options.length === 0) return;
    event.preventDefault();
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(options.length - 1, at + 1)
        : Math.max(0, at - 1);
    options[at === -1 ? 0 : next]?.focus();
  };

  const typed = query.trim();
  const offerTyped =
    acceptsNames &&
    typed.length > 0 &&
    !(choices ?? []).some((choice) => choice.name === typed);

  return (
    <div
      ref={container}
      className="relative flex flex-col gap-1.5"
      onKeyDown={onKeyDown}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="control flex items-center justify-between gap-2 text-left"
      >
        <span className={cx("truncate", !label && "text-fg-dim")}>
          {label ?? t("models:chooseAModel")}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
      </button>
      {!open && selected && (
        <p className="text-2xs leading-4 text-fg-dim">{selected.detail}</p>
      )}
      {following && (
        <DownloadProgress
          modelId={following}
          choices={choices}
          onReady={chooseDownloaded}
        />
      )}

      {open && (
        <div className="glass-panel flex max-h-[26rem] flex-col overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
            <input
              ref={search}
              aria-label={t("models:searchModels")}
              placeholder={t("models:search")}
              value={query}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-dim"
            />
            {query && (
              <button
                type="button"
                aria-label={t("models:clearSearch")}
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
                className="text-fg-dim hover:text-fg"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          <div
            role="listbox"
            aria-label={t("models:models")}
            className="overflow-y-auto p-1"
          >
            <button
              type="button"
              data-option
              onClick={() => setTab("models")}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium text-fg outline-none hover:bg-overlay focus-visible:bg-overlay"
            >
              <Wrench className="size-3.5 text-fg-dim" aria-hidden />
              {t("models:manageModels")}
            </button>
            <button
              type="button"
              data-option
              onClick={() => void addModelSource("folder")}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium text-fg outline-none hover:bg-overlay focus-visible:bg-overlay"
            >
              <FolderPlus className="size-3.5 text-fg-dim" aria-hidden />
              {t("models:addAFolderWithModels")}
            </button>

            {error ? (
              <p className="px-2.5 py-2 text-2xs text-danger">{error}</p>
            ) : choices === null ? (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            ) : (
              <>
                <Group title={t("models:onThisComputer")}>
                  {groups.usable.length === 0 ? (
                    <p className="px-2.5 py-1 text-2xs leading-4 text-fg-dim">
                      {query
                        ? t("models:nothingHereMatches")
                        : t("models:nothingCanUseYetDownloadA", { engineName })}
                    </p>
                  ) : (
                    groups.usable.map((choice) => (
                      <Row
                        key={choice.key}
                        choice={choice}
                        selected={choice.reference === value}
                        onPick={() => pick(choice.reference ?? "")}
                      />
                    ))
                  )}
                </Group>

                {groups.download.length > 0 && (
                  <Group title={t("models:download")}>
                    {groups.download.map((choice) => (
                      <Row
                        key={choice.key}
                        choice={choice}
                        selected={false}
                        onPick={() => void download(choice)}
                      />
                    ))}
                  </Group>
                )}

                {offerTyped && (
                  <Group title={t("models:byName")}>
                    <button
                      type="button"
                      data-option
                      onClick={() => pick(typed)}
                      className="flex w-full flex-col rounded px-2.5 py-1.5 text-left outline-none hover:bg-overlay focus-visible:bg-overlay"
                    >
                      <span className="truncate text-xs font-medium text-fg">
                        {t("models:use", { typed })}
                      </span>
                      <span className="text-2xs leading-4 text-fg-dim">
                        {t("models:aModelAlreadyHasUnderThis", { engineName })}
                      </span>
                    </button>
                  </Group>
                )}

                {groups.unusable.length > 0 && (
                  <Group
                    title={
                      <button
                        type="button"
                        aria-expanded={showUnusable}
                        onClick={() => setShowUnusable(!showUnusable)}
                        className="flex items-center gap-1 uppercase hover:text-fg"
                      >
                        <ChevronRight
                          className={cx(
                            "size-3 transition-transform",
                            showUnusable && "rotate-90",
                          )}
                          aria-hidden
                        />
                        {t("models:cannotUse", {
                          engineName,
                          groups: groups.unusable.length,
                        })}
                      </button>
                    }
                  >
                    {showUnusable &&
                      groups.unusable.map((choice) => (
                        <Row
                          key={choice.key}
                          choice={choice}
                          selected={false}
                          onPick={() => {}}
                        />
                      ))}
                  </Group>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
