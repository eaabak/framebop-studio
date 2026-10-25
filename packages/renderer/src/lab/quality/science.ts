/**
 * Scientific review of a plan's words against the experiment's own facts.
 * Facts come from the simulation or the geometry, never from the plan: who
 * arrives first, by how long, how much less time, how much higher the mean
 * speed, whether the two lines are equal. Numbers on screen are checked
 * against them; a claim that contradicts them and has a verified version is
 * replaced (and reported); what cannot be checked is flagged for review.
 *
 * Words are recognised with small multilingual stem lists, but the verdict
 * always comes from the facts, not from the words.
 */
import type {
  AnimationBlueprint,
  AnimationSpec,
  QualityFinding,
} from "@framebop/core";
import { brachistochroneRun } from "../experiments";
import { mullerFigures } from "../muller/geometry";
import { type LabPhrases, phrase } from "../phrases";
import { type NumberClaim, mentions } from "./text";

export type TextField = "hook" | "prediction" | "explanation" | "closing";
export const TEXT_FIELDS: readonly TextField[] = [
  "hook",
  "prediction",
  "explanation",
  "closing",
];

export interface ScienceInput {
  blueprint: AnimationBlueprint;
  spec: AnimationSpec;
  /** The words as they will be shown; verified replacements go here. */
  text: AnimationBlueprint["text"];
  numbers: Record<TextField, NumberClaim[]>;
  words: LabPhrases;
}

/** Whole words that claim every case. */
const UNIVERSAL = [
  "ALWAYS",
  "NEVER",
  "EVERY",
  "FOREVER",
  "HER",
  "DAİMA",
  "ASLA",
  "IMMER",
  "NIE",
  "NIEMALS",
  "SIEMPRE",
  "NUNCA",
  "SEMPRE",
  "TOUJOURS",
  "JAMAIS",
  "MAI",
];
const WIN = [
  "WIN",
  "BEAT",
  "FIRST",
  "KAZAN",
  "YEN",
  "BİRİNCİ",
  "GEWINN",
  "SIEG",
  "GANA",
  "VENC",
  "GAGN",
  "VINC",
];
const SPEED = [
  "FAST",
  "QUICK",
  "SPEED",
  "HIZ",
  "SCHNELL",
  "TEMPO ",
  "RÁPID",
  "RAPID",
  "VELOC",
  "VITE",
];
const TIME = [
  "TIME",
  "SOON",
  "EARLIER",
  "AHEAD",
  "SÜRE",
  "ÖNCE",
  "ERKEN",
  "ZEIT",
  "FRÜH",
  "TIEMPO",
  "ANTES",
  "TEMPO",
  "TEMPS",
  "TÔT",
  "PRIMA",
  "LESS",
  "AZ",
  "WENIGER",
  "MENOS",
  "MOINS",
];
const LENGTH = [
  "LONG",
  "SHORT",
  "UZUN",
  "KISA",
  "LÄNG",
  "KÜRZ",
  "LARG",
  "CORT",
  "CURT",
  "COURT",
  "LUNG",
];
const LOOKS = [
  "LOOK",
  "SEEM",
  "APPEAR",
  "GÖRÜN",
  "WIRK",
  "SCHEIN",
  "PAREC",
  "SEMBR",
  "SEMBL",
  "PARAÎ",
  "PARAI",
  "ILLUS",
];
const THEORY = [
  "DEPTH",
  "PERSPECTIVE",
  "3D",
  "DERİNLİK",
  "PERSPEKTİF",
  "TIEFE",
  "PROFUNDIDAD",
  "PROFONDEUR",
  "PROFONDIT",
];
const HEDGE = [
  "MAY",
  "MIGHT",
  "PERHAPS",
  "MAYBE",
  "POSSIBL",
  "THEOR",
  "IDEA",
  "BELKİ",
  "OLABİLİR",
  "TEORİ",
  "VIELLEICHT",
  "QUIZ",
  "TALVEZ",
  "PEUT",
  "FORSE",
  "TEOR",
];

const upperWords = (line: string) =>
  line
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[!?.,;:]+$/u, ""))
    .filter(Boolean);
/** Whether a line names a contender: every word of its label appears. */
function names(line: string, label: string): boolean {
  const words = upperWords(line);
  return upperWords(label).every((w) =>
    words.some((word) =>
      word.startsWith(w.slice(0, Math.max(3, w.length - 2))),
    ),
  );
}

/** Whether a written value agrees with a fact, to the precision written. */
function agrees(claim: NumberClaim, fact: number, slack = 0): boolean {
  const decimals = (claim.token.match(/[.,](\d+)/)?.[1] ?? "").length;
  return Math.abs(claim.value - fact) <= 0.5 * 10 ** -decimals + slack + 1e-9;
}

