/**
 * Art direction in the AI Animation panel: the visual style to plan in,
 * and, for a plan, its composition and every option the renderer has. An
 * option left on Auto follows the style, and the panel shows what Auto is
 * now. Nothing here is free-form: each choice is one the composer knows.
 */
import {
  ART_STYLES,
  type AnimationBlueprint,
  type ArtStyle,
  type CapabilityInfo,
  DIRECTION_KEYS,
  DIRECTION_OPTIONS,
  type DirectionKey,
  resolveDirection,
} from "@framebop/core";
import { Field } from "../components/ui";
import { t } from "../i18n";

const STYLE_LABELS = {
  educational: "director:styleEducational",
  cinematic: "director:styleCinematic",
  playful: "director:stylePlayful",
  dramatic: "director:styleDramatic",
  premium: "director:stylePremium",
} as const satisfies Record<ArtStyle, string>;

const OPTION_LABELS = {
  subject: "director:optSubject",
  framing: "director:optFraming",
  depth: "director:optDepth",
  lighting: "director:optLighting",
  motion: "director:optMotion",
  typography: "director:optTypography",
  reveal: "director:optReveal",
  transition: "director:optTransition",
} as const satisfies Record<DirectionKey, string>;

const VALUE_LABELS = {
  small: "director:valSmall",
  medium: "director:valMedium",
  large: "director:valLarge",
  wide: "director:valWide",
  close: "director:valClose",
  flat: "director:valFlat",
  layered: "director:valLayered",
  deep: "director:valDeep",
  even: "director:valEven",
  spotlight: "director:valSpotlight",
  moody: "director:valMoody",
  calm: "director:valCalm",
  lively: "director:valLively",
  bold: "director:valBold",
  clean: "director:valClean",
  kinetic: "director:valKinetic",
  cinematic: "director:valCinematic",
  simple: "director:valSimple",
  build: "director:valBuild",
  dramatic: "director:valDramatic",
  cut: "director:valCut",
  fade: "director:valFade",
  slide: "director:valSlide",
} as const;
type Value = keyof typeof VALUE_LABELS;

/** The style a new plan is made in. */
export function StylePicker({
  value,
  onChange,
}: {
  value: ArtStyle;
  onChange: (style: ArtStyle) => void;
}) {
  return (
    <Field label={t("director:styleLabel")}>
      {(id) => (
        <select
          id={id}
          className="control"
          value={value}
          onChange={(event) => onChange(event.target.value as ArtStyle)}
        >
          {ART_STYLES.map((style) => (
            <option key={style} value={style}>
              {t(STYLE_LABELS[style])}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** A plan's art direction: style, composition and each option. */
export function ArtDirectionPanel({
  draft,
  info,
  onChange,
}: {
  draft: AnimationBlueprint;
  info: CapabilityInfo | undefined;
  onChange: (direction: AnimationBlueprint["direction"]) => void;
}) {
  const compositions = info?.compositions ?? [];
  if (compositions.length === 0)
    return (
      <p className="text-2xs leading-4 text-fg-dim">
        {t("director:fixedLook")}
      </p>
    );
  const direction = draft.direction;
  const resolved = resolveDirection(
    direction,
    compositions.map((c) => c.id),
  ).direction;
  const set = (key: string, value: string) => {
    const next: Record<string, string> = { ...direction };
    if (value === "") delete next[key];
    else next[key] = value;
    onChange(next as AnimationBlueprint["direction"]);
  };
  const auto = (label: string) => t("director:auto", { value: label });
  const chosen = compositions.find((c) => c.id === resolved.composition);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-semibold text-fg-dim">
        {t("director:artDirection")}
      </span>
      <div className="grid grid-cols-3 gap-2">
        <StylePicker
          value={direction.style}
          onChange={(style) => set("style", style)}
        />
        <Field label={t("director:composition")}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={direction.composition ?? ""}
              onChange={(event) => set("composition", event.target.value)}
            >
              <option value="">{auto(chosen?.name ?? "")}</option>
              {compositions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {DIRECTION_KEYS.map((key) => (
          <Field key={key} label={t(OPTION_LABELS[key])}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={direction[key] ?? ""}
                onChange={(event) => set(key, event.target.value)}
              >
                <option value="">
                  {auto(t(VALUE_LABELS[resolved[key] as Value]))}
                </option>
                {DIRECTION_OPTIONS[key].map((value) => (
                  <option key={value} value={value}>
                    {t(VALUE_LABELS[value as Value])}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
      </div>
      {chosen && (
        <p className="text-2xs leading-4 text-fg-dim">{chosen.summary}</p>
      )}
    </div>
  );
}
