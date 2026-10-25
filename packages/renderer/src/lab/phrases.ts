/**
 * The fixed words of the Lab's pictures (results, labels, units), in the
 * video's language. They are part of the experiment, not of the plan, so
 * a language model never writes them. A language without a table here is
 * shown in English, and the Director says so.
 */
export interface LabPhrases {
  /** "{name}" is the winner's label. */
  wins: string;
  /** "{n}" is a whole percentage of time saved (not of speed). */
  lessTime: string;
  /** "{name}" is the winner's label, "{n}" the seconds it arrived sooner. */
  winsBy: string;
  noFriction: string;
  /** "{n}" is the slow-motion factor. */
  slowMotion: string;
  /** "{n}" is the seconds between marks. */
  replay: string;
  steep: string;
  gentle: string;
  speed: string;
  first: string;
  second: string;
  sameLength: string;
  measure: string;
  wholeShape: string;
  light: string;
}

const TABLE: Record<string, LabPhrases> = {
  en: {
    wins: "{name} WINS",
    lessTime: "{n}% LESS TIME",
    winsBy: "{name} WINS BY {n} s",
    noFriction: "NO FRICTION",
    slowMotion: "SLOW MOTION ×{n}",
    replay: "REPLAY · MARKS EVERY {n} s",
    steep: "STEEP",
    gentle: "GENTLE",
    speed: "SPEED",
    first: "1ST",
    second: "2ND",
    sameLength: "SAME LENGTH",
    measure: "MEASURE",
    wholeShape: "WHOLE SHAPE",
    light: "LIGHT",
  },
  tr: {
    wins: "{name} KAZANDI",
    lessTime: "%{n} DAHA AZ SÜRE",
    winsBy: "{name} {n} sn ÖNDE",
    noFriction: "SÜRTÜNME YOK",
    slowMotion: "AĞIR ÇEKİM ×{n}",
    replay: "TEKRAR · HER {n} sn İŞARET",
    steep: "DİK",
    gentle: "YATIK",
    speed: "HIZ",
    first: "1.",
    second: "2.",
    sameLength: "AYNI UZUNLUK",
    measure: "ÖLÇ",
    wholeShape: "TÜM ŞEKİL",
    light: "IŞIK",
  },
  de: {
    wins: "{name} GEWINNT",
    lessTime: "{n} % WENIGER ZEIT",
    winsBy: "{name} GEWINNT UM {n} s",
    noFriction: "OHNE REIBUNG",
    slowMotion: "ZEITLUPE ×{n}",
    replay: "WIEDERHOLUNG · MARKEN ALLE {n} s",
    steep: "STEIL",
    gentle: "FLACH",
    speed: "TEMPO",
    first: "1.",
    second: "2.",
    sameLength: "GLEICH LANG",
    measure: "MESSEN",
    wholeShape: "GANZE FORM",
    light: "LICHT",
  },
  es: {
    wins: "GANA {name}",
    lessTime: "{n} % MENOS TIEMPO",
    winsBy: "GANA {name} POR {n} s",
    noFriction: "SIN FRICCIÓN",
    slowMotion: "CÁMARA LENTA ×{n}",
    replay: "REPETICIÓN · MARCAS CADA {n} s",
    steep: "EMPINADA",
    gentle: "SUAVE",
    speed: "VELOCIDAD",
    first: "1.º",
    second: "2.º",
    sameLength: "MISMA LONGITUD",
    measure: "MEDIR",
    wholeShape: "FORMA COMPLETA",
    light: "LUZ",
  },
  pt: {
    wins: "{name} VENCE",
    lessTime: "{n}% MENOS TEMPO",
    winsBy: "{name} VENCE POR {n} s",
    noFriction: "SEM ATRITO",
    slowMotion: "CÂMERA LENTA ×{n}",
    replay: "REPLAY · MARCAS A CADA {n} s",
    steep: "ÍNGREME",
    gentle: "SUAVE",
    speed: "VELOCIDADE",
    first: "1º",
    second: "2º",
    sameLength: "MESMO TAMANHO",
    measure: "MEDIR",
    wholeShape: "FORMA INTEIRA",
    light: "LUZ",
  },
  fr: {
    wins: "{name} GAGNE",
    lessTime: "{n} % DE TEMPS EN MOINS",
    winsBy: "{name} GAGNE DE {n} s",
    noFriction: "SANS FROTTEMENT",
    slowMotion: "RALENTI ×{n}",
    replay: "RALENTI · REPÈRES TOUTES LES {n} s",
    steep: "RAIDE",
    gentle: "DOUCE",
    speed: "VITESSE",
    first: "1ER",
    second: "2E",
    sameLength: "MÊME LONGUEUR",
    measure: "MESURER",
    wholeShape: "FORME ENTIÈRE",
    light: "LUMIÈRE",
  },
  it: {
    wins: "VINCE {name}",
    lessTime: "{n}% DI TEMPO IN MENO",
    winsBy: "VINCE {name} DI {n} s",
    noFriction: "SENZA ATTRITO",
    slowMotion: "RALLENTATORE ×{n}",
    replay: "REPLAY · SEGNI OGNI {n} s",
    steep: "RIPIDA",
    gentle: "DOLCE",
    speed: "VELOCITÀ",
    first: "1°",
    second: "2°",
    sameLength: "STESSA LUNGHEZZA",
    measure: "MISURA",
    wholeShape: "FORMA INTERA",
    light: "LUCE",
  },
};

export const PHRASE_LANGUAGES = Object.keys(TABLE);

export function labPhrases(language: string): LabPhrases {
  return TABLE[language.slice(0, 2).toLowerCase()] ?? TABLE.en!;
}

/** Fills `{name}`-style holes in a phrase. */
export function phrase(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}
