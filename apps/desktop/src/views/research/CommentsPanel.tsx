import type {
  Comment,
  CommentOrder,
  ReferenceVideoDetail,
} from "@framebop/core";
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  MessageSquareOff,
  MessagesSquare,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  IconButton,
  Spinner,
  cx,
} from "../../components/ui";
import { EngineError, bridge } from "../../lib/bridge";
import { confirm } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { useOpenWebPage } from "../models/shared";
import { Provenance, formatDate, formatNumber } from "./shared";
import { t } from "../../i18n";

const PAGE = 50;
type Sort = "youtube" | "likes" | "newest";

function OrderSelect({
  value,
  onChange,
}: {
  value: CommentOrder;
  onChange(value: CommentOrder): void;
}) {
  return (
    <select
      aria-label={t("research:orderToFetchCommentsIn")}
      className="control h-7 w-auto py-0 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value as CommentOrder)}
    >
      <option value="relevance">{t("research:youtubeSRelevanceOrder")}</option>
      <option value="time">{t("research:newestFirst")}</option>
    </select>
  );
}

function CommentRow({
  comment,
  videoId,
}: {
  comment: Comment;
  videoId: string;
}) {
  const cited = useResearch((state) =>
    state.citations.some((item) => item.targetId === comment.id),
  );
  const toggleCitation = useResearch((state) => state.toggleCitation);
  const openWebPage = useOpenWebPage();
  return (
    <li className={cx("flex gap-3 px-3 py-2.5", cited && "bg-accent/5")}>
      <div className="min-w-0 flex-1">
        <p
          data-selectable
          className="text-xs leading-5 whitespace-pre-wrap text-fg"
        >
          {comment.text}
        </p>
        <p className="mt-1 text-2xs text-fg-dim">
          {comment.likeCount !== null &&
            t("research:likes", {
              count: comment.likeCount,
              formatted: formatNumber(comment.likeCount),
            })}
          {comment.replyCount !== null &&
            t("research:replies", {
              count: comment.replyCount,
              formatted: formatNumber(comment.replyCount),
            })}
          {comment.publishedAt && formatDate(comment.publishedAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-start gap-0.5">
        <IconButton
          label={
            cited
              ? t("research:removeFromTheEvidenceForA")
              : t("research:useAsEvidenceForANote")
          }
          icon={cited ? BookmarkCheck : Bookmark}
          size="sm"
          active={cited}
          onClick={() =>
            toggleCitation({
              kind: "comment",
              targetId: comment.id,
              label: comment.text.slice(0, 80),
            })
          }
        />
        <IconButton
          label={t("research:openThisCommentOnYoutube")}
          icon={ExternalLink}
          size="sm"
          onClick={() =>
            void openWebPage(
              `https://www.youtube.com/watch?v=${videoId}&lc=${encodeURIComponent(comment.commentId)}`,
            )
          }
        />
      </div>
    </li>
  );
}

export function CommentsPanel({ detail }: { detail: ReferenceVideoDetail }) {
  const fetchComments = useResearch((state) => state.fetchComments);
  const clearComments = useResearch((state) => state.clearComments);
  const busy = useResearch((state) => state.busy.comments ?? false);
  const keyConfigured = useResearch(
    (state) => state.keyStatus?.configured ?? false,
  );
  const version = useResearch((state) => state.commentsVersion);
  const sample = detail.commentSample;
  const [order, setOrder] = useState<CommentOrder>(
    sample?.order ?? "relevance",
  );
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("youtube");
  const [page, setPage] = useState<{
    comments: Comment[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const referenceVideoId = detail.video.id;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    bridge
      .call("research.comments.list", {
        referenceVideoId,
        query: search,
        sort,
        offset: 0,
        limit: PAGE,
      })
      .then((result) => current && setPage(result))
      .catch(
        (caught: unknown) =>
          current &&
          setError(
            caught instanceof EngineError
              ? caught.message
              : t("research:commentsCouldNotBeLoaded"),
          ),
      )
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [referenceVideoId, search, sort, version]);

  async function showMore() {
    if (!page) return;
    setLoading(true);
    try {
      const more = await bridge.call("research.comments.list", {
        referenceVideoId,
        query: search,
        sort,
        offset: page.comments.length,
        limit: PAGE,
      });
      setPage({
        comments: [...page.comments, ...more.comments],
        total: more.total,
      });
    } catch (caught) {
      setError(
        caught instanceof EngineError
          ? caught.message
          : t("research:commentsCouldNotBeLoaded"),
      );
    } finally {
      setLoading(false);
    }
  }

  const topics = detail.findings
    .filter((finding) => finding.kind === "comment-topic")
    .map((finding) => ({
      word: /“(.+)”/.exec(finding.title)?.[1] ?? "",
      statement: finding.statement,
    }))
    .filter((topic) => topic.word);

  if (!sample) {
    return (
      <div className="card-surface rounded-xl border">
        <EmptyState
          icon={MessagesSquare}
          title={t("research:noCommentsRetrieved")}
          description={
            keyConfigured
              ? t("research:fetchPublicTopLevelCommentsFrom")
              : t("research:commentsCanOnlyComeFromThe")
          }
          action={
            keyConfigured && (
              <>
                <OrderSelect value={order} onChange={setOrder} />
                <Button
                  variant="primary"
                  icon={MessagesSquare}
                  busy={busy}
                  onClick={() => void fetchComments("start", order)}
                >
                  {t("research:fetch100Comments")}
                </Button>
              </>
            )
          }
        />
      </div>
    );
  }

  if (sample.status === "comments-disabled") {
    return (
      <div className="card-surface rounded-xl border">
        <EmptyState
          icon={MessageSquareOff}
          title={t("research:commentsAreTurnedOff")}
          description={t("research:youtubeReportedOnThatThisVideo", {
            updatedAt: formatDate(sample.updatedAt),
          })}
          action={
            keyConfigured && (
              <Button
                icon={RotateCcw}
                busy={busy}
                onClick={() => void fetchComments("start", order)}
              >
                {t("research:checkAgain")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 card-surface rounded-xl border p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-ui text-fg">
            {t("research:comments3", {
              storedCount: formatNumber(sample.storedCount),
            })}
            {sample.reportedTotal !== null && (
              <span className="text-fg-muted">
                {" "}
                {t("research:ofPublic", {
                  reportedTotal: formatNumber(sample.reportedTotal),
                })}
              </span>
            )}
            <span className="text-fg-dim">
              {" "}
              ·{" "}
              {sample.order === "relevance"
                ? t("research:youtubeSRelevanceOrder")
                : t("research:newestFirst2")}{" "}
              ·{" "}
              {sample.status === "complete"
                ? t("research:allRetrieved")
                : t("research:moreAvailable")}
            </span>
          </p>
          <Provenance
            source="youtube-data-api"
            at={sample.updatedAt}
            extra={
              <span>
                {t("research:quotaUnitsSoFar", { count: sample.pagesFetched })}
              </span>
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sample.status === "more-available" && keyConfigured && (
            <Button
              variant="primary"
              size="sm"
              busy={busy}
              onClick={() => void fetchComments("more")}
            >
              {t("research:load100More")}
            </Button>
          )}
          {keyConfigured && (
            <>
              <OrderSelect value={order} onChange={setOrder} />
              <Button
                size="sm"
                icon={RotateCcw}
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t("research:startOver2"),
                      message: t("research:theStoredCommentsAreReplacedBy"),
                      confirmLabel: t("research:startOver"),
                    })
                  ) {
                    await fetchComments("start", order);
                  }
                }}
              >
                {t("research:startOver")}
              </Button>
            </>
          )}
          <IconButton
            tone="danger"
            label={t("research:deleteTheStoredComments")}
            icon={Trash2}
            size="sm"
            onClick={async () => {
              if (
                await confirm({
                  title: t("research:deleteTheStoredComments2"),
                  message: t("research:theyAreRemovedFromThisProject"),
                  confirmLabel: t("research:deleteComments"),
                  tone: "danger",
                })
              ) {
                await clearComments();
              }
            }}
          />
        </div>
      </div>

      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-fg-dim">
            {t("research:sharedWords")}
          </span>
          {topics.map((topic) => (
            <button
              key={topic.word}
              type="button"
              title={topic.statement}
              onClick={() => setQuery(query === topic.word ? "" : topic.word)}
              className={cx(
                "rounded-full border px-2 py-0.5 text-2xs transition-colors",
                query === topic.word
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line-strong text-fg-muted hover:text-fg",
              )}
            >
              {topic.word}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-dim"
            aria-hidden
          />
          <input
            aria-label={t("research:searchTheStoredComments")}
            className="control pl-8"
            placeholder={t("research:searchTheStoredComments")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label={t("research:sortComments")}
          className="control w-auto"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="youtube">{t("research:asRetrieved")}</option>
          <option value="likes">{t("research:mostLiked")}</option>
          <option value="newest">{t("research:newest")}</option>
        </select>
      </div>

      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : !page ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : page.total === 0 ? (
        <p className="py-6 text-center text-xs text-fg-dim">
          {search
            ? t("research:noStoredCommentContains", { search })
            : t("research:noCommentsWereReturned")}
        </p>
      ) : (
        <>
          <p className="text-2xs text-fg-dim">
            {search
              ? t("research:contain", {
                  total: formatNumber(page.total),
                  search,
                })
              : `${formatNumber(page.total)} stored`}{" "}
            {t("research:showing", {
              page: formatNumber(page.comments.length),
            })}
          </p>
          <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
            {page.comments.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                videoId={detail.video.videoId}
              />
            ))}
          </ul>
          {page.comments.length < page.total && (
            <Button
              className="self-center"
              size="sm"
              busy={loading}
              onClick={() => void showMore()}
            >
              {t("research:showMore", {
                pAGE: Math.min(PAGE, page.total - page.comments.length),
              })}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
