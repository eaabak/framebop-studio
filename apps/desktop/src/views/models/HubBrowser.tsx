/**
 * Hugging Face as a source: search, page through results, inspect a
 * repository's files and licence, and add it only when an engine in this
 * build can run it. Every request is made because the user searched or
 * opened something; results are not reviewed by Framebop.
 */
import {
  GENERATION_CATEGORIES,
  type GenerationCategory,
  type HubKit,
  type HubModelDetails,
  type HubSearchResult,
  MODEL_PART_ROLES,
  type ModelPart,
} from "@framebop/core";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Heart,
  Lock,
  Plus,
  Search,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, Spinner, cx } from "../../components/ui";
import { bridge } from "../../lib/bridge";
import { useStudio } from "../../store/studio";
import {
  CATEGORY_LABELS,
  DetailBlock,
  Facts,
  ModelArt,
  formatCount,
  useOpenWebPage,
} from "./shared";
import { currentLanguage, formatBytes, t } from "../../i18n";

type Sort = "downloads" | "likes" | "trending" | "recent";

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : t("models:huggingFaceCouldNotBeSearched");
}

function ResultCard({
  result,
  onOpen,
}: {
  result: HubSearchResult;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-stretch overflow-hidden card-surface rounded-xl border text-left transition-colors hover:border-accent/50 focus-visible:border-accent focus-visible:outline-none"
      >
        <ModelArt
          family={result.author}
          category={result.category}
          className="w-20 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          <div className="flex items-center gap-2">
            <span className="truncate text-ui font-semibold text-fg">
              {result.id}
            </span>
            {result.gated && (
              <Badge tone="warn">
                <Lock className="mr-1 size-3" aria-hidden />
                {t("models:gated")}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-dim">
            <span>
              {result.category
                ? CATEGORY_LABELS[result.category]
                : (result.pipelineTag ?? t("models:noTaskStated"))}
            </span>
            <span className="flex items-center gap-1">
              <Download className="size-3" aria-hidden />
              {formatCount(result.downloads)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="size-3" aria-hidden />
              {formatCount(result.likes)}
            </span>
            <span>
              {result.license
                ? t("models:licence", { license: result.license })
                : t("models:noLicenceStated")}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

type Role = ModelPart["role"];

const ROLE_LABELS: Record<Role, () => string> = {
  model: () => t("models:roleModel"),
  "diffusion-model": () => t("models:roleDiffusionModel"),
  "high-noise-diffusion-model": () => t("models:roleHighNoise"),
  vae: () => t("models:roleVae"),
  t5xxl: () => t("models:roleT5xxl"),
  llm: () => t("models:roleLlm"),
  clip_l: () => t("models:roleClipL"),
  clip_g: () => t("models:roleClipG"),
  clip_vision: () => t("models:roleClipVision"),
};

/**
 * For a repository of separate weights: which file does what, starting
 * from Framebop's guess, and whether the result makes pictures or clips.
 */
function KitPicker({
  details,
  onAdded,
}: {
  details: HubModelDetails;
  onAdded: (modelId: string) => void;
}) {
  const importFromHub = useStudio((state) => state.importFromHub);
  const hardware = useStudio((state) => state.hardware);
  const refreshHardware = useStudio((state) => state.refreshHardware);
  const { candidates } = details.support;
  const [roles, setRoles] = useState<Record<string, Role | null>>(() =>
    Object.fromEntries(
      candidates.map((file) => [file.path, file.suggested ? file.role : null]),
    ),
  );
  const [task, setTask] = useState<HubKit["task"]>(
    details.support.task ?? "image",
  );
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!hardware) void refreshHardware(false);
  }, [hardware, refreshHardware]);

  const chosen = candidates.flatMap((file) => {
    const role = roles[file.path];
    return role ? [{ path: file.path, role, sizeBytes: file.sizeBytes }] : [];
  });
  const size = chosen.reduce((sum, part) => sum + part.sizeBytes, 0);
  const mains = chosen.filter(
    (part) => part.role === "model" || part.role === "diffusion-model",
  ).length;
  const twice = new Set(chosen.map((part) => part.role)).size !== chosen.length;
  const problem =
    mains !== 1
      ? t("models:kitNeedsMain")
      : twice
        ? t("models:kitRoleTwice")
        : null;
  // Suggested and recognised files first; the rest stay available.
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      Number(b.role !== null) - Number(a.role !== null) ||
      a.path.localeCompare(b.path),
  );

  return (
    <DetailBlock title={t("models:kitTitle")}>
      <p className="text-xs leading-5 text-fg-muted">{t("models:kitIntro")}</p>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        {t("models:kitMakes")}
        <select
          className="control w-auto text-xs"
          value={task}
          onChange={(event) => setTask(event.target.value as HubKit["task"])}
        >
          <option value="image">{t("models:kitPictures")}</option>
          <option value="image_to_video">{t("models:kitClips")}</option>
        </select>
      </label>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line bg-canvas/40 text-xs">
        {ordered.map((file) => (
          <li
            key={file.path}
            className={cx(
              "flex items-center gap-3 px-3 py-1.5",
              roles[file.path] && "bg-accent/5",
            )}
          >
            <select
              aria-label={file.path}
              className="control w-48 shrink-0 text-xs"
              value={roles[file.path] ?? ""}
              onChange={(event) =>
                setRoles({
                  ...roles,
                  [file.path]: (event.target.value || null) as Role | null,
                })
              }
            >
              <option value="">{t("models:kitNotUsed")}</option>
              {MODEL_PART_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]()}
                </option>
              ))}
            </select>
            <span
              data-selectable
              className="min-w-0 flex-1 truncate font-mono text-fg"
            >
              {file.path}
            </span>
            <span className="shrink-0 text-2xs text-fg-dim">
              {formatBytes(file.sizeBytes)}
            </span>
          </li>
        ))}
      </ul>
      {hardware && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("models:kitMemory", {
            size: formatBytes(size),
            memory: formatBytes(hardware.memory.totalBytes),
          })}
        </p>
      )}
      {problem && <p className="text-2xs leading-4 text-warn">{problem}</p>}
      <div>
        <Button
          variant="primary"
          icon={Plus}
          busy={adding}
          disabled={problem !== null}
          onClick={async () => {
            setAdding(true);
            const added = await importFromHub(details.id, {
              task,
              parts: chosen.map(({ path, role }) => ({ path, role })),
            });
            setAdding(false);
            if (added) onAdded(added.entry.id);
          }}
        >
          {t("models:kitAdd", { size: formatBytes(size) })}
        </Button>
      </div>
    </DetailBlock>
  );
}

