/**
 * Visual preflight: the overlay's boxes and the experiment's objects at
 * representative frames, from the same geometry, camera and text metrics
 * the picture uses. It finds words on words, words over the spheres or the
 * figures, things outside the picture or its safe area, essential objects
 * too small, and too many words at once. It checks geometry, not pixels:
 * a frame it does not sample, or a look it cannot measure, it cannot judge.
 */
import type {
  AnimationSpec,
  QualityFinding,
  QualityRules,
} from "@framebop/core";
import {
  type Placed,
  type Rect,
  calloutBox,
  chipBox,
  headlineBox,
  inside,
  overlap,
  rect,
} from "../../cinema/layout";
import { project } from "../../cinema/lens";
import { SAFE } from "../../cinema/palette";
import {
  MARK_STEP,
  RADIUS,
  direct,
  momentAt,
} from "../brachistochrone/director";
import {
  RACE_PINS,
  RACE_TYPE,
  cardLabelSize,
  raceCards,
  underHeadline,
} from "../brachistochrone/layout";
import { ILLUSION_TYPE, labelYs, mullerFigures } from "../muller/geometry";
import { type LabPhrases, phrase } from "../phrases";

interface Moment {
  name: string;
  scene: QualityFinding["scene"];
  texts: Placed[];
  /** Essential objects: covering them is an error. */
  essential: Placed[];
  /** Other objects: covering them is worth a look. */
  minor: Placed[];
}

const pad = (r: Rect, by: number): Rect =>
  rect(r.left - by, r.top - by, r.right + by, r.bottom + by);

function headline(
  name: string,
  text: string,
  size: number,
  y: number,
  width: number,
): Placed {
  const box = headlineBox(text, size, width / 2, y, RACE_TYPE.maxWidth);
  return { name, kind: "text", rect: box.rect, size, lines: box.lines };
}

/** The checks every capability's moments share. */
export function judge(
  moments: Moment[],
  spec: AnimationSpec,
  rules: QualityRules,
): QualityFinding[] {
  const out = new Map<string, QualityFinding>();
  const add = (
    f: Omit<QualityFinding, "fix" | "element"> & { element?: string | null },
  ) => {
    if (!out.has(f.id)) out.set(f.id, { element: null, fix: null, ...f });
  };
  const frame = rect(0, 0, spec.width, spec.height);
  const safe = rect(
    rules.safeLeft,
    rules.safeTop,
    rules.safeRight,
    rules.safeBottom,
  );
  for (const m of moments) {
    for (const t of m.texts) {
      if (t.lines !== undefined && t.lines > rules.maxTitleLines) {
        add({
          id: `readability.lines:${t.name}`,
          severity: "warning",
          category: "readability",
          scene: m.scene,
          element: t.name,
          message: `"${t.name}" wraps to ${t.lines} lines; ${rules.maxTitleLines} read best on a phone.`,
          suggestion: "Shorten the words.",
        });
      }
      if (t.size !== undefined && t.size < rules.minTextPx) {
        add({
          id: `readability.size:${t.name}`,
          severity: "warning",
          category: "readability",
          scene: m.scene,
          element: t.name,
          message: `"${t.name}" is ${t.size} px, under the ${rules.minTextPx} px that reads on a phone.`,
          suggestion: "Use a larger size.",
        });
      }
      if (!inside(t.rect, frame)) {
        add({
          id: `layout.outside:${t.name}`,
          severity: "error",
          category: "layout",
          scene: m.scene,
          element: t.name,
          message: `"${t.name}" runs out of the picture.`,
          suggestion: "Shorten the words.",
        });
      } else if (!inside(t.rect, pad(safe, 40))) {
        add({
          id: `layout.unsafe:${t.name}`,
          severity: "warning",
          category: "layout",
          scene: m.scene,
          element: t.name,
          message: `"${t.name}" reaches into the area phone apps cover with their buttons and captions.`,
          suggestion: "Shorten the words or move the element in.",
        });
      }
    }
    for (let i = 0; i < m.texts.length; i += 1) {
      for (let k = i + 1; k < m.texts.length; k += 1) {
        const a = m.texts[i]!;
        const b = m.texts[k]!;
        if (overlap(a.rect, b.rect) > 0) {
          add({
            id: `layout.textOverlap:${a.name}:${b.name}`,
            severity: "error",
            category: "layout",
            scene: m.scene,
            element: a.name,
            message: `"${a.name}" and "${b.name}" overlap ${m.name}.`,
            suggestion:
              "Shorten one of them, or change the timing so they do not show together.",
          });
        }
      }
      const t = m.texts[i]!;
      for (const o of m.essential) {
        if (overlap(pad(t.rect, -4), o.rect) > 0) {
          add({
            id: `layout.covers:${t.name}:${o.name}`,
            severity: "error",
            category: "layout",
            scene: m.scene,
            element: t.name,
            message: `"${t.name}" covers ${o.name} ${m.name}.`,
            suggestion:
              "Shorten the words, or change the layout parameters so the object sits clear of them.",
          });
        }
      }
      for (const o of m.minor) {
        if (overlap(pad(t.rect, -4), o.rect) > 0) {
          add({
            id: `layout.near:${t.name}:${o.name}`,
            severity: "warning",
            category: "layout",
            scene: m.scene,
            element: t.name,
            message: `"${t.name}" lies over ${o.name} ${m.name}.`,
            suggestion: "Check that frame in the preview.",
          });
        }
      }
    }
    for (const o of m.essential) {
      if (!inside(o.rect, frame)) {
        add({
          id: `layout.clipped:${o.name}`,
          severity: "error",
          category: "layout",
          scene: m.scene,
          element: o.name,
          message: `${o.name} is cut off by the edge of the picture ${m.name}.`,
          suggestion: "Change the size parameters so it fits.",
        });
      }
    }
    if (m.texts.length > rules.maxOverlays) {
      add({
        id: `readability.density:${m.name}`,
        severity: "warning",
        category: "readability",
        scene: m.scene,
        message: `${m.texts.length} pieces of text show at once ${m.name}; more than ${rules.maxOverlays} is hard to follow.`,
        suggestion: "Simplify the words for that part.",
      });
    }
  }
  return [...out.values()];
}

