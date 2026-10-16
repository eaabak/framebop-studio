import {
  AppError,
  type AppSettings,
  type AppSettingsPatch,
  AppSettingsSchema,
  DEFAULT_SETTINGS,
} from "@framebop/core";
import type { EngineContext } from "../context";
import { isProgram } from "./render-browser";
import { definedOnly } from "./shared";

/**
 * Settings are stored one row per key. Each value is validated on read and
 * falls back to its default when missing or invalid, so a setting written by
 * a different version can never prevent the application from starting.
 */
export function getSettings(ctx: EngineContext): AppSettings {
  const stored = ctx.db.settings.getAll();
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, schema] of Object.entries(AppSettingsSchema.shape)) {
    if (!(key in stored)) continue;
    const parsed = schema.safeParse(stored[key]);
    if (parsed.success) settings[key] = parsed.data;
  }
  return settings as AppSettings;
}

export function updateSettings(
  ctx: EngineContext,
  patch: AppSettingsPatch,
): AppSettings {
  // A picture or document chosen by mistake must not become the renderer.
  if (patch.rendererBrowserPath && !isProgram(patch.rendererBrowserPath)) {
    throw new AppError(
      "VALIDATION",
      "That file is not a program. Leave it empty to use the renderer that comes with Framebop.",
    );
  }
  const now = ctx.now();
  ctx.db.transaction(() => {
    for (const [key, value] of Object.entries(definedOnly(patch))) {
      ctx.db.settings.set(key, value, now);
    }
  });
  return getSettings(ctx);
}
