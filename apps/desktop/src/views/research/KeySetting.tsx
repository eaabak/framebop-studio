import { YouTubeApiKeySchema } from "@framebop/core";
import { KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button } from "../../components/ui";
import { confirm } from "../../lib/dialogs";
import { useResearch } from "../../store/research";
import { t } from "../../i18n";

/**
 * The YouTube Data API key used by Video DNA Lab. The key is sent once to
 * the engine, which keeps it in the system's secure storage; it is never
 * shown again or kept by the interface.
 */
export function YouTubeKeySetting() {
  const status = useResearch((state) => state.keyStatus);
  const refreshKey = useResearch((state) => state.refreshKey);
  const setKey = useResearch((state) => state.setKey);
  const clearKey = useResearch((state) => state.clearKey);
  const busy = useResearch((state) => state.busy.key ?? false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshKey();
  }, [refreshKey]);

  async function save() {
    const parsed = YouTubeApiKeySchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? t("research:thatKeyIsNotValid"),
      );
      return;
    }
    setError(null);
    if (await setKey(parsed.data)) setDraft("");
  }

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-ui text-fg">{t("research:youtubeDataApiKey")}</div>
        {status &&
          (status.configured ? (
            <Badge tone="ok">
              {status.source === "secure-storage"
                ? t("research:saved")
                : status.source === "session"
                  ? t("research:thisSessionOnly")
                  : t("research:fromTheEnvironment")}
            </Badge>
          ) : (
            <Badge>{t("research:notSet")}</Badge>
          ))}
      </div>
      <p className="text-2xs leading-4 text-fg-dim">
        {t("research:videoDnaLabUsesYourOwn")}
      </p>
      {status && (
        <p className="text-2xs leading-4 text-fg-muted">{status.note}</p>
      )}
      {status?.source !== "environment" && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input
            aria-label={t("research:youtubeDataApiKey")}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="control flex-1 font-mono"
            placeholder={
              status?.configured
                ? t("research:enterANewKeyToReplace")
                : t("research:aiza")
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="submit"
            icon={KeyRound}
            busy={busy}
            disabled={!draft.trim()}
          >
            {t("research:saveKey")}
          </Button>
          {status?.configured && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("research:removeTheYoutubeApiKey"),
                    message: t("research:itIsDeletedFromSecureStorage"),
                    confirmLabel: t("research:removeKey"),
                    tone: "danger",
                  })
                ) {
                  await clearKey();
                }
              }}
            >
              {t("research:remove")}
            </Button>
          )}
        </form>
      )}
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  );
}
