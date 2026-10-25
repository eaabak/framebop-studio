/**
 * Contrast of the two accent colours against the Lab's dark background,
 * by the WCAG ratio. A colour under the minimum is lightened, keeping its
 * hue, until it reads, and the change is reported; colours too alike to
 * tell the two contenders apart are flagged for review.
 */
import type {
  AnimationBlueprint,
  QualityFinding,
  QualityRules,
} from "@framebop/core";
import { COLORS } from "../../cinema/palette";

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour mixed towards white by `amount` (0..1), as #RRGGBB. */
function lighten(hex: string, amount: number): string {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}

export function reviewContrast(
  style: AnimationBlueprint["style"],
  rules: QualityRules,
): { style: AnimationBlueprint["style"]; findings: QualityFinding[] } {
  const findings: QualityFinding[] = [];
  const out = { ...style };
  const defaults = { primary: "#FF7A1F", secondary: "#14D9CF" };
  for (const key of ["primary", "secondary"] as const) {
    const original = out[key].toUpperCase();
    let color = original;
    // A grey or black has no hue to keep: the Lab's own accent stands in.
    const channels = [1, 3, 5].map((i) =>
      Number.parseInt(original.slice(i, i + 2), 16),
    );
    const neutral = Math.max(...channels) - Math.min(...channels) < 24;
    if (
      neutral &&
      contrastRatio(original, COLORS.background) < rules.minContrast
    ) {
      findings.push({
        id: `contrast.${key}`,
        severity: "warning",
        category: "contrast",
        scene: null,
        element: `style.${key}`,
        message: `The ${key} colour ${original} is a grey too dark to read on the dark background, with no hue to keep; the Lab's ${defaults[key]} is used.`,
        suggestion: "",
        fix: { field: `style.${key}`, value: defaults[key], applied: true },
      });
      out[key] = defaults[key];
      continue;
    }
    for (
      let k = 1;
      contrastRatio(color, COLORS.background) < rules.minContrast && k <= 20;
      k += 1
    ) {
      color = lighten(original, k * 0.05);
    }
    if (color !== original) {
      findings.push({
        id: `contrast.${key}`,
        severity: "warning",
        category: "contrast",
        scene: null,
        element: `style.${key}`,
        message: `The ${key} colour ${original} has a contrast of ${contrastRatio(original, COLORS.background).toFixed(1)}:1 on the dark background (at least ${rules.minContrast}:1 reads); it was lightened to ${color}, the same hue.`,
        suggestion: "",
        fix: { field: `style.${key}`, value: color, applied: true },
      });
    }
    out[key] = color;
  }
  const delta = [1, 3, 5].reduce(
    (sum, i) =>
      sum +
      Math.abs(
        Number.parseInt(out.primary.slice(i, i + 2), 16) -
          Number.parseInt(out.secondary.slice(i, i + 2), 16),
      ),
    0,
  );
  if (delta < 90) {
    findings.push({
      id: "contrast.alike",
      severity: "warning",
      category: "contrast",
      scene: null,
      element: "style.secondary",
      message: `The two colours ${out.primary} and ${out.secondary} are so alike the two contenders are hard to tell apart.`,
      suggestion: "Choose a second colour of a different hue.",
      fix: null,
    });
  }
  return { style: out, findings };
}