function finding(
  id: string,
  severity: QualityFinding["severity"],
  category: QualityFinding["category"],
  field: TextField | null,
  message: string,
  suggestion = "",
  fix: QualityFinding["fix"] = null,
): QualityFinding {
  return {
    id: field ? `${id}:text.${field}` : id,
    severity,
    category,
    scene:
      field === "hook"
        ? "hook"
        : field === "prediction"
          ? "prediction"
          : field === "explanation"
            ? "explanation"
            : field === "closing"
              ? "closing"
              : null,
    element: field ? `text.${field}` : null,
    message,
    suggestion,
    fix,
  };
}

/** The race's facts, from the simulation of the plan's tracks. */
export function raceFacts(spec: AnimationSpec) {
  const lab = spec.lab;
  if (lab?.kind !== "brachistochrone") throw new Error("Not the race.");
  const run = brachistochroneRun(lab);
  const winner = run.curve.arrival < run.straight.arrival ? 1 : 0;
  const [first, second] =
    winner === 1 ? [run.curve, run.straight] : [run.straight, run.curve];
  const saved = second.arrival - first.arrival;
  return {
    winner,
    curve: run.curve.arrival,
    straight: run.straight.arrival,
    saved,
    /** Percent less time the winner took. */
    lessTime: (saved / second.arrival) * 100,
    /** Percent higher mean speed (path length over time) of the winner. */
    speedGain:
      (first.length / first.arrival / (second.length / second.arrival) - 1) *
      100,
  };
}

export function reviewRace(input: ScienceInput): QualityFinding[] {
  const out: QualityFinding[] = [];
  const facts = raceFacts(input.spec);
  const { labels } = input.text;
  const winner = labels[facts.winner]!;
  const loser = labels[1 - facts.winner]!;
  const verified = phrase(input.words.winsBy, {
    name: winner,
    n: facts.saved.toFixed(2),
  });
  for (const field of TEXT_FIELDS) {
    const line = input.text[field];
    const words = upperWords(line);
    const claimsWin = mentions(words, WIN) || mentions(words, SPEED);
    // Questions (the hook, the prediction) ask; only statements claim.
    const statement = !line.trim().endsWith("?");
    if (statement && claimsWin && names(line, loser) && !names(line, winner)) {
      out.push(
        finding(
          "science.contradiction",
          "error",
          "science",
          field,
          `The ${field} says ${loser} wins, but in the simulation ${winner} arrives ${facts.saved.toFixed(2)} s sooner.`,
          `Say what happened: "${verified}".`,
          {
            field: `text.${field}`,
            value: verified,
            applied: true,
          },
        ),
      );
      input.text[field] = verified;
      continue;
    }
    if (statement && claimsWin && words.some((w) => UNIVERSAL.includes(w))) {
      out.push(
        finding(
          "science.universal",
          "error",
          "science",
          field,
          `The ${field} makes a claim for every case ("${line}"); the video shows one ideal, frictionless race.`,
          `State the result that was measured: "${verified}".`,
          {
            field: `text.${field}`,
            value: verified,
            applied: true,
          },
        ),
      );
      input.text[field] = verified;
      continue;
    }
    for (const claim of input.numbers[field]) {
      if (claim.unit === "s") {
        if (
          [facts.saved, facts.curve, facts.straight].some((fact) =>
            agrees(claim, fact),
          )
        )
          continue;
        const fixed = line.replace(
          claim.token,
          `${facts.saved.toFixed(2)}${/s$/i.test(claim.token) ? "s" : ""}`,
        );
        out.push(
          finding(
            `numbers.seconds.${claim.token}`,
            "error",
            "numbers",
            field,
            `The ${field} says ${claim.token} s; the simulation gives ${facts.saved.toFixed(2)} s sooner (${winner} ${facts.curve.toFixed(2)} s, ${loser} ${facts.straight.toFixed(2)} s).`,
            `Use the measured value: "${fixed}".`,
            {
              field: `text.${field}`,
              value: fixed,
              applied: false,
            },
          ),
        );
      } else if (claim.unit === "%") {
        const aboutTime = mentions(claim.context, TIME);
        const aboutSpeed = mentions(claim.context, SPEED);
        if (aboutTime && agrees(claim, facts.lessTime, 0.5)) continue;
        if (aboutSpeed && !aboutTime && agrees(claim, facts.speedGain, 0.5))
          continue;
        if (aboutSpeed && !aboutTime && agrees(claim, facts.lessTime, 0.5)) {
          const fixed = phrase(input.words.lessTime, {
            n: Math.round(facts.lessTime),
          });
          out.push(
            finding(
              "numbers.speedVsTime",
              "error",
              "numbers",
              field,
              `${claim.token} is how much less time ${winner} took, not how much faster it went (its mean speed is ${Math.round(facts.speedGain)}% higher).`,
              `Say "${fixed}".`,
              {
                field: `text.${field}`,
                value: fixed,
                applied: false,
              },
            ),
          );
          continue;
        }
        if (!aboutTime && !aboutSpeed) {
          out.push(
            finding(
              `numbers.unclear.${claim.token}`,
              "warning",
              "numbers",
              field,
              `It is unclear what ${claim.token} in the ${field} measures.`,
              `Name it, for example "${phrase(input.words.lessTime, { n: Math.round(facts.lessTime) })}".`,
            ),
          );
          continue;
        }
        const expected = aboutTime ? facts.lessTime : facts.speedGain;
        const fixed = line.replace(
          claim.token,
          claim.token.startsWith("%")
            ? `%${Math.round(expected)}`
            : `${Math.round(expected)}%`,
        );
        out.push(
          finding(
            `numbers.percent.${claim.token}`,
            "error",
            "numbers",
            field,
            `The ${field} says ${claim.token}; the simulation gives ${Math.round(expected)}%.`,
            `Use the measured value: "${fixed}".`,
            {
              field: `text.${field}`,
              value: fixed,
              applied: false,
            },
          ),
        );
      } else if (claim.unit === "count" && claim.value !== 2) {
        out.push(
          finding(
            `numbers.count.${claim.token}`,
            "warning",
            "numbers",
            field,
            `The ${field} counts ${claim.token}; this video shows two paths and two spheres.`,
            "Check the number.",
          ),
        );
      } else if (claim.unit === "other") {
        out.push(
          finding(
            `numbers.other.${claim.token}`,
            "warning",
            "numbers",
            field,
            `"${claim.token}" in the ${field} cannot be checked against the experiment.`,
            "Use seconds or a percentage the experiment measures, or remove it.",
          ),
        );
      }
    }
  }
  return out;
}