function HubDetailsView({
  repoId,
  onBack,
  onOpenModel,
}: {
  repoId: string;
  onBack: () => void;
  onOpenModel: (modelId: string) => void;
}) {
  const importFromHub = useStudio((state) => state.importFromHub);
  const open = useOpenWebPage();
  const [details, setDetails] = useState<HubModelDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let current = true;
    setDetails(null);
    setError(null);
    bridge
      .call("hub.model", { repoId })
      .then((result) => current && setDetails(result))
      .catch((reason: unknown) => current && setError(messageOf(reason)));
    return () => {
      current = false;
    };
  }, [repoId]);

  const selected = new Set(details?.support.selectedFiles ?? []);
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 self-start text-xs text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />{" "}
        {t("models:searchResults")}
      </button>
      {error ? (
        <EmptyState
          compact
          icon={WifiOff}
          title={t("models:couldNotLoadThisRepository")}
          description={error}
        />
      ) : !details ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <>
          <header className="flex overflow-hidden card-surface rounded-xl border">
            <ModelArt
              family={details.author}
              category={details.category}
              className="w-36 shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-fg">
                    {details.id}
                  </h2>
                  <p className="text-xs text-fg-muted">
                    {details.category
                      ? CATEGORY_LABELS[details.category]
                      : (details.pipelineTag ?? t("models:noTaskStated"))}{" "}
                    {t("models:downloadsLikesFromHuggingFaceNot", {
                      downloads: formatCount(details.downloads),
                      likes: formatCount(details.likes),
                    })}
                  </p>
                </div>
                <Badge
                  tone={
                    details.support.state === "importable" ||
                    details.support.state === "kit"
                      ? "ok"
                      : details.support.state === "registry"
                        ? "accent"
                        : "neutral"
                  }
                >
                  {details.support.state === "importable"
                    ? t("models:runnableInFramebop")
                    : details.support.state === "kit"
                      ? t("models:chooseItsParts")
                      : details.support.state === "registry"
                        ? t("models:inYourModels")
                        : t("models:noFramebopRuntime")}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-fg-muted">
                {details.support.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                {details.support.state === "importable" && (
                  <Button
                    variant="primary"
                    icon={Plus}
                    busy={adding}
                    onClick={async () => {
                      setAdding(true);
                      const added = await importFromHub(details.id);
                      setAdding(false);
                      if (added) onOpenModel(added.entry.id);
                    }}
                  >
                    {t("models:addToMyModels", {
                      selectedBytes: formatBytes(details.support.selectedBytes),
                    })}
                  </Button>
                )}
                {details.support.state === "registry" &&
                  details.support.registryIds[0] && (
                    <Button
                      variant="primary"
                      onClick={() =>
                        onOpenModel(details.support.registryIds[0] ?? "")
                      }
                    >
                      {t("models:openInTheGallery")}
                    </Button>
                  )}
                <Button
                  variant="ghost"
                  icon={ExternalLink}
                  onClick={() => void open(details.url)}
                >
                  {t("models:openOnHuggingFace")}
                </Button>
              </div>
            </div>
          </header>

          {details.support.state === "kit" && (
            <KitPicker details={details} onAdded={onOpenModel} />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <DetailBlock title={t("models:licenceAndAccess")}>
              <Facts
                items={[
                  [
                    t("models:licence2"),
                    details.license ?? t("models:notStated"),
                  ],
                  [t("models:name"), details.licenseName ?? "—"],
                  [
                    t("models:access"),
                    details.gated
                      ? t("models:gatedNeedsAnApprovedAccount")
                      : t("models:public"),
                  ],
                  [
                    t("models:library"),
                    details.library ?? t("models:notStated"),
                  ],
                ]}
              />
              <p className="text-2xs leading-4 text-fg-dim">
                {t("models:asDeclaredInTheRepositoryS")}
              </p>
            </DetailBlock>
            <DetailBlock title={t("models:revision")}>
              <Facts
                items={[
                  [
                    t("models:commit"),
                    <span className="font-mono" title={details.sha}>
                      {details.sha.slice(0, 12)}
                    </span>,
                  ],
                  [
                    t("models:lastChanged"),
                    details.lastModified
                      ? new Date(details.lastModified).toLocaleDateString(
                          currentLanguage(),
                        )
                      : t("models:notStated"),
                  ],
                  [t("models:files"), String(details.files.length)],
                  [
                    t("models:wholeRepository"),
                    formatBytes(details.totalBytes),
                  ],
                ]}
              />
              <p className="text-2xs leading-4 text-fg-dim">
                {details.support.state === "importable" ||
                details.support.state === "kit"
                  ? t("models:addingPinsTheModelToThis")
                  : t("models:shownForReferenceNothingCanBe")}
              </p>
            </DetailBlock>
          </div>

          <DetailBlock
            title={t("models:files2", { details: details.files.length })}
          >
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line bg-canvas/40 text-xs">
              {details.files.map((file) => (
                <li
                  key={file.path}
                  className={cx(
                    "flex items-center justify-between gap-3 px-3 py-1.5",
                    selected.has(file.path) && "bg-accent/5",
                  )}
                >
                  <span
                    data-selectable
                    className="min-w-0 truncate font-mono text-fg"
                  >
                    {file.path}
                  </span>
                  <span className="shrink-0 text-2xs text-fg-dim">
                    {selected.has(file.path) && (
                      <span className="mr-2 text-accent">
                        {t("models:needed")}
                      </span>
                    )}
                    {file.sizeBytes === null
                      ? t("models:sizeUnknown")
                      : formatBytes(file.sizeBytes)}
                    {file.sha256 && t("models:lfs")}
                  </span>
                </li>
              ))}
            </ul>
          </DetailBlock>
        </>
      )}
    </div>
  );
}

