import {
  type ExternalModel,
  type HardwareInventory,
  type ModelInstallation,
  type ModelSource,
  type ModelStatus,
  isActiveInstallation,
} from "@framebop/core";
import {
  Cpu,
  Download,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  Inbox,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ProgressBar,
  Spinner,
  cx,
} from "../components/ui";
import { type RuntimeTarget, useStudio } from "../store/studio";
import { Gallery } from "./models/Gallery";
import { HubBrowser } from "./models/HubBrowser";
import { ModelDetails } from "./models/ModelDetails";
import { Facts, STATE_LABELS, useReveal } from "./models/shared";
import { currentLanguage, formatBytes, t } from "../i18n";

type ModelsTab = "discover" | "installed" | "downloads" | "hardware";

function InstallationBadge({ status }: { status: ModelStatus }) {
  const installation = status.installation;
  if (!installation) {
    return status.external.length > 0 ? (
      <Badge>{t("models:foundElsewhere")}</Badge>
    ) : (
      <Badge>{t("models:notInstalled")}</Badge>
    );
  }
  const tone =
    installation.state === "installed"
      ? installation.verification === "failed"
        ? "danger"
        : "ok"
      : installation.state === "failed"
        ? "danger"
        : installation.state === "interrupted" ||
            installation.state === "cancelled"
          ? "warn"
          : "accent";
  return <Badge tone={tone}>{STATE_LABELS[installation.state]}</Badge>;
}

function CompatibilityBadge({ status }: { status: ModelStatus }) {
  const { compatibility } = status;
  if (compatibility.status === "compatible") {
    return <Badge tone="ok">{t("models:compatible")}</Badge>;
  }
  if (compatibility.status === "incompatible") {
    return <Badge tone="danger">{t("models:notCompatible")}</Badge>;
  }
  return <Badge>{t("models:compatibilityUnknown")}</Badge>;
}

function RunnableBadge({ status }: { status: ModelStatus }) {
  return status.runnability.runnable ? (
    <Badge tone="ok">{t("models:runnable")}</Badge>
  ) : (
    <Badge tone="warn">{t("models:notRunnable")}</Badge>
  );
}

/**
 * Discover: the Framebop registry as a gallery, or Hugging Face as a
 * community source, and a model's full details.
 */
