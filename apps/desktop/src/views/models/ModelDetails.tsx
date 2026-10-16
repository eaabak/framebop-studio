/**
 * One model, in full: what it is, its variants and files, the four separate
 * compatibility questions, its presets, what installing it involves, and the
 * technical facts that make it traceable to its repository.
 */
import { type ModelStatus, isActiveInstallation } from "@framebop/core";
import {
  ArrowLeft,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Button, ProgressBar } from "../../components/ui";
import { useStudio } from "../../store/studio";
import {
  CATEGORY_LABELS,
  CheckLine,
  DetailBlock,
  Facts,
  GalleryBadge,
  ModelArt,
  STATE_LABELS,
  installBlocker,
  useCopy,
  useOpenWebPage,
  useReveal,
} from "./shared";
import { formatBytes, t } from "../../i18n";

const FORMAT_NAMES = {
  onnx: "ONNX",
  safetensors: "safetensors",
  pytorch: "PyTorch",
  gguf: "GGUF",
} as const;

function Actions({ status }: { status: ModelStatus }) {
  const installModel = useStudio((state) => state.installModel);
  const cancel = useStudio((state) => state.cancelModelDownload);
  const retry = useStudio((state) => state.retryModelDownload);
  const remove = useStudio((state) => state.removeModel);
  const forgetImported = useStudio((state) => state.forgetImported);
  const useInScene = useStudio((state) => state.useModelInScene);
  const { entry, installation } = status;
  const blocker = installBlocker(status);
  const active = installation && isActiveInstallation(installation);
  const stopped =
    installation &&
    ["failed", "cancelled", "interrupted"].includes(installation.state);
  const ready = status.gallery.status === "ready";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ready && (
        <Button
          variant="primary"
          icon={Clapperboard}
          onClick={() => void useInScene(status)}
        >
          {t("models:useInAScene")}
        </Button>
      )}
      {active ? (
        <Button icon={X} onClick={() => void cancel(entry.id)}>
          {t("models:cancelDownload")}
        </Button>
      ) : stopped ? (
        <Button icon={RotateCcw} onClick={() => void retry(entry.id)}>
          {installation.state === "cancelled"
            ? t("models:downloadAgain")
            : t("models:resume")}
        </Button>
      ) : installation?.state === "installed" ? null : (
        <Button
          variant={ready ? "secondary" : "primary"}
          icon={Download}
          disabled={blocker !== null}
          title={blocker ?? undefined}
          onClick={() => void installModel(status)}
        >
          {status.external.length > 0
            ? t("models:downloadAManagedCopy")
            : t("models:install")}
        </Button>
      )}
      {installation && !active && (
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => void remove(entry.id)}
        >
          {installation.state === "installed"
            ? t("models:removeFiles")
            : t("models:discard")}
        </Button>
      )}
      {entry.origin === "imported" && !installation && (
        <Button
          variant="ghost"
          icon={X}
          title={t("models:removeThisImportedModelFromYour")}
          onClick={() => void forgetImported(entry.id)}
        >
          {t("models:removeFromMyModels")}
        </Button>
      )}
    </div>
  );
}