export function reviewIllusion(input: ScienceInput): QualityFinding[] {
  const out: QualityFinding[] = [];
  const lab = input.spec.lab;
  if (lab?.kind !== "muller-lyer") throw new Error("Not the illusion.");
  // The fact itself: the shafts are equal, whatever the fins do.
  for (const flex of [-2, 0, 2]) {
    const { top, bottom } = mullerFigures(
      lab,
      input.spec.width,
      input.spec.height,
      flex,
    );
    const a = Math.hypot(top.to.x - top.from.x, top.to.y - top.from.y);
    const b = Math.hypot(
      bottom.to.x - bottom.from.x,
      bottom.to.y - bottom.from.y,
    );
    if (Math.abs(a - b) > 1e-6) {
      out.push(
        finding(
          "science.unequal",
          "error",
          "capability",
          null,
          "The two shafts are not the same length, so this is not the illusion.",
          "Report this: it is a fault in Framebop.",
        ),
      );
      break;
    }
  }
  const same = input.words.sameLength;
  for (const field of TEXT_FIELDS) {
    const line = input.text[field];
    const words = upperWords(line);
    const statement = !line.trim().endsWith("?");
    if (statement && mentions(words, LENGTH) && !mentions(words, LOOKS)) {
      out.push(
        finding(
          "science.unequalClaim",
          "error",
          "science",
          field,
          `The ${field} says the lines differ in length ("${line}"); they are exactly equal and only look different.`,
          `Say "${same}", or say one only looks longer.`,
          {
            field: `text.${field}`,
            value: same,
            applied: true,
          },
        ),
      );
      input.text[field] = same;
      continue;
    }
    for (const claim of input.numbers[field]) {
      if (claim.unit === "count") {
        if (claim.value !== 2) {
          out.push(
            finding(
              `numbers.count.${claim.token}`,
              "warning",
              "numbers",
              field,
              `The ${field} counts ${claim.token}; this video shows two lines.`,
              "Check the number.",
            ),
          );
        }
        continue;
      }
      const without = line.replace(claim.token, "").replace(/\s+/g, " ").trim();
      out.push(
        finding(
          `numbers.unmeasured.${claim.token}`,
          "error",
          "numbers",
          field,
          `The ${field} gives ${claim.token}, but this video measures no such quantity; the only measured fact is that the lines are equal.`,
          `Remove it: "${without}".`,
          {
            field: `text.${field}`,
            value: without,
            applied: false,
          },
        ),
      );
    }
    if (
      field === "explanation" &&
      mentions(words, THEORY) &&
      !mentions(words, HEDGE)
    ) {
      out.push(
        finding(
          "science.debated",
          "warning",
          "science",
          field,
          `The explanation states one debated account of the illusion (depth or perspective) as settled fact.`,
          `Hedge it, for example "ONE IDEA: DEPTH CUES", or describe what is seen: "${input.words.wholeShape}".`,
        ),
      );
    }
  }
  return out;
}
