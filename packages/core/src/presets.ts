/**
 * Applying a model preset to an engine's settings.
 *
 * A preset names settings in the engine's own vocabulary. Each value is
 * checked against what the engine says it accepts. Whatever cannot be
 * applied is returned as a problem, in words, so the interface can say so
 * instead of silently dropping it.
 */
import type { ParameterSpec, ParameterValue } from "./domain";
import type { ModelPreset } from "./models";

export interface PresetApplication {
  values: Record<string, ParameterValue>;
  size: { width: number; height: number } | null;
  problems: string[];
}

function check(spec: ParameterSpec, value: ParameterValue): string | null {
  switch (spec.type) {
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${spec.label} must be a number.`;
      }
      if (spec.type === "integer" && !Number.isInteger(value)) {
        return `${spec.label} must be a whole number.`;
      }
      if (spec.min !== undefined && value < spec.min) {
        return `${spec.label} ${value} is below this engine's minimum of ${spec.min}.`;
      }
      if (spec.max !== undefined && value > spec.max) {
        return `${spec.label} ${value} is above this engine's maximum of ${spec.max}.`;
      }
      return null;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `${spec.label} must be on or off.`;
    case "enum":
      return typeof value === "string" && spec.options?.includes(value)
        ? null
        : `${spec.label} "${String(value)}" is not one of this engine's choices.`;
    case "string":
      return typeof value === "string" ? null : `${spec.label} must be text.`;
  }
}

export function applyPreset(
  preset: ModelPreset,
  current: Readonly<Record<string, ParameterValue>>,
  specs: readonly ParameterSpec[],
  resolutions: readonly { width: number; height: number }[],
): PresetApplication {
  const values: Record<string, ParameterValue> = { ...current };
  const problems: string[] = [];
  for (const [key, value] of Object.entries(preset.parameters)) {
    const spec = specs.find((candidate) => candidate.key === key);
    if (!spec) {
      problems.push(
        `This engine has no "${key}" setting, so it was not applied.`,
      );
      continue;
    }
    const problem = check(spec, value);
    if (problem) problems.push(`${problem} It was not applied.`);
    else values[key] = value;
  }
  let size: PresetApplication["size"] = null;
  if (preset.size) {
    const offered = resolutions.some(
      (r) => r.width === preset.size?.width && r.height === preset.size?.height,
    );
    if (offered) size = preset.size;
    else {
      problems.push(
        `This engine does not offer ${preset.size.width}×${preset.size.height}, so the size was not changed.`,
      );
    }
  }
  return { values, size, problems };
}