export function ModelDetails({
  status,
  onBack,
  onOpen,
}: {
  status: ModelStatus;
  onBack: () => void;
  onOpen: (modelId: string) => void;
}) {
  const models = useStudio((state) => state.models);
  const storage = useStudio((state) => state.modelStorage);
  const engines = useStudio((state) => state.engines);
  const hardware = useStudio((state) => state.hardware);
  const copy = useCopy();
  const open = useOpenWebPage();
  const reveal = useReveal();
  const { entry, installation, compatibility, runnability } = status;
  const variants = entry.group
    ? models.filter((other) => other.entry.group === entry.group)
    : [status];
  const category = entry.categories[0] ?? null;
  const engineName = (id: string) =>
    engines.find((engine) => engine.id === id)?.name ?? id;
  const usableEngines = runnability.adapters.filter(
    (a) => a.kind !== "unsupported",
  );
  const progress =
    installation && installation.bytesTotal > 0
      ? installation.bytesDone / installation.bytesTotal
      : null;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 self-start text-xs text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {t("models:allModels")}
      </button>

      <header className="flex overflow-hidden card-surface rounded-xl border">
        <ModelArt
          family={entry.family}
          category={category}
          className="w-40 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg">{entry.name}</h2>
              <p className="text-xs text-fg-muted">
                {entry.family} · {entry.provider || entry.repoId.split("/")[0]}{" "}
                ·{" "}
                {entry.origin === "imported"
                  ? t("models:importedByYouFromHuggingFace")
                  : t("models:framebopRegistry")}
              </p>
            </div>
            <GalleryBadge status={status} />
          </div>
          <p className="text-xs leading-5 text-fg-muted">
            {status.gallery.reason}
          </p>
          {installation && isActiveInstallation(installation) && (
            <div className="flex flex-col gap-1">
              <ProgressBar
                value={installation.state === "verifying" ? null : progress}
              />
              <span className="text-2xs text-fg-dim">
                {t("models:of2", {
                  installation: STATE_LABELS[installation.state],
                  bytesDone: formatBytes(installation.bytesDone),
                  bytesTotal: formatBytes(installation.bytesTotal),
                })}
                {installation.currentFile && ` · ${installation.currentFile}`}
              </span>
            </div>
          )}
          {installation?.error && !isActiveInstallation(installation) && (
            <p className="text-2xs text-danger">{installation.error.message}</p>
          )}
          <Actions status={status} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailBlock title={t("models:overview")}>
          <p className="text-xs leading-5 text-fg-muted">{entry.description}</p>
          <Facts
            items={[
              [
                t("models:provider"),
                entry.provider || entry.repoId.split("/")[0],
              ],
              [t("models:family"), entry.family],
              [
                t("models:capabilities"),
                entry.categories
                  .map((item) => CATEGORY_LABELS[item])
                  .join(", "),
              ],
              [t("models:licence2"), entry.license.name],
            ]}
          />
          <p className="text-xs leading-5 text-fg-muted">
            {entry.license.summary}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={ExternalLink}
              onClick={() => void open(entry.pageUrl)}
            >
              {t("models:repository")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Copy}
              onClick={() =>
                void copy(entry.license.url, t("models:licenceLink"))
              }
            >
              {t("models:copyLicenceLink")}
            </Button>
          </div>
          {entry.access.gated && (
            <p className="text-2xs leading-4 text-warn">
              {entry.access.requirements ??
                t("models:thePublisherRequiresAnAccountAnd")}
            </p>
          )}
        </DetailBlock>

        <DetailBlock title={t("models:compatibility")}>
          <ul className="flex flex-col gap-1.5">
            <CheckLine
              result={usableEngines.length > 0 ? "pass" : "fail"}
              label={t("models:files")}
              detail={
                usableEngines.length > 0
                  ? t("models:filesThatCanLoad", {
                      entry: FORMAT_NAMES[entry.format],
                      usableEngines: usableEngines
                        .map((a) => a.adapterName)
                        .join(", "),
                    })
                  : t("models:filesThatNoEngineInThis", {
                      entry: FORMAT_NAMES[entry.format],
                    })
              }
            />
            {runnability.adapters.length === 0 ? (
              <CheckLine
                result="fail"
                label={t("models:runtime")}
                detail={t("models:noEngineInThisBuildRuns", {
                  name: entry.runtime.name,
                })}
              />
            ) : (
              runnability.adapters.map((adapter) => (
                <CheckLine
                  key={adapter.adapterId}
                  result={
                    adapter.kind === "usable"
                      ? "pass"
                      : adapter.kind === "runtime-missing"
                        ? "unknown"
                        : "fail"
                  }
                  label={t("models:runtime2", {
                    adapterName: adapter.adapterName,
                  })}
                  detail={adapter.reason}
                />
              ))
            )}
            {compatibility.checks.map((check) => (
              <CheckLine
                key={check.label}
                result={check.result}
                label={check.label}
                detail={check.detail}
              />
            ))}
          </ul>
          {entry.hardware.notes.map((note) => (
            <p key={note} className="text-2xs leading-4 text-fg-dim">
              {note}
            </p>
          ))}
          <p className="text-2xs leading-4 text-fg-dim">
            {hardware
              ? t("models:checkedAgainstThisComputer", {
                  model: hardware.cpu.model,
                  totalBytes: formatBytes(hardware.memory.totalBytes),
                  os: hardware.os,
                  arch: hardware.arch,
                })
              : t("models:openTheHardwareSectionToSee")}{" "}
            {t("models:aSmallerDownloadDoesNotMean")}
          </p>
        </DetailBlock>

        <DetailBlock
          title={t("models:variants", { variants: variants.length })}
          aside={
            <span className="text-2xs text-fg-dim">
              {t("models:forThisOne", {
                downloadSizeBytes: formatBytes(status.downloadSizeBytes),
              })}
            </span>
          }
        >
          {variants.length > 1 && (
            <ul className="flex flex-col gap-1">
              {variants.map((variant) => (
                <li key={variant.entry.id}>
                  <button
                    type="button"
                    disabled={variant.entry.id === entry.id}
                    onClick={() => onOpen(variant.entry.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-left text-xs enabled:hover:border-accent/50 disabled:border-accent/40 disabled:bg-accent/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-fg">
                        {variant.entry.name}
                      </span>
                      <span className="text-2xs text-fg-dim">
                        {FORMAT_NAMES[variant.entry.format]} ·{" "}
                        {variant.entry.quantization ??
                          t("models:fullPrecision")}{" "}
                        · {formatBytes(variant.downloadSizeBytes)} ·{" "}
                        {variant.entry.runtime.name}
                      </span>
                    </span>
                    <GalleryBadge status={variant} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Facts
            items={[
              [t("models:variant"), entry.variant],
              [
                t("models:quantization"),
                entry.quantization ?? t("models:none"),
              ],
              [t("models:format"), FORMAT_NAMES[entry.format]],
              [t("models:runtime"), entry.runtime.name],
            ]}
          />
          <ul className="divide-y divide-line rounded-md border border-line bg-canvas/40 text-xs">
            {entry.files.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 px-3 py-1.5"
              >
                <span
                  data-selectable
                  className="min-w-0 truncate font-mono text-fg"
                >
                  {file.path}
                </span>
                <span className="shrink-0 text-2xs text-fg-dim">
                  {formatBytes(file.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </DetailBlock>

        <DetailBlock title={t("models:recommendedSettings")}>
          {entry.presets.length === 0 ? (
            <p className="text-xs leading-5 text-fg-muted">
              {t("models:noPresetsForThisModelFramebop")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entry.presets.map((preset) => (
                <li
                  key={preset.id}
                  className="rounded-md border border-line bg-canvas/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-fg">
                      {preset.label}
                    </span>
                    <Badge tone={preset.verified ? "ok" : "neutral"}>
                      {preset.verified
                        ? t("models:checked")
                        : t("models:notCheckedYet")}
                    </Badge>
                    <span className="text-2xs text-fg-dim">
                      {engineName(preset.adapterId)}
                    </span>
                  </div>
                  <p className="mt-1 text-2xs text-fg-muted">
                    {preset.description}
                  </p>
                  <p className="mt-1 font-mono text-2xs text-fg-dim">
                    {Object.entries(preset.parameters)
                      .map(([key, value]) => `${key} = ${String(value)}`)
                      .join(" · ")}
                    {preset.size &&
                      ` · ${preset.size.width}×${preset.size.height}`}
                  </p>
                  {preset.note && (
                    <p className="mt-1 text-2xs text-fg-dim">{preset.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-2xs leading-4 text-fg-dim">
            {t("models:presetsApplyOnlyToTheEngine")}
          </p>
        </DetailBlock>

        <DetailBlock title={t("models:installation")}>
          <Facts
            items={[
              [
                t("models:download"),
                t("models:sizeInFiles", {
                  size: formatBytes(status.downloadSizeBytes),
                  count: entry.files.length,
                }),
              ],
              [t("models:destination"), storage?.modelsRoot ?? "…"],
              [
                t("models:freeSpaceThere"),
                storage?.availableBytes != null
                  ? formatBytes(storage.availableBytes)
                  : t("models:unknown"),
              ],
              [
                t("models:access"),
                entry.access.gated
                  ? t("models:gatedNeedsAnApprovedAccount")
                  : t("models:publicNoAccountNeeded"),
              ],
            ]}
          />
          {status.external.length > 0 && (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs leading-5">
              <p className="text-fg">
                {t("models:alreadyOnThisComputerReadOnly")}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {status.external.map((copyFound) => (
                  <li key={copyFound.id} className="flex items-center gap-2">
                    <span
                      data-selectable
                      className="min-w-0 truncate text-2xs text-fg-muted"
                    >
                      {copyFound.path}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={FolderOpen}
                      onClick={() => void reveal(copyFound.path)}
                    >
                      {t("models:show")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-2xs leading-4 text-fg-dim">
            {t("models:installingAsksFirstThenDownloadsOnly")}
          </p>
          <Actions status={status} />
        </DetailBlock>

        <DetailBlock title={t("models:technical")}>
          <Facts
            items={[
              [t("models:repository"), entry.repoId],
              [
                t("models:revision"),
                <span className="font-mono" title={entry.revision}>
                  {entry.revision.slice(0, 12)}
                </span>,
              ],
              [t("models:metadataChecked"), entry.verifiedOn],
              [t("models:runtimeBackend"), entry.runtime.id],
              [
                t("models:ownership"),
                installation?.state === "installed"
                  ? t("models:managedByFramebop")
                  : status.external.length > 0
                    ? t("models:externalReadOnly2")
                    : t("models:notOnThisComputer"),
              ],
              [t("models:modelId"), entry.id],
            ]}
          />
          <ul className="flex flex-col gap-0.5 font-mono text-2xs text-fg-dim">
            {entry.files.map((file) => (
              <li key={file.path} className="truncate" data-selectable>
                {file.sha256 ? "sha256" : t("models:gitBlob")}{" "}
                {(file.sha256 ?? file.gitBlobId ?? "").slice(0, 16)}…{" "}
                {file.path}
              </li>
            ))}
          </ul>
          {installation?.state === "installed" && (
            <div className="flex items-center gap-2">
              <span
                data-selectable
                className="min-w-0 truncate text-2xs text-fg-muted"
              >
                {installation.directory}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={FolderOpen}
                onClick={() => void reveal(installation.directory)}
              >
                {t("models:showFiles")}
              </Button>
            </div>
          )}
          {entry.inferenceTests.length > 0 && (
            <ul className="flex flex-col gap-1 text-2xs leading-4 text-fg-muted">
              {entry.inferenceTests.map((test) => (
                <li key={`${test.date}-${test.os}-${test.adapterId}`}>
                  {test.result === "works"
                    ? t("models:worked")
                    : t("models:failed")}{" "}
                  {t("models:onWith", {
                    hardware: test.hardware,
                    os: test.os,
                    arch: test.arch,
                    adapterId: engineName(test.adapterId),
                    date: test.date,
                    detail: test.detail,
                  })}
                </li>
              ))}
            </ul>
          )}
        </DetailBlock>
      </div>
    </div>
  );
}
