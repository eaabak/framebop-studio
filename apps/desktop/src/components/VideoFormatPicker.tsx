import { Field } from "./ui";
import { t } from "../i18n";
import { useStudio } from "../store/studio";

/** Shares the existing export orientation with native video generation. */
export function VideoFormatPicker() {
  const resolution = useStudio((s) => s.settings.exportResolution);
  const updateSettings = useStudio((s) => s.updateSettings);
  const refreshRenders = useStudio((s) => s.refreshRenders);
  return (
    <Field label={t("video:format")} hint={t("video:formatHint")}>
      {(id) => (
        <select
          id={id}
          className="control"
          value={resolution === "1080x1920" ? "portrait" : "landscape"}
          onChange={async (event) => {
            await updateSettings({
              exportResolution:
                event.target.value === "portrait" ? "1080x1920" : "1920x1080",
            });
            await refreshRenders();
          }}
        >
          <option value="landscape">{t("video:landscape")}</option>
          <option value="portrait">{t("video:portrait")}</option>
        </select>
      )}
    </Field>
  );
}
