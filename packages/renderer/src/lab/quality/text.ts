/**
 * Text integrity for words on screen: what can be fixed safely is fixed and
 * reported (emoji, stutters, doubled punctuation); what cannot (a broken
 * number such as "2-", a foreign script) is reported with a suggestion, and
 * the words stay as written. Numbers that make sense are kept: "0.18s
 * SOONER", "18% LESS TIME" and "2 EQUAL LINES" pass untouched.
 */
import type { BlueprintBeat, QualityFinding } from "@framebop/core";

/** A number as written on screen, with its unit and the words around it. */
export interface NumberClaim {
  token: string;
  value: number;
  unit: "s" | "%" | "count" | "other";
  /** The line's other words, in capitals. */
  context: string[];
}

const ALLOWED = /[\p{L}\p{N}\s.,!?'"’\-–—:;%&()/×·+=]/u;
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
/** A whole number token: "0.18", "18%", "%18", "0.18S", "2", "×5". */
const NUMBER =
  /^[×x]?[+-]?\d+(?:[.,]\d+)?(?:%|S|SN|SEC|SECS|SECONDS|M|CM|MM|×|X)?$|^%\d+(?:[.,]\d+)?$/i;
/** A number cut off or left dangling: "2-", "-", "3:", "0.". */
const FRAGMENT = /^\d+[-–—:/,]$|^[-–—/]\d*$|^\d+[-–—]\d*[-–—]$/;

const SCRIPTS: [string, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Han", /\p{Script=Han}/u],
  ["Kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["Hangul", /\p{Script=Hangul}/u],
];
const EXPECTED: Record<string, string[]> = {
  ar: ["Arabic"],
  hi: ["Devanagari"],
  zh: ["Han"],
  ja: ["Han", "Kana"],
  ko: ["Hangul"],
};

/** Words a line never ends on, by language: articles, linking words, "is". */
const DANGLING: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries({
    en: "a an the of to by is are was were and or but when with at for as that than from into its their",
    de: "der die das den dem des ein eine einen und oder von zu mit ist sind wenn als",
    es: "el la los las un una y o de del que con en por para es son cuando",
    pt: "o a os as um uma e ou de do da que com em por para é são quando",
    fr: "le la les un une et ou de du des que avec en par pour est sont quand",
    it: "il lo la i gli le un una e o di del che con in per è sono quando",
    tr: "ve ile için veya",
  }).map(([lang, words]) => [lang, new Set(words.split(" "))]),
);

export interface LineReview {
  text: string;
  findings: QualityFinding[];
  numbers: NumberClaim[];
}

/**
 * Reviews one line. `field` is its plan path ("text.closing"), `name` how
 * findings call it, and `language` the video's language.
 */
export function reviewLine(
  original: string,
  field: string,
  name: string,
  language: string,
  scene: BlueprintBeat | null,
): LineReview {
  const findings: QualityFinding[] = [];
  const found = (
    code: string,
    severity: QualityFinding["severity"],
    category: QualityFinding["category"],
    message: string,
    suggestion: string,
    fix: QualityFinding["fix"] = null,
  ) =>
    findings.push({
      id: `${code}:${field}`,
      severity,
      category,
      scene,
      element: field,
      message,
      suggestion,
      fix,
    });
  let text = original;

  // Safe: emoji and joiners never belong in these headlines.
  if (PICTOGRAPH.test(text)) {
    text = text.replace(PICTOGRAPH, "").replace(/\s+/g, " ").trim();
    found(
      "text.emoji",
      "warning",
      "text",
      `The ${name} had emoji, which were removed.`,
      "",
      { field, value: text, applied: true },
    );
  }
  // Safe: doubled punctuation, space before punctuation, a stuttered word.
  const tidied = text
    .replace(/([!?.,;:])\1+/g, "$1")
    .replace(/\s+([!?.,;:%])/g, "$1")
    .replace(/^[\s.,;:!?]+/u, "")
    .split(" ")
    .filter(
      (word, i, all) =>
        !(i > 0 && word && word.toLowerCase() === all[i - 1]!.toLowerCase()),
    )
    .join(" ")
    .trim();
  if (tidied !== text) {
    found(
      "text.tidy",
      "warning",
      "text",
      `The ${name} had repeated words or punctuation; it now reads "${tidied}".`,
      "",
      {
        field,
        value: tidied,
        applied: true,
      },
    );
    text = tidied;
  }
  // Safe: a beat's planned length copied into its words ("… 1.2-2.5 s") is
  // a plan detail, never something to show.
  const timed = text.replace(
    /[\s.,;:]*\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*s\.?$/iu,
    "",
  );
  if (timed !== text && timed.trim()) {
    text = timed.trim();
    found(
      "text.timing",
      "warning",
      "text",
      `The ${name} ended with a planned duration, which was removed; it now reads "${text}".`,
      "",
      { field, value: text, applied: true },
    );
  }
  if (!text) {
    found(
      "text.empty",
      "error",
      "text",
      `The ${name} is empty.`,
      "Write a short line for it.",
    );
    return { text, findings, numbers: [] };
  }

  // Symbols the font and the style do not support.
  const odd = [...new Set([...text].filter((ch) => !ALLOWED.test(ch)))];
  if (odd.length > 0) {
    found(
      "text.symbol",
      "warning",
      "text",
      `The ${name} uses ${odd.map((c) => `"${c}"`).join(", ")}, which may not show.`,
      "Remove the symbol.",
      {
        field,
        value: [...text]
          .filter((ch) => ALLOWED.test(ch))
          .join("")
          .replace(/\s+/g, " ")
          .trim(),
        applied: false,
      },
    );
  }

  // Letters of a script the video's language does not use.
  const expected = EXPECTED[language.slice(0, 2).toLowerCase()] ?? ["Latin"];
  const scripts = SCRIPTS.filter(([, re]) => re.test(text)).map(
    ([script]) => script,
  );
  const foreign = scripts.filter((script) => !expected.includes(script));
  if (foreign.length > 0) {
    found(
      "text.script",
      "warning",
      "text",
      `The ${name} mixes in ${foreign.join(", ")} letters, unusual for this video's language.`,
      "Write it all in the video's language.",
    );
  }

  // A line cut off mid-sentence ("… DETERMINED BY THE") ends on a word that
  // never ends one. Not safe to fix: only the writer knows the rest.
  const last = text
    .split(/\s+/)
    .pop()!
    .replace(/[.,;:!?]+$/u, "")
    .toLocaleLowerCase(language);
  // Labels are names ("LINE A"), not sentences.
  const sentence = !field.startsWith("text.labels");
  if (
    sentence &&
    !/[!?.]$/u.test(text) &&
    DANGLING[language.slice(0, 2)]?.has(last)
  ) {
    found(
      "text.unfinished",
      "error",
      "text",
      `The ${name} stops mid-sentence, on "${last.toLocaleUpperCase(language)}".`,
      "Finish the line in five words or fewer.",
    );
  }

  // Numbers: kept when whole; a broken one is an error, never removed quietly.
  const words = text.split(/\s+/);
  const numbers: NumberClaim[] = [];
  const upper = words.map((w) => w.toUpperCase().replace(/[!?.,;:]+$/u, ""));
  words.forEach((word, i) => {
    const bare = word.replace(/[!?;]+$/u, "");
    if (FRAGMENT.test(bare)) {
      const without = words.filter((_, k) => k !== i).join(" ");
      found(
        `text.fragment.${i}`,
        "error",
        "numbers",
        `The ${name} has a broken number, "${word}".`,
        `Complete the number or remove it: "${without}".`,
        { field, value: without, applied: false },
      );
      return;
    }
    const token = upper[i]!;
    if (!/\d/.test(token)) return;
    if (!NUMBER.test(token)) {
      found(
        `text.number.${i}`,
        "warning",
        "numbers",
        `The ${name} has "${word}", which is not a number this video can check.`,
        "Write the number and its unit plainly, like 0.18 s or 18%.",
      );
      return;
    }
    const value = Number.parseFloat(
      token.replace(/^[×x%]/i, "").replace(",", "."),
    );
    const unit = /%/.test(token)
      ? "%"
      : /\d(S|SN|SEC|SECS|SECONDS)$/.test(token) ||
          /^(S|SN|SEC|SECS|SECONDS)$/.test(upper[i + 1] ?? "")
        ? "s"
        : /^\d+$/.test(token)
          ? "count"
          : "other";
    numbers.push({
      token: word,
      value,
      unit,
      context: upper.filter((_, k) => k !== i),
    });
  });

  if (words.length > 7) {
    found(
      "text.wordy",
      "warning",
      "readability",
      `The ${name} has ${words.length} words; on a phone, five or fewer read best.`,
      "Shorten it.",
    );
  }
  return { text, findings, numbers };
}

/** Whether any of the line's words starts with one of `stems`. */
export function mentions(
  words: readonly string[],
  stems: readonly string[],
): boolean {
  return words.some((word) => stems.some((stem) => word.startsWith(stem)));
}
