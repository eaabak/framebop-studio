/**
 * The Visual Scene Composer: turns a scene document and a resolved art
 * direction into the scene graph that is drawn. Everything it does is a
 * change to data: parts kept or dropped by their `when`, camera moves
 * scaled to the direction's motion and framing, a camera variant chosen,
 * the lighting preset and typography set. No scene has code of its own,
 * so a new look is a new choice, and a new scene is a new document.
 */
import type {
  ResolvedDirection,
  SceneGraph,
  SceneNode,
  SceneTrack,
} from "@framebop/core";
import { SceneGraphSchema } from "@framebop/core";

/** How far camera moves go from their rest pose, by motion. */
export const MOTION_SCALE = { calm: 0.45, lively: 1, bold: 1.5 } as const;
/** How close the camera frames, as a zoom on top of the scene's own. */
export const FRAMING_ZOOM = { wide: 0.94, medium: 1, close: 1.06 } as const;
/** How large the subject is, as a factor on its size parameter. */
export const SUBJECT_SCALE = { small: 0.8, medium: 1, large: 1.2 } as const;

type When = SceneNode["when"];

/** Whether a part belongs to this direction. */
export function fits(when: When, d: ResolvedDirection): boolean {
  if (!when) return true;
  return Object.entries(when).every(([key, values]) =>
    (values ?? []).includes((d as Record<string, string>)[key] ?? ""),
  );
}

function keep(nodes: SceneNode[], d: ResolvedDirection): SceneNode[] {
  return nodes
    .filter((n) => fits(n.when, d))
    .map((n) =>
      n.type === "group" ? { ...n, children: keep(n.children, d) } : n,
    );
}

/**
 * A camera track's moves scaled about its rest pose (its first key), and
 * then multiplied: the shape of a move stays, its size changes. Values
 * bound to parameters or solvers are left as they are.
 */
function scaleMove(
  track: SceneTrack,
  k: number,
  times = 1,
  max = Infinity,
): SceneTrack {
  if (typeof track === "number") return Math.min(max, track * times);
  if (!("keys" in track)) return track;
  const first = track.keys[0]!.value;
  if (typeof first !== "number") return track;
  return {
    keys: track.keys.map((key) => ({
      ...key,
      value:
        typeof key.value === "number"
          ? Math.min(max, (first + (key.value - first) * k) * times)
          : key.value,
    })),
  };
}

export function composeScene(
  doc: SceneGraph,
  d: ResolvedDirection,
): SceneGraph {
  const k = MOTION_SCALE[d.motion];
  const variant = doc.cameraVariants.find((c) => fits(c.when, d));
  const camera = {
    x: scaleMove(variant?.x ?? doc.camera.x, k),
    y: scaleMove(variant?.y ?? doc.camera.y, k),
    zoom: scaleMove(
      variant?.zoom ?? doc.camera.zoom,
      k,
      FRAMING_ZOOM[d.framing],
      doc.camera.maxZoom,
    ),
    maxZoom: doc.camera.maxZoom,
  };
  // A perspective camera's moves are camera moves too: a dolly is scaled
  // like a zoom, so motion means the same in every composition.
  const solvers = doc.solvers.map((s) =>
    s.kind === "perspective"
      ? {
          ...s,
          camera: {
            u: scaleMove(s.camera.u, k),
            v: scaleMove(s.camera.v, k),
            z: scaleMove(s.camera.z, k),
          },
        }
      : s,
  );
  const nodes = keep(doc.nodes, d).map((n) =>
    n.type === "lighting" ? { ...n, preset: d.lighting } : n,
  );
  return SceneGraphSchema.parse({
    ...doc,
    solvers,
    nodes,
    headlines: doc.headlines.filter((h) => fits(h.when, d)),
    cues: doc.cues.filter((c) => fits(c.when, d)),
    camera,
    cameraVariants: [],
    typography: { style: d.typography, transition: d.transition },
  });
}
