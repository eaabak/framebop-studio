/**
 * Visual references in the Media Production panel: link the project's
 * characters, places and styles to a scene, and create or edit them.
 */
import {
  type Asset,
  VISUAL_REFERENCE_KINDS,
  type VisualReference,
  type VisualReferenceKind,
} from "@framebop/core";
import { Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { AssetThumb } from "../../components/media";
import { Button, Field, cx } from "../../components/ui";
import { t } from "../../i18n";
import { useReferences } from "../../store/references";

const kindLabel = (kind: VisualReferenceKind) =>
  ({
    character: t("media:kindCharacter"),
    environment: t("media:kindEnvironment"),
    style: t("media:kindStyle"),
  })[kind];

interface Draft {
  id: string | null;
  kind: VisualReferenceKind;
  name: string;
  description: string;
  palette: string;
  assetIds: string[];
  seed: number | null;
}

const EMPTY: Draft = {
  id: null,
  kind: "character",
  name: "",
  description: "",
  palette: "",
  assetIds: [],
  seed: null,
};

function Editor({
  draft,
  pictures,
  onDone,
}: {
  draft: Draft;
  pictures: readonly Asset[];
  onDone(): void;
}) {
  const save = useReferences((state) => state.save);
  const importImage = useReferences((state) => state.importImage);
  const [value, setValue] = useState(draft);
  const [saving, setSaving] = useState(false);
  const patch = (next: Partial<Draft>) =>
    setValue((current) => ({ ...current, ...next }));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-2">
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Field label={t("media:kind")}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={value.kind}
              onChange={(event) =>
                patch({ kind: event.target.value as VisualReferenceKind })
              }
            >
              {VISUAL_REFERENCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel(kind)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("media:name")}>
          {(id) => (
            <input
              id={id}
              className="control"
              maxLength={80}
              value={value.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label={t("media:description")} hint={t("media:descriptionHint")}>
        {(id) => (
          <textarea
            id={id}
            rows={2}
            maxLength={1000}
            className="control resize-y text-xs"
            value={value.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        )}
      </Field>
      <Field label={t("media:palette")} hint={t("media:paletteHint")}>
        {(id) => (
          <input
            id={id}
            className="control"
            maxLength={300}
            value={value.palette}
            onChange={(event) => patch({ palette: event.target.value })}
          />
        )}
      </Field>
      <Button
        size="sm"
        icon={Upload}
        busy={saving}
        disabled={!value.name.trim()}
        onClick={async () => {
          setSaving(true);
          try {
            const saved = await save({ ...value, name: value.name.trim() });
            if (!saved) return;
            patch({ id: saved.id });
            const imported = await importImage(saved.id);
            if (imported) patch({ assetIds: imported.assetIds });
          } finally {
            setSaving(false);
          }
        }}
      >
        {t("video:uploadReference")}
      </Button>
      <Field label={t("media:seed")} hint={t("video:referenceSeedHint")}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="number"
            min={0}
            max={4294967295}
            value={value.seed ?? ""}
            onChange={(e) =>
              patch({
                seed: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        )}
      </Field>
      {pictures.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-2xs font-medium text-fg-muted">
            {t("media:pictures")}
          </legend>
          <p className="text-2xs leading-4 text-fg-dim">
            {t("media:picturesHint")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pictures.map((asset) => {
              const chosen = value.assetIds.includes(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() =>
                    patch({
                      assetIds: chosen
                        ? value.assetIds.filter((id) => id !== asset.id)
                        : [...value.assetIds, asset.id].slice(0, 8),
                    })
                  }
                  className={cx(
                    "overflow-hidden rounded border-2",
                    chosen
                      ? "border-accent"
                      : "border-transparent hover:border-line-strong",
                  )}
                >
                  <AssetThumb asset={asset} className="h-10 w-[70px]" />
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="primary"
          busy={saving}
          disabled={!value.name.trim()}
          onClick={async () => {
            setSaving(true);
            const saved = await save({
              id: value.id,
              kind: value.kind,
              name: value.name.trim(),
              description: value.description.trim(),
              palette: value.palette.trim(),
              assetIds: value.assetIds,
              seed: value.seed,
            });
            setSaving(false);
            if (saved) onDone();
          }}
        >
          {t("media:save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("media:cancel")}
        </Button>
      </div>
    </div>
  );
}

export function ReferenceManager({
  projectReferences,
  linked,
  onLink,
  pictures,
}: {
  projectReferences: readonly VisualReference[];
  linked: readonly string[];
  onLink(ids: string[]): void;
  pictures: readonly Asset[];
}) {
  const remove = useReferences((state) => state.remove);
  const [editing, setEditing] = useState<Draft | null>(null);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-2xs font-medium text-fg-muted">
        {t("media:references")}
      </legend>
      <p className="text-2xs leading-4 text-fg-dim">
        {t("media:referencesHint")}
      </p>
      {projectReferences.length === 0 && !editing && (
        <p className="text-2xs text-fg-dim">{t("media:noReferences")}</p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {projectReferences.map((reference) => {
          const on = linked.includes(reference.id);
          return (
            <li
              key={reference.id}
              className={cx(
                "flex items-center gap-1 rounded-md border pl-2 text-2xs",
                on ? "border-accent/50 bg-accent/10" : "border-line",
              )}
            >
              {reference.assetIds[0] &&
                pictures.find(
                  (asset) => asset.id === reference.assetIds[0],
                ) && (
                  <AssetThumb
                    asset={pictures.find(
                      (asset) => asset.id === reference.assetIds[0],
                    )!}
                    className="h-9 w-12 rounded object-cover"
                  />
                )}
              <label className="flex cursor-pointer items-center gap-1.5 py-1">
                <input
                  type="checkbox"
                  className="size-3.5 accent-accent"
                  checked={on}
                  onChange={() =>
                    onLink(
                      on
                        ? linked.filter((id) => id !== reference.id)
                        : [...linked, reference.id],
                    )
                  }
                />
                <span className="text-fg">{reference.name}</span>
                <span className="text-fg-dim">{kindLabel(reference.kind)}</span>
              </label>
              <button
                type="button"
                className="px-1 text-fg-dim hover:text-fg"
                onClick={() => setEditing({ ...reference })}
              >
                {t("media:edit")}
              </button>
              <button
                type="button"
                aria-label={t("media:deleteReference", {
                  name: reference.name,
                })}
                className="px-1 text-fg-dim hover:text-danger"
                onClick={() => void remove(reference.id)}
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <Editor
          key={editing.id ?? "new"}
          draft={editing}
          pictures={pictures}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button
          size="sm"
          icon={Plus}
          className="self-start"
          onClick={() => setEditing(EMPTY)}
        >
          {t("media:newReference")}
        </Button>
      )}
    </fieldset>
  );
}