export function HubBrowser({
  onOpenModel,
}: {
  onOpenModel: (modelId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<GenerationCategory | null>(
    "text-to-speech",
  );
  const [sort, setSort] = useState<Sort>("downloads");
  const [results, setResults] = useState<HubSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<
    "idle" | "loading" | "more" | "ready" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const request = useRef(0);

  // Typing waits for a pause before anything is sent.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const id = ++request.current;
    setState("loading");
    setError(null);
    bridge
      .call("hub.search", { query: debounced, category, sort, cursor: null })
      .then((page) => {
        if (id !== request.current) return;
        setResults(page.results);
        setCursor(page.nextCursor);
        setState("ready");
      })
      .catch((reason: unknown) => {
        if (id !== request.current) return;
        setResults([]);
        setCursor(null);
        setError(messageOf(reason));
        setState("error");
      });
  }, [debounced, category, sort]);

  const loadMore = async () => {
    if (!cursor) return;
    const id = ++request.current;
    setState("more");
    try {
      const page = await bridge.call("hub.search", {
        query: debounced,
        category,
        sort,
        cursor,
      });
      if (id !== request.current) return;
      setResults((current) => [
        ...current,
        ...page.results.filter((r) => !current.some((c) => c.id === r.id)),
      ]);
      setCursor(page.nextCursor);
      setState("ready");
    } catch (reason) {
      if (id !== request.current) return;
      setError(messageOf(reason));
      setState("error");
    }
  };

  if (repo) {
    return (
      <HubDetailsView
        repoId={repo}
        onBack={() => setRepo(null)}
        onOpenModel={onOpenModel}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-2xs leading-4 text-fg-dim">
        {t("models:searchingSendsYourSearchWordsTo")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="control flex min-w-64 flex-1 items-center gap-2">
          <Search className="size-3.5 shrink-0 text-fg-dim" aria-hidden />
          <input
            aria-label={t("models:searchHuggingFace")}
            placeholder={t("models:searchHuggingFaceModels")}
            value={query}
            spellCheck={false}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-dim"
          />
        </div>
        <select
          aria-label={t("models:task")}
          className="control w-auto"
          value={category ?? ""}
          onChange={(event) =>
            setCategory(
              (event.target.value || null) as GenerationCategory | null,
            )
          }
        >
          <option value="">{t("models:anyTask")}</option>
          {GENERATION_CATEGORIES.filter((item) => item !== "other").map(
            (item) => (
              <option key={item} value={item}>
                {CATEGORY_LABELS[item]}
              </option>
            ),
          )}
        </select>
        <select
          aria-label={t("models:sort")}
          className="control w-auto"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="downloads">{t("models:mostDownloaded")}</option>
          <option value="likes">{t("models:mostLiked")}</option>
          <option value="trending">{t("models:trending")}</option>
          <option value="recent">{t("models:newest")}</option>
        </select>
      </div>

      {state === "loading" ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : state === "error" && results.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong py-8">
          <EmptyState
            compact
            icon={WifiOff}
            title={t("models:huggingFaceDidNotAnswer")}
            description={error ?? ""}
          />
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong py-8">
          <EmptyState
            compact
            icon={Search}
            title={t("models:noModelsFound")}
            description={t("models:tryOtherWordsOrAnotherTask")}
          />
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2">
            {results.map((result) => (
              <ResultCard
                key={result.id}
                result={result}
                onOpen={() => setRepo(result.id)}
              />
            ))}
          </ul>
          {error && <p className="text-2xs text-danger">{error}</p>}
          {cursor && (
            <Button
              className="self-center"
              busy={state === "more"}
              onClick={() => void loadMore()}
            >
              {t("models:loadMore")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