/**
 * Held moments: a beat that lasts much longer than what moves in it plays
 * as a still picture (Scene Doctor reports it as frozen after the render).
 */
function idle(
  spans: {
    beat: NonNullable<QualityFinding["scene"]>;
    frames: number;
    active: number;
  }[],
  fps: number,
): QualityFinding[] {
  return spans
    .filter((span) => span.frames - span.active > 2 * fps)
    .map((span) => ({
      id: `timing.idle:${span.beat}`,
      severity: "warning" as const,
      category: "readability" as const,
      scene: span.beat,
      element: `scenes.${span.beat}`,
      message: `The ${span.beat} holds for about ${((span.frames - span.active) / fps).toFixed(1)} s after its animation ends.`,
      suggestion: `Shorten the ${span.beat} to about ${((span.active + fps) / fps).toFixed(1)} s.`,
      fix: null,
    }));
}

export function reviewRaceLayout(
  spec: AnimationSpec,
  rules: QualityRules,
  words: LabPhrases,
): QualityFinding[] {
  const lab = spec.lab;
  if (lab?.kind !== "brachistochrone") throw new Error("Not the race.");
  const { width: W, height: H } = spec;
  const d = direct(lab, spec.fps, spec.durationFrames, { width: W, height: H });
  const { beats, releaseFrame: go, text } = lab;
  const titleY = RACE_TYPE.titleY;
  const cards = raceCards(W).map((c, i) => ({
    name: `the ${text.contenders[i]} score card`,
    kind: "text" as const,
    rect: c.rect,
  }));
  const winner = d.winner;
  const at = (f: number) => {
    const m = momentAt(d, f);
    const p = (q: { x: number; y: number; z: number }) =>
      project(m.pose, W, H, q, m.shake);
    const spheres: Placed[] = m.centers.map((c, i) => {
      const q = p(c);
      const r = RADIUS * q.scale;
      return {
        name: `the ${text.contenders[i]} sphere`,
        kind: "object",
        rect: rect(q.x - r, q.y - r, q.x + r, q.y + r),
      };
    });
    const track: Placed[] = d.lanes.flatMap((lane, i) =>
      lane.centers
        .filter((_, k) => k % 10 === 0)
        .map((c) => {
          const q = p(c);
          return {
            name: `the ${text.contenders[i]} track`,
            kind: "object" as const,
            rect: rect(q.x - 6, q.y - 6, q.x + 6, q.y + 6),
          };
        }),
    );
    const pin = (i: number, u: number) =>
      p(d.lanes[i]!.centers[Math.round(u * (d.lanes[i]!.centers.length - 1))]!);
    return { m, spheres, track, pin };
  };
  const moments: Moment[] = [];
  const add = (
    name: string,
    scene: Moment["scene"],
    f: number,
    texts: (s: ReturnType<typeof at>) => Placed[],
    withCards: boolean,
  ) => {
    const s = at(f);
    moments.push({
      name,
      scene,
      texts: [...texts(s), ...(withCards ? cards : [])],
      essential: s.spheres,
      minor: s.track,
    });
  };
  add(
    "at the start",
    "hook",
    go + 4,
    (s) => [
      headline("the hook", text.hook, RACE_TYPE.hook, titleY, W),
      ...[0, 1].map((i) => {
        const q = s.pin(i, RACE_PINS.name[i]!);
        return {
          name: `the ${text.contenders[i]} label`,
          kind: "text" as const,
          rect: calloutBox(text.contenders[i]!, q.x, q.y, i === 0 ? 1 : -1),
        };
      }),
    ],
    true,
  );
  add(
    "mid-race",
    "experiment",
    Math.round((go + d.arrivals[winner]) / 2),
    () => [
      {
        name: "the conditions",
        kind: "text",
        rect: chipBox(words.noFriction, 30, W / 2 - 170, titleY - 60),
      },
      {
        name: "the slow-motion label",
        kind: "text",
        rect: chipBox(
          phrase(words.slowMotion, { n: lab.slowMotion }),
          30,
          W / 2 + 170,
          titleY - 60,
        ),
      },
    ],
    true,
  );
  add(
    "as the winner arrives",
    "experiment",
    Math.ceil(d.arrivals[winner]) + 2,
    () => [],
    true,
  );
  add(
    "at the result",
    "reveal",
    beats.reveal + 30,
    () => [
      headline(
        "the result",
        phrase(words.wins, { name: text.contenders[winner]! }),
        RACE_TYPE.reveal,
        titleY + 10,
        W,
      ),
      {
        name: "the time saved",
        kind: "text",
        rect: chipBox(
          phrase(words.lessTime, { n: d.faster }),
          42,
          W / 2,
          underHeadline(
            phrase(words.wins, { name: text.contenders[winner]! }),
            RACE_TYPE.reveal,
            titleY + 10,
            W,
          ),
          true,
        ),
      },
    ],
    true,
  );
  add(
    "in the explanation",
    "explanation",
    Math.round((d.replay.from + d.replay.to) / 2),
    (s) => [
      headline("the explanation", text.explanation, RACE_TYPE.why, titleY, W),
      {
        name: "the replay label",
        kind: "text",
        rect: chipBox(
          phrase(words.replay, { n: MARK_STEP }),
          28,
          W / 2,
          underHeadline(text.explanation, RACE_TYPE.why, titleY, W),
        ),
      },
      ...[0, 1].map((i) => {
        const q = s.pin(i, RACE_PINS.shape[i]!);
        const label = i === 1 ? words.steep : words.gentle;
        return {
          name: `the "${label}" label`,
          kind: "text" as const,
          rect: calloutBox(
            label,
            q.x,
            q.y,
            i === 0 ? 1 : -1,
            i === 1 ? RACE_PINS.shapeOffset : undefined,
          ),
        };
      }),
    ],
    true,
  );
  add(
    "at the close",
    "closing",
    beats.closing + 30,
    () => [headline("the closing", text.closing, RACE_TYPE.closing, titleY, W)],
    false,
  );

  const findings = judge(moments, spec, rules);
  findings.push(
    ...idle(
      [
        {
          beat: "reveal",
          frames: beats.explanation - beats.reveal,
          active: 60,
        },
        {
          beat: "explanation",
          frames: beats.closing - beats.explanation,
          active: Math.ceil(d.replay.to) - beats.explanation + 20,
        },
        {
          beat: "closing",
          frames: spec.durationFrames - beats.closing,
          active: 40,
        },
      ],
      spec.fps,
    ),
  );
  // A long name shrinks to fit its card; too small, it stops reading.
  text.contenders.forEach((label, i) => {
    const size = cardLabelSize(label);
    if (size < rules.minTextPx) {
      findings.push({
        id: `readability.cardLabel:${i}`,
        severity: "warning",
        category: "readability",
        scene: "experiment",
        element: `text.labels.${i}`,
        message: `"${label}" has to shrink to ${size} px to fit its score card.`,
        suggestion: "Use a shorter name, one word if possible.",
        fix: null,
      });
    }
  });
  // The spheres must read on a phone in the race's own shot.
  const hero = at(go + 4);
  const smallest = Math.min(
    ...hero.spheres.map((s) => (s.rect.right - s.rect.left) / 2),
  );
  if (smallest < rules.minObjectPx) {
    findings.push({
      id: "readability.smallObject:sphere",
      severity: "warning",
      category: "readability",
      scene: "hook",
      element: "sphere",
      message: `The spheres are ${smallest.toFixed(0)} px across their radius in the race shot, under ${rules.minObjectPx} px.`,
      suggestion: "Use a shorter span so the camera can come closer.",
      fix: null,
    });
  }
  return findings;
}