function DiscoverTab() {
  const models = useStudio((state) => state.models);
  const hardware = useStudio((state) => state.hardware);
  const refreshHardware = useStudio((state) => state.refreshHardware);
  const [source, setSource] = useState<"registry" | "hub">("registry");
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = models.find((status) => status.entry.id === openId) ?? null;

  // Compatibility explanations name the detected hardware.
  useEffect(() => {
    if (!hardware) void refreshHardware(false);
  }, [hardware, refreshHardware]);

  const openModel = (modelId: string) => {
    setSource("registry");
    setOpenId(modelId);
  };

  if (opened) {
    return (
      <ModelDetails
        status={opened}
        onBack={() => setOpenId(null)}
        onOpen={setOpenId}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("models:modelSource")}
          className="flex rounded-md border border-line bg-canvas p-0.5"
        >
          {(
            [
              ["registry", ShieldCheck, t("models:framebopVerified")],
              ["hub", Globe, t("models:huggingFace")],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={source === value}
              onClick={() => setSource(value)}
              className={cx(
                "flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors",
                source === value
                  ? "bg-overlay text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <p className="text-2xs text-fg-dim">
          {source === "registry"
            ? t("models:reviewedModelsPinnedToExactCommits")
            : t("models:communityModelsFromHuggingFaceMost")}
        </p>
      </div>
      {source === "registry" ? (
        <Gallery onOpen={openModel} />
      ) : (
        <HubBrowser onOpenModel={openModel} />
      )}
    </div>
  );
}

// --------------------------------------------------------------- installed

function StorageSection() {
  const storage = useStudio((state) => state.modelStorage);
  const changeModelStorage = useStudio((state) => state.changeModelStorage);
  const downloading = useStudio((state) =>
    state.models.some(
      (status) =>
        status.installation && isActiveInstallation(status.installation),
    ),
  );
  const reveal = useReveal();
  if (!storage) return null;

  return (
    <section aria-labelledby="storage-heading">
      <h2 id="storage-heading" className="eyebrow mb-3">
        {t("models:modelStorage")}
      </h2>
      <div className="flex flex-col gap-3 card-surface rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-fg-dim">
            <HardDrive className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p
              data-selectable
              className="truncate text-xs text-fg"
              title={storage.modelsRoot}
            >
              {storage.modelsRoot}
            </p>
            <p className="text-2xs text-fg-dim">
              {storage.isDefaultRoot
                ? t("models:defaultLocationInsideTheLibraryFolder")
                : t("models:customLocation")}{" "}
              {t("models:newDownloadsGoHereModelsAlready")}
            </p>
          </div>
        </div>
        <Facts
          items={[
            [
              t("models:freeSpace"),
              storage.availableBytes === null
                ? t("models:unknown")
                : formatBytes(storage.availableBytes),
            ],
            [t("models:installedModels"), formatBytes(storage.managedBytes)],
            [
              t("models:unfinishedDownloads"),
              formatBytes(storage.partialBytes),
            ],
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={FolderOpen}
            onClick={() => void reveal(storage.modelsRoot)}
          >
            {t("models:showFolder")}
          </Button>
          <Button
            size="sm"
            disabled={downloading}
            title={
              downloading ? t("models:waitForTheDownloadToFinish") : undefined
            }
            onClick={() => void changeModelStorage(false)}
          >
            {t("models:changeLocation")}
          </Button>
          {!storage.isDefaultRoot && (
            <Button
              size="sm"
              variant="ghost"
              disabled={downloading}
              onClick={() => void changeModelStorage(true)}
            >
              {t("models:useDefaultLocation")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function InstalledModelRow({ status }: { status: ModelStatus }) {
  const verifyModel = useStudio((state) => state.verifyModel);
  const removeModel = useStudio((state) => state.removeModel);
  const [checking, setChecking] = useState(false);
  const reveal = useReveal();
  const installation = status.installation!;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ui font-medium text-fg">
              {status.entry.name}
            </span>
            {installation.verification === "verified" ? (
              <Badge tone="ok">
                <ShieldCheck className="mr-1 size-3" aria-hidden />
                {t("models:verified")}
              </Badge>
            ) : (
              <Badge tone="danger">{t("models:filesDoNotMatch")}</Badge>
            )}
            <CompatibilityBadge status={status} />
            <RunnableBadge status={status} />
          </div>
          <p
            data-selectable
            className="mt-0.5 truncate text-2xs text-fg-dim"
            title={installation.directory}
          >
            {formatBytes(installation.bytesTotal)} · {installation.directory}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={!status.runnability.runnable}
            title={
              status.runnability.runnable
                ? t("models:chooseItInASceneS")
                : status.runnability.reason
            }
          >
            {t("models:useWithAnEngine")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={ShieldCheck}
            busy={checking}
            title={t("models:hashEveryFileAgainAndCompare")}
            onClick={() => {
              setChecking(true);
              void verifyModel(status.entry.id).finally(() =>
                setChecking(false),
              );
            }}
          >
            {t("models:checkFiles")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={FolderOpen}
            onClick={() => void reveal(installation.directory)}
          >
            {t("models:showFiles")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            onClick={() => void removeModel(status.entry.id)}
          >
            {t("models:remove")}
          </Button>
        </div>
      </div>
      {installation.error && (
        <p className="text-2xs leading-4 text-danger">
          {installation.error.message}
        </p>
      )}
    </li>
  );
}

/** Runtimes and voice packs Framebop downloaded for itself, which it can delete. */
function RuntimesSection() {
  const runtimes = useStudio((state) => state.runtimes);
  const refreshRuntimes = useStudio((state) => state.refreshRuntimes);
  const removeRuntime = useStudio((state) => state.removeRuntime);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    void refreshRuntimes();
  }, [refreshRuntimes]);
  if (!runtimes) return null;

  // The engine refuses voice removals while a voice is being installed.
  const voiceBusy = runtimes.voice.progress !== null;
  const items: {
    key: string;
    name: string;
    kind: string;
    installing: boolean;
    bytes: number | null;
    detail: string | null;
    target: RuntimeTarget;
    busy: boolean;
  }[] = [
    ...(
      [
        ["image", runtimes.image, t("models:imageRuntime"), false],
        ["llm", runtimes.llm, t("models:languageModelRuntime"), false],
        ["voice", runtimes.voice.runtime, t("models:voiceRuntime"), voiceBusy],
      ] as const
    )
      .filter(([, status]) =>
        ["installed", "installing"].includes(status.state),
      )
      .map(([target, status, kind, busy]) => ({
        key: target,
        name: `${status.name} ${status.version}`,
        kind,
        installing: status.state === "installing",
        bytes: status.installedBytes,
        detail: status.path,
        target,
        busy,
      })),
    ...runtimes.voice.packs
      .filter((pack) => pack.state !== "not-installed")
      .map((pack) => ({
        key: `pack-${pack.id}`,
        name: pack.name,
        kind: t("models:voicePack"),
        installing: pack.state === "installing",
        bytes: pack.installedBytes,
        detail: pack.license,
        target: { packId: pack.id },
        busy: voiceBusy,
      })),
  ];

  return (
    <section aria-labelledby="framebop-runtimes-heading">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id="framebop-runtimes-heading" className="eyebrow">
          {t("models:runtimesAndVoices")}
        </h2>
        <span className="text-2xs text-fg-dim">
          {t("models:runtimesAndVoicesNote")}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong py-5">
          <EmptyState
            compact
            icon={Inbox}
            title={t("models:noRuntimesInstalled")}
            description={t("models:runtimesAreOfferedWhenNeeded")}
          />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui font-medium text-fg">
                    {item.name}
                  </span>
                  <Badge>{item.kind}</Badge>
                  {item.installing && (
                    <Badge tone="accent">{t("models:runtimeInstalling")}</Badge>
                  )}
                </div>
                <p
                  data-selectable
                  className="mt-0.5 truncate text-2xs text-fg-dim"
                  title={item.detail ?? undefined}
                >
                  {[
                    item.bytes === null ? null : formatBytes(item.bytes),
                    item.detail,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                busy={removing === item.key}
                disabled={item.installing || item.busy}
                title={
                  item.installing || item.busy
                    ? t("models:waitForTheInstallationToFinish")
                    : undefined
                }
                onClick={() => {
                  setRemoving(item.key);
                  void removeRuntime(item.target).finally(() =>
                    setRemoving(null),
                  );
                }}
              >
                {t("models:remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceRow({
  source,
  models,
}: {
  source: ModelSource;
  models: ExternalModel[];
}) {
  const removeModelSource = useStudio((state) => state.removeModelSource);
  const catalog = useStudio((state) => state.models);
  const reveal = useReveal();
  const nameOf = (modelId: string) =>
    catalog.find((status) => status.entry.id === modelId)?.entry.name ??
    modelId;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-ui font-medium text-fg">{source.label}</span>
            <Badge>{t("models:externalReadOnly")}</Badge>
          </div>
          <p
            data-selectable
            className="truncate text-2xs text-fg-dim"
            title={source.path}
          >
            {source.path}
            {source.lastScannedAt &&
              t("models:scanned", {
                toLocaleString: new Date(source.lastScannedAt).toLocaleString(
                  currentLanguage(),
                ),
              })}
          </p>
          {source.lastError && (
            <p className="text-2xs text-danger">{source.lastError}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={FolderOpen}
            onClick={() => void reveal(source.path)}
          >
            {t("models:showFolder")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={X}
            title={t("models:stopScanningThisFolderNothingIn")}
            onClick={() => void removeModelSource(source)}
          >
            {t("models:stopWatching")}
          </Button>
        </div>
      </div>
      {models.length === 0 ? (
        <p className="text-2xs text-fg-dim">
          {t("models:noModelFilesFoundOnlyFiles")}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-canvas/40">
          {models.map((model) => (
            <li
              key={model.id}
              className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
            >
              <span className="min-w-0">
                <span
                  data-selectable
                  className="block truncate text-fg"
                  title={model.path}
                >
                  {model.name}
                </span>
                <span className="block text-2xs text-fg-dim">
                  {model.format.toUpperCase()} · {formatBytes(model.sizeBytes)}
                  {model.revision && ` · ${model.revision.slice(0, 8)}`}
                  {model.matchedModelId &&
                    t("models:sameAs", {
                      matchedModelId: nameOf(model.matchedModelId),
                    })}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={FolderOpen}
                onClick={() => void reveal(model.path)}
              >
                {t("models:show")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function InstalledTab() {
  const models = useStudio((state) => state.models);
  const sources = useStudio((state) => state.modelSources);
  const external = useStudio((state) => state.externalModels);
  const storage = useStudio((state) => state.modelStorage);
  const addModelSource = useStudio((state) => state.addModelSource);
  const scanModelSources = useStudio((state) => state.scanModelSources);
  const [scanning, setScanning] = useState(false);

  const installed = models.filter(
    (status) => status.installation?.state === "installed",
  );
  const cache = storage?.huggingFaceCache;
  const cacheAdded = sources.some(
    (source) => source.kind === "huggingface-cache",
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="managed-heading">
        <h2 id="managed-heading" className="eyebrow mb-3">
          {t("models:installedByFramebop")}
        </h2>
        {installed.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong py-5">
            <EmptyState
              compact
              icon={Inbox}
              title={t("models:noModelsInstalled")}
              description={t("models:downloadAModelFromDiscoverIt")}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
            {installed.map((status) => (
              <InstalledModelRow key={status.entry.id} status={status} />
            ))}
          </ul>
        )}
      </section>

      <RuntimesSection />

      <StorageSection />

      <section aria-labelledby="external-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="external-heading" className="eyebrow">
              {t("models:foundElsewhere")}
            </h2>
            <span className="text-2xs text-fg-dim">
              {t("models:readOnlyFramebopNeverMovesChanges")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {sources.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon={RefreshCw}
                busy={scanning}
                onClick={() => {
                  setScanning(true);
                  void scanModelSources().finally(() => setScanning(false));
                }}
              >
                {t("models:scanAgain")}
              </Button>
            )}
            {cache?.exists && !cacheAdded && (
              <Button
                size="sm"
                onClick={() =>
                  void addModelSource("huggingface-cache", cache.path)
                }
              >
                {t("models:addHuggingFaceCache")}
              </Button>
            )}
            {storage?.suggestedFolders.map((folder) => (
              <Button
                key={folder.path}
                size="sm"
                title={`${folder.path}. ${folder.note}`}
                onClick={() => void addModelSource("folder", folder.path)}
              >
                {t("models:addModels", { application: folder.application })}
              </Button>
            ))}
            <Button
              size="sm"
              icon={FolderPlus}
              onClick={() => void addModelSource("folder")}
            >
              {t("models:addFolder")}
            </Button>
          </div>
        </div>
        {sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong py-5">
            <EmptyState
              compact
              icon={FolderPlus}
              title={t("models:noFoldersAdded")}
              description={t("models:addAFolderWhereAnotherApplication")}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                models={external.filter(
                  (model) => model.sourceId === source.id,
                )}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// --------------------------------------------------------------- downloads

/** Bytes per second, measured from the progress updates the view receives. */
function useMeasuredRate(installation: ModelInstallation): number | null {
  const samples = useRef<{ at: number; bytes: number }[]>([]);
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    if (installation.state !== "downloading") {
      samples.current = [];
      setRate(null);
      return;
    }
    const now = performance.now();
    const list = samples.current.filter((sample) => now - sample.at < 5000);
    list.push({ at: now, bytes: installation.bytesDone });
    samples.current = list;
    const first = list[0]!;
    const elapsed = (now - first.at) / 1000;
    setRate(
      elapsed >= 1 ? (installation.bytesDone - first.bytes) / elapsed : null,
    );
  }, [installation.bytesDone, installation.state]);

  return rate;
}

function ActiveDownload({
  status,
  installation,
}: {
  status: ModelStatus;
  installation: ModelInstallation;
}) {
  const cancelModelDownload = useStudio((state) => state.cancelModelDownload);
  const rate = useMeasuredRate(installation);
  const fraction =
    installation.bytesTotal > 0
      ? installation.bytesDone / installation.bytesTotal
      : null;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">
              {status.entry.name}
            </h3>
            <InstallationBadge status={status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {installation.state === "queued"
              ? t("models:waitingForTheCurrentDownloadTo")
              : installation.state === "verifying"
                ? t("models:checkingTheFilesAgainstTheirPublished")
                : (installation.currentFile ?? t("models:starting"))}
          </p>
        </div>
        <Button
          icon={X}
          onClick={() => void cancelModelDownload(status.entry.id)}
        >
          {t("models:cancel")}
        </Button>
      </div>
      <ProgressBar
        value={installation.state === "verifying" ? null : fraction}
      />
      <div className="flex items-baseline justify-between gap-4 text-xs text-fg-muted">
        <span>
          {t("models:of", {
            bytesDone: formatBytes(installation.bytesDone),
            bytesTotal: formatBytes(installation.bytesTotal),
          })}
          {fraction !== null && ` · ${Math.floor(fraction * 100)}%`}
        </span>
        {rate !== null && rate > 0 && <span>{formatBytes(rate)}/s</span>}
      </div>
    </li>
  );
}

function StoppedDownload({
  status,
  installation,
}: {
  status: ModelStatus;
  installation: ModelInstallation;
}) {
  const retryModelDownload = useStudio((state) => state.retryModelDownload);
  const removeModel = useStudio((state) => state.removeModel);
  const kept = installation.bytesDone > 0 && installation.state !== "cancelled";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-ui font-medium text-fg">
              {status.entry.name}
            </span>
            <InstallationBadge status={status} />
          </div>
          <p className="mt-0.5 text-2xs text-fg-dim">
            {kept
              ? t("models:ofKeptSoItContinuesFrom", {
                  bytesDone: formatBytes(installation.bytesDone),
                  bytesTotal: formatBytes(installation.bytesTotal),
                })
              : t("models:toDownload", {
                  bytesTotal: formatBytes(installation.bytesTotal),
                })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            icon={RotateCcw}
            onClick={() => void retryModelDownload(status.entry.id)}
          >
            {kept ? t("models:resume") : t("models:downloadAgain")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            title={t("models:deleteWhatWasDownloadedAndForget")}
            onClick={() => void removeModel(status.entry.id)}
          >
            {t("models:discard")}
          </Button>
        </div>
      </div>
      {installation.error && (
        <p className="text-2xs leading-4 text-danger">
          {installation.error.message}
        </p>
      )}
    </li>
  );
}

function DownloadsTab() {
  const models = useStudio((state) => state.models);
  const withInstallation = models.flatMap((status) =>
    status.installation ? [{ status, installation: status.installation }] : [],
  );
  const active = withInstallation.filter(({ installation }) =>
    isActiveInstallation(installation),
  );
  const stopped = withInstallation.filter(({ installation }) =>
    ["failed", "cancelled", "interrupted"].includes(installation.state),
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="active-downloads-heading">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 id="active-downloads-heading" className="eyebrow">
            {t("models:inProgress")}
          </h2>
          <span className="text-2xs text-fg-dim">
            {t("models:oneModelDownloadsAtATime")}
          </span>
        </div>
        {active.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong py-5">
            <EmptyState
              compact
              icon={Download}
              title={t("models:nothingIsDownloading")}
              description={t("models:downloadsStartOnlyWhenYouApprove")}
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map(({ status, installation }) => (
              <ActiveDownload
                key={installation.id}
                status={status}
                installation={installation}
              />
            ))}
          </ul>
        )}
      </section>

      {stopped.length > 0 && (
        <section aria-labelledby="stopped-downloads-heading">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 id="stopped-downloads-heading" className="eyebrow">
              {t("models:stopped")}
            </h2>
            <span className="text-2xs text-fg-dim">
              {t("models:interruptedAndFailedDownloadsKeepWhat")}
            </span>
          </div>
          <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
            {stopped.map(({ status, installation }) => (
              <StoppedDownload
                key={installation.id}
                status={status}
                installation={installation}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- hardware

function describeGpuMemory(gpu: HardwareInventory["gpus"][number]): string {
  if (gpu.memory.kind === "unified") {
    return t("models:sharedWithTheSystemUnifiedMemory");
  }
  if (gpu.memory.bytes !== null) return formatBytes(gpu.memory.bytes);
  return t("models:notReported");
}

function HardwareTab() {
  const hardware = useStudio((state) => state.hardware);
  const hardwareState = useStudio((state) => state.hardwareState);
  const refreshHardware = useStudio((state) => state.refreshHardware);

  useEffect(() => {
    if (!hardware) void refreshHardware(false);
  }, [hardware, refreshHardware]);

  if (hardwareState === "error" && !hardware) {
    return (
      <ErrorState
        message={t("models:theHardwareCouldNotBeInspected")}
        onRetry={() => void refreshHardware(true)}
      />
    );
  }
  if (!hardware) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  const os = {
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    unknown: "Unknown",
  }[hardware.os];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="system-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="system-heading" className="eyebrow">
            {t("models:system")}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            busy={hardwareState === "loading"}
            onClick={() => void refreshHardware(true)}
          >
            {t("models:detectAgain")}
          </Button>
        </div>
        <div className="card-surface rounded-xl border p-4">
          <Facts
            items={[
              [
                t("models:operatingSystem"),
                `${os}${hardware.osVersion ? ` ${hardware.osVersion}` : ""}`,
              ],
              [t("models:architecture"), hardware.arch],
              [t("models:processor"), hardware.cpu.model],
              [t("models:cores"), String(hardware.cpu.cores)],
              [t("models:memory"), formatBytes(hardware.memory.totalBytes)],
              [
                t("models:freeSpaceForModels"),
                hardware.storage.availableBytes === null
                  ? t("models:unknown")
                  : `${formatBytes(hardware.storage.availableBytes)}${
                      hardware.storage.totalBytes === null
                        ? ""
                        : ` of ${formatBytes(hardware.storage.totalBytes)}`
                    }`,
              ],
            ]}
          />
          <p className="mt-3 text-2xs text-fg-dim">
            {t("models:detected", {
              toLocaleString: new Date(hardware.detectedAt).toLocaleString(
                currentLanguage(),
              ),
            })}
          </p>
        </div>
      </section>

      <section aria-labelledby="gpu-heading">
        <h2 id="gpu-heading" className="eyebrow mb-3">
          {t("models:graphics")}
        </h2>
        {hardware.gpus.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong py-5">
            <EmptyState
              compact
              icon={Cpu}
              title={t("models:noGraphicsProcessorDetected")}
              description={t("models:noneWasReportedByTheSystem")}
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {hardware.gpus.map((gpu, index) => (
              <li
                key={`${gpu.name}-${index}`}
                className="card-surface rounded-xl border p-4"
              >
                <Facts
                  items={[
                    [t("models:name"), gpu.name ?? t("models:notReported")],
                    [t("models:vendor"), gpu.vendor ?? t("models:notReported")],
                    [
                      t("models:computeInterface"),
                      gpu.backend === "metal"
                        ? t("models:metal")
                        : gpu.backend === "cuda"
                          ? "CUDA"
                          : gpu.backend === "rocm"
                            ? t("models:rocm")
                            : t("models:noneDetected"),
                    ],
                    [t("models:graphicsMemory"), describeGpuMemory(gpu)],
                  ]}
                />
                {gpu.memory.note && (
                  <p className="mt-2.5 text-2xs leading-4 text-fg-dim">
                    {gpu.memory.note}
                  </p>
                )}
                <p className="mt-1 text-2xs text-fg-dim">
                  {t("models:source", { source: gpu.source })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="runtimes-heading">
        <h2 id="runtimes-heading" className="eyebrow mb-3">
          {t("models:computeBackEnds")}
        </h2>
        <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
          {hardware.runtimes.map((runtime) => (
            <li key={runtime.id} className="flex items-start gap-3 px-4 py-2.5">
              {runtime.available ? (
                <Badge tone="ok">{t("models:available")}</Badge>
              ) : (
                <Badge>{t("models:notAvailable")}</Badge>
              )}
              <div className="min-w-0 text-xs">
                <span className="font-medium text-fg">
                  {runtime.name}
                  {runtime.version && ` ${runtime.version}`}
                </span>
                <p className="text-fg-muted">{runtime.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {hardware.unavailable.length > 0 && (
        <section aria-labelledby="unavailable-heading">
          <h2 id="unavailable-heading" className="eyebrow mb-3">
            {t("models:notDetermined")}
          </h2>
          <ul className="flex flex-col gap-1.5 card-surface rounded-xl border p-4 text-xs">
            {hardware.unavailable.map((item) => (
              <li key={item.field}>
                <span className="font-medium text-fg">{item.field}:</span>{" "}
                <span className="text-fg-muted">{item.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-2xs leading-4 text-fg-dim">
            {t("models:valuesThatCannotBeReadReliably")}
          </p>
        </section>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- view

export function ModelsView() {
  const [tab, setTab] = useState<ModelsTab>("discover");
  const modelsState = useStudio((state) => state.modelsState);
  const refreshModels = useStudio((state) => state.refreshModels);
  const downloading = useStudio(
    (state) =>
      state.models.filter(
        (status) =>
          status.installation && isActiveInstallation(status.installation),
      ).length,
  );

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const tabs: { id: ModelsTab; label: string; count?: number }[] = [
    { id: "discover", label: t("models:discover") },
    { id: "installed", label: t("models:installed") },
    { id: "downloads", label: t("models:downloads"), count: downloading },
    { id: "hardware", label: t("models:hardware") },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">
              {t("models:aiModels")}
            </h1>
            <p className="text-xs text-fg-muted">
              {t("models:whatIsInstalledWhatThisComputer")}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            busy={modelsState === "loading"}
            onClick={() => void refreshModels()}
          >
            {t("models:refresh")}
          </Button>
        </header>

        <div
          role="tablist"
          aria-label={t("models:modelManagerSections")}
          className="flex gap-1 border-b border-line"
        >
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cx(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-ui transition-colors",
                tab === entry.id
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {entry.label}
              {entry.count ? (
                <span className="rounded bg-accent/15 px-1 text-2xs text-accent">
                  {entry.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === "hardware" ? (
          <HardwareTab />
        ) : modelsState === "error" ? (
          <ErrorState
            message={t("models:theModelListCouldNotBe")}
            onRetry={() => void refreshModels()}
          />
        ) : modelsState !== "ready" ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : tab === "discover" ? (
          <DiscoverTab />
        ) : tab === "installed" ? (
          <InstalledTab />
        ) : (
          <DownloadsTab />
        )}
      </div>
    </div>
  );
}