export function reviewIllusionLayout(
  spec: AnimationSpec,
  rules: QualityRules,
  words: LabPhrases,
): QualityFinding[] {
  const lab = spec.lab;
  if (lab?.kind !== "muller-lyer") throw new Error("Not the illusion.");
  const { width: W, height: H } = spec;
  const { top, bottom } = mullerFigures(lab, W, H);
  const [aboveY, belowY] = labelYs(top, bottom);
  const titleY = SAFE.top + 150;
  const figureBox = (figure: typeof top, name: string): Placed => {
    const ys = [figure.from.y, ...figure.fins.map(([, tip]) => tip.y)];
    const xs = [
      figure.from.x,
      figure.to.x,
      ...figure.fins.map(([, tip]) => tip.x),
    ];
    return {
      name,
      kind: "object",
      rect: pad(
        rect(
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ),
        12,
      ),
    };
  };
  const figures = [
    figureBox(top, `figure ${lab.text.contenders[0]}`),
    figureBox(bottom, `figure ${lab.text.contenders[1]}`),
  ];
  const labels: Placed[] = [aboveY, belowY].map((y, i) => ({
    name: `the ${lab.text.contenders[i]} label`,
    kind: "text",
    rect: chipBox(lab.text.contenders[i]!, ILLUSION_TYPE.label, W / 2, y),
  }));
  const mascot: Placed = {
    name: "the mascot",
    kind: "object",
    rect: rect(
      SAFE.left + 15,
      SAFE.bottom - 40 - ILLUSION_TYPE.mascot,
      SAFE.left + 165,
      SAFE.bottom - 40,
    ),
  };
  const title = (name: string, text: string, size: number) => {
    const box = headlineBox(text, size, W / 2, titleY, RACE_TYPE.maxWidth);
    return {
      name,
      kind: "text" as const,
      rect: box.rect,
      size,
      lines: box.lines,
    };
  };
  const moments: Moment[] = [
    {
      name: "at the start",
      scene: "hook",
      texts: [title("the hook", lab.text.hook, ILLUSION_TYPE.hook), ...labels],
      essential: figures,
      minor: [mascot],
    },
    {
      name: "at the question",
      scene: "prediction",
      texts: [
        title("the question", lab.text.prediction, ILLUSION_TYPE.prediction),
        ...labels,
      ],
      essential: figures,
      minor: [mascot],
    },
    {
      name: "while measuring",
      scene: "experiment",
      texts: [
        {
          name: "the measure label",
          kind: "text",
          rect: chipBox(words.measure, ILLUSION_TYPE.chip, W / 2, titleY - 60),
        },
        ...labels,
      ],
      essential: figures,
      minor: [mascot],
    },
    {
      name: "at the result",
      scene: "reveal",
      texts: [title("the result", words.sameLength, ILLUSION_TYPE.same)],
      essential: [figures[0]!],
      minor: [mascot],
    },
    {
      name: "in the explanation",
      scene: "explanation",
      texts: [
        title("the explanation", lab.text.explanation, ILLUSION_TYPE.why),
        ...labels,
        {
          name: "the whole-shape label",
          kind: "text",
          rect: chipBox(
            words.wholeShape,
            ILLUSION_TYPE.chip,
            W / 2,
            belowY + 64,
          ),
        },
      ],
      essential: figures,
      minor: [mascot],
    },
    {
      name: "at the close",
      scene: "closing",
      texts: [
        title("the closing", lab.text.closing, ILLUSION_TYPE.closing),
        ...labels,
      ],
      essential: figures,
      minor: [mascot],
    },
  ];
  const findings = judge(moments, spec, rules);
  const { beats } = lab;
  findings.push(
    ...idle(
      [
        { beat: "hook", frames: beats.prediction, active: 40 },
        {
          beat: "prediction",
          frames: beats.experiment - beats.prediction,
          active: 40,
        },
        {
          beat: "experiment",
          frames: beats.reveal - beats.experiment,
          active: 60,
        },
        {
          beat: "reveal",
          frames: beats.explanation - beats.reveal,
          active: 56,
        },
        {
          beat: "explanation",
          frames: beats.closing - beats.explanation,
          active: 60,
        },
        {
          beat: "closing",
          frames: spec.durationFrames - beats.closing,
          active: 40,
        },
      ],
      spec.fps,
    ),
  );
  if (overlap(figures[0]!.rect, figures[1]!.rect) > 0) {
    findings.push({
      id: "layout.figures",
      severity: "error",
      category: "layout",
      scene: null,
      element: "parameters.gap",
      message: "The two figures' fins run into each other.",
      suggestion: "Increase the gap, or shorten the fins or their angle.",
      fix: null,
    });
  }
  return findings;
}
