/**
 * The 3D set of Which Path Wins?, built once on the cinema stage and posed
 * for each frame from the direction: two chrome-railed lanes over a glowing
 * strip, lacquered spheres that light the track around them, the start
 * tower with its lights and gate, and the finish block.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  type Sprite,
  type SpriteMaterial,
  TubeGeometry,
  Vector3,
  ConeGeometry,
  MeshStandardMaterial as StandardMaterial,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EASE, clamp } from "../../animation/timing";
import { type Vec3, eyeOf } from "../../cinema/camera";
import { Burst, Motes, Shockwave, Streaks, Trail } from "../../cinema/fx";
import {
  chromeMaterial,
  emissive,
  glowSprite,
  hero,
  structureMaterial,
} from "../../cinema/look";
import { COLORS } from "../../cinema/palette";
import { Stage, type StudioRig, buildStudio } from "../../cinema/stage";
import { during, ramp } from "../../cinema/type";
import { stateAt } from "../physics";
import {
  type Direction,
  LANE_Z,
  RADIUS as R,
  SEGMENTS,
  MARK_STEP,
  SNAPSHOTS,
  gateOpen,
  presenceAt,
  momentAt,
  toWorld,
} from "./director";

const off = (p: Vec3, n: Vec3, d: number, dz = 0): Vector3 =>
  new Vector3(p.x + n.x * d, p.y + n.y * d, p.z + dz);

/** A strip of quads along the lane at depth offsets `z0`..`z1`. */
function ribbon(points: Vector3[][]): BufferGeometry {
  // points[k] = [left, right] at each station
  const n = points.length;
  const positions = new Float32Array(n * 2 * 3);
  points.forEach(([a, b], k) => {
    positions.set([a!.x, a!.y, a!.z, b!.x, b!.y, b!.z], k * 6);
  });
  const index: number[] = [];
  for (let k = 0; k < n - 1; k += 1) {
    const i = k * 2;
    index.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

interface LaneParts {
  sphere: Mesh;
  light: PointLight;
  halo: Sprite;
  trail: Trail;
  strip: Mesh;
  stripColors: Float32Array;
  finish: MeshStandardMaterial;
  burst: Burst;
  ghosts: Mesh[];
  arrows: Group[];
}

export class BrachistochroneWorld {
  private readonly stage: Stage;
  private readonly studio: StudioRig;
  private readonly lanes: LaneParts[] = [];
  private readonly gate: Mesh;
  private readonly lights: MeshStandardMaterial[] = [];
  private readonly streaks: Streaks;
  private readonly motes: Motes;
  private readonly reveal: Burst;
  private readonly ring: Shockwave;
  private readonly links: Line[] = [];

  constructor(
    private readonly d: Direction,
    width: number,
    height: number,
  ) {
    const colors = [d.lab.style.secondary, d.lab.style.primary];
    const { lab, floorY } = d;
    const startX = -lab.span / 2;
    const finishX = lab.span / 2;
    const startY = lab.drop / 2;
    const finishY = -lab.drop / 2;
    this.stage = new Stage(width, height, COLORS.background);
    this.studio = buildStudio(this.stage, {
      floorY,
      rims: [d.lab.style.secondary, d.lab.style.primary],
    });
    const chrome = chromeMaterial();
    const structure = structureMaterial();
    const bed = structureMaterial("#151a24");

    d.lanes.forEach((lane, i) => {
      const color = colors[i]!;
      const { centers, normals, z } = lane;
      // Two rails the sphere rides on.
      for (const side of [-1, 1]) {
        const curve = new CatmullRomCurve3(
          centers.map((c, k) =>
            off(c, normals[k]!, -R * 0.72, side * R * 0.62),
          ),
        );
        const rail = new Mesh(
          new TubeGeometry(curve, SEGMENTS * 2, 0.012, 10),
          chrome,
        );
        rail.castShadow = true;
        this.stage.add(rail);
      }
      // The bed under the rails, with a skirt on both sides.
      const top = centers.map((c, k) => [
        off(c, normals[k]!, -R - 0.02, -0.1),
        off(c, normals[k]!, -R - 0.02, 0.1),
      ]);
      const skirt = (dz: number) =>
        centers.map((c, k) => [
          off(c, normals[k]!, -R - 0.02, dz),
          off(c, normals[k]!, -R - 0.075, dz),
        ]);
      for (const geometry of [
        ribbon(top),
        ribbon(skirt(0.1)),
        ribbon(skirt(-0.1)),
      ]) {
        const mesh = new Mesh(geometry, bed);
        mesh.material.side = DoubleSide;
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.stage.add(mesh);
      }
      // The glowing centre strip, lit along its length by vertex colours.
      const strip = new Mesh(
        ribbon(
          centers.map((c, k) => [
            off(c, normals[k]!, -R - 0.017, -0.012),
            off(c, normals[k]!, -R - 0.017, 0.012),
          ]),
        ),
        new MeshBasicMaterial({
          vertexColors: true,
          toneMapped: false,
          side: DoubleSide,
        }),
      );
      const stripColors = new Float32Array((SEGMENTS + 1) * 2 * 3);
      strip.geometry.setAttribute("color", new BufferAttribute(stripColors, 3));
      this.stage.add(strip);
      // Supports down to the floor.
      for (const at of [0.2, 0.45, 0.7, 0.92]) {
        const k = Math.round(at * SEGMENTS);
        const p = off(centers[k]!, normals[k]!, -R - 0.075);
        const height = p.y - floorY;
        if (height < 0.05) continue;
        for (const dz of [-0.07, 0.07]) {
          const post = new Mesh(
            new CylinderGeometry(0.008, 0.008, height, 10),
            chrome,
          );
          post.position.set(p.x, floorY + height / 2, z + dz);
          post.castShadow = true;
          this.stage.add(post);
        }
      }
      // The sphere, the light it carries and its glow.
      const sphere = new Mesh(new SphereGeometry(R, 64, 32), hero(color));
      sphere.castShadow = true;
      const light = new PointLight(new Color(color), 0.6, 1.4, 2);
      const halo = glowSprite(color, R * 7);
      const trail = new Trail(26);
      const finish = emissive(color, 0.4);
      const line = new Mesh(
        new RoundedBoxGeometry(0.018, 0.012, 0.2, 2, 0.004),
        finish,
      );
      line.position.set(finishX + R * 0.6 + 0.012, finishY - R - 0.004, z);
      const burst = new Burst(40, 11 + i, color, 0.045);
      // Ghosts and speed arrows for the explanation.
      const ghosts: Mesh[] = [];
      const arrows: Group[] = [];
      const ghostMaterial = new StandardMaterial({
        color,
        emissive: new Color(color),
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.6,
        roughness: 0.3,
      });
      const arrowMaterial = new MeshBasicMaterial({
        color: new Color(color).lerp(new Color("#ffffff"), 0.35),
        toneMapped: false,
      });
      for (let k = 0; k < SNAPSHOTS; k += 1) {
        const ghost = new Mesh(
          new SphereGeometry(R * 1.05, 32, 16),
          ghostMaterial,
        );
        const arrow = new Group();
        const shaft = new Mesh(
          new CylinderGeometry(0.016, 0.016, 1, 10),
          arrowMaterial,
        );
        shaft.position.y = 0.5;
        const head = new Mesh(new ConeGeometry(0.05, 0.11, 16), arrowMaterial);
        arrow.add(shaft, head);
        ghosts.push(ghost);
        arrows.push(arrow);
        this.stage.add(ghost, arrow);
      }
      this.stage.add(sphere, light, halo, trail.mesh, line, burst.points);
      this.lanes.push({
        sphere,
        light,
        halo,
        trail,
        strip,
        stripColors,
        finish,
        burst,
        ghosts,
        arrows,
      });
    });

    // Lines joining snapshots taken at the same moment.
    for (let k = 0; k < SNAPSHOTS; k += 1) {
      const geometry = new BufferGeometry().setFromPoints([
        new Vector3(),
        new Vector3(),
      ]);
      const link = new Line(
        geometry,
        new LineDashedMaterial({
          color: COLORS.text,
          dashSize: 0.035,
          gapSize: 0.02,
          transparent: true,
        }),
      );
      this.links.push(link);
      this.stage.add(link);
    }

    // The start tower, its countdown lights and the release gate.
    const towerTop = startY + R + 0.05;
    const tower = new Mesh(
      new RoundedBoxGeometry(0.22, towerTop - floorY, 0.78, 3, 0.02),
      structure,
    );
    tower.position.set(startX - R - 0.01 - 0.11, (towerTop + floorY) / 2, 0);
    tower.castShadow = tower.receiveShadow = true;
    const cap = new Mesh(
      new RoundedBoxGeometry(0.26, 0.03, 0.82, 2, 0.01),
      chrome,
    );
    cap.position.set(tower.position.x, towerTop + 0.015, 0);
    this.stage.add(tower, cap);
    for (let k = 0; k < 3; k += 1) {
      const material = emissive(COLORS.text, 0.05);
      const lamp = new Mesh(
        new RoundedBoxGeometry(0.012, 0.05, 0.14, 2, 0.005),
        material,
      );
      lamp.position.set(startX - R - 0.004, towerTop - 0.06, -0.2 + k * 0.2);
      this.lights.push(material);
      this.stage.add(lamp);
    }
    this.gate = new Mesh(
      new RoundedBoxGeometry(0.03, 0.03, 0.8, 2, 0.012),
      emissive(COLORS.text, 2),
    );
    this.stage.add(this.gate);

    // The finish block and its arch.
    const blockTop = finishY - R - 0.005;
    const block = new Mesh(
      new RoundedBoxGeometry(0.42, blockTop - floorY, 0.82, 3, 0.02),
      structure,
    );
    block.position.set(finishX + R * 0.6 + 0.21, (blockTop + floorY) / 2, 0);
    block.castShadow = block.receiveShadow = true;
    this.stage.add(block);
    // A thin light along the block's far edge, low enough to stay a line.
    const edge = new Mesh(
      new RoundedBoxGeometry(0.014, 0.01, 0.8, 1, 0.004),
      emissive(COLORS.text, 0.8),
    );
    edge.position.set(finishX + R * 0.6 + 0.41, blockTop + 0.004, 0);
    this.stage.add(edge);

    this.streaks = new Streaks(
      90,
      7,
      { min: { x: -1.4, y: -0.8, z: -1 }, max: { x: 1.8, y: 1.1, z: 1.2 } },
      { x: 1, y: -0.55, z: 0 },
      0.35,
    );
    this.motes = new Motes(180, 3, {
      min: { x: -2.2, y: floorY, z: -1.8 },
      max: { x: 2.4, y: 1.6, z: 1.8 },
    });
    this.reveal = new Burst(36, 29, d.lab.style.primary, 0.05);
    this.ring = new Shockwave(d.lab.style.primary);
    this.stage.add(
      this.streaks.lines,
      this.motes.points,
      this.reveal.points,
      this.ring.mesh,
    );
  }

  get canvas() {
    return this.stage.canvas;
  }

  dispose() {
    this.stage.dispose();
  }

  draw(f: number) {
    const colors = [this.d.lab.style.secondary, this.d.lab.style.primary];
    const d = this.d;
    const { lab, fps, arrivals, winner, replay } = d;
    const { beats } = lab;
    const m = momentAt(d, f);
    this.stage.look(m.pose, m.shake);
    const eye = eyeOf(m.pose);

    // Spheres move in the race and in the explanation's replay.
    const racing = m.segment === "run" || m.segment === "replay";
    const explaining = during(
      f,
      beats.explanation + 10,
      beats.closing + 24,
      18,
    );
    const top = Math.sqrt(2 * lab.gravity * lab.drop);
    const flashes = arrivals.map((a) => (f >= a ? Math.exp(-(f - a) / 9) : 0));
    const revealHit =
      f >= beats.reveal ? Math.exp(-(f - beats.reveal) / 12) : 0;
    this.studio.flash(Math.max(flashes[winner]! * 0.6, revealHit));

    // The spheres fade out and pop back in when they jump to the start.
    const presence = presenceAt(d, f);

    d.lanes.forEach((lane, i) => {
      const parts = this.lanes[i]!;
      const color = colors[i]!;
      const state = m.states[i]!;
      const c = m.centers[i]!;
      const speed = state.speed / top;
      const moving = racing && !state.arrived && state.speed > 0;
      parts.sphere.position.set(c.x, c.y, c.z);
      parts.sphere.scale.setScalar(Math.max(0.001, presence));
      parts.sphere.visible = presence > 0.01;
      // The winner is lit for the reveal; the other steps back.
      const crowned = during(f, beats.reveal, beats.explanation, 10);
      const dim = i === winner ? 1 : 1 - crowned * 0.5;
      const glow = i === winner ? revealHit + crowned * 0.35 : 0;
      (parts.sphere.material as MeshStandardMaterial).emissiveIntensity =
        (0.15 + 0.5 * flashes[i]! + glow) * dim;
      parts.light.position.copy(parts.sphere.position);
      parts.light.intensity =
        presence *
        (0.5 + 1.6 * speed * (moving ? 1 : 0) + 2 * flashes[i]! + 1.5 * glow);
      parts.halo.position.copy(parts.sphere.position);
      parts.halo.scale.setScalar(
        R *
          (5 + 4 * speed * (moving ? 1 : 0) + 6 * flashes[i]! + 5 * glow) *
          presence,
      );
      (parts.halo.material as SpriteMaterial).opacity =
        (0.35 + 0.4 * flashes[i]!) * dim;

      // The trail: where the sphere was a moment ago, in simulated time.
      const past: Vec3[] = [];
      if (racing) {
        for (let k = 0; k < 26; k += 1) {
          const s = stateAt(lane.trajectory, Math.max(0, m.time - k * 0.0075));
          past.push(toWorld(lab, s, lane.z));
        }
      }
      parts.trail.update(
        past,
        R * 0.95,
        color,
        moving ? 0.9 * Math.min(1, speed * 1.4) : 0.6 * flashes[i]!,
        eye,
      );

      // The strip: a base glow, the prediction's sweep, the steep part.
      // The hook runs a light down both lanes at once; the prediction
      // lights each in turn.
      const sweepAt =
        f < beats.prediction
          ? 0
          : ramp(
              f,
              beats.prediction + 2 + i * 12,
              beats.prediction + 40 + i * 30,
              EASE.inOutSine,
            );
      const lit = Math.max(
        0.28,
        during(f, beats.prediction + 2 + i * 12, beats.experiment + 20, 8),
      );
      const steep = i === 1 ? explaining * (0.7 + 0.3 * Math.sin(f / 4)) : 0;
      const base = new Color(color);
      for (let k = 0; k <= SEGMENTS; k += 1) {
        const u = k / SEGMENTS;
        const near =
          sweepAt > 0 && sweepAt < 1
            ? Math.exp(-(((u - sweepAt) / 0.07) ** 2))
            : 0;
        const behind =
          u < state.s / lane.trajectory.length && racing ? 0.25 : 0;
        const steepPart = u < 0.34 ? steep * 1.4 : 0;
        const v =
          (lit * 0.55 + behind + near * 2.2 + steepPart) *
          (0.5 + 0.5 * presence);
        for (let s = 0; s < 2; s += 1) {
          const o = (k * 2 + s) * 3;
          parts.stripColors[o] = base.r * v + near * 0.6;
          parts.stripColors[o + 1] = base.g * v + near * 0.6;
          parts.stripColors[o + 2] = base.b * v + near * 0.6;
        }
      }
      parts.strip.geometry.attributes.color!.needsUpdate = true;
      parts.finish.emissiveIntensity =
        0.4 +
        6 * flashes[i]! +
        (f >= arrivals[i]! && f < replay.from ? 1.2 : 0);
      parts.burst.update(
        { x: lab.span / 2, y: -lab.drop / 2, z: lane.z },
        (f - arrivals[i]!) / fps,
        1.1,
        i === winner ? 0.55 : 0.3,
      );

      // Marks at the same moments of the replay, every MARK_STEP seconds,
      // each dropped as the replay passes it, with an arrow for the speed.
      const replayed =
        f >= d.replay.from ? (f < d.replay.to ? m.time : d.replay.end) : -1;
      for (let k = 0; k < SNAPSHOTS; k += 1) {
        const moment = MARK_STEP * (k + 1);
        const dropped =
          replayed >= moment
            ? d.replay.from + moment * lab.replaySlowMotion * fps
            : Infinity;
        const appear = ramp(f, dropped, dropped + 7, EASE.outBack);
        const s = stateAt(lane.trajectory, moment);
        const shown =
          explaining > 0 &&
          appear > 0 &&
          !(s.arrived && moment - lane.trajectory.arrival > 1e-9);
        const ghost = parts.ghosts[k]!;
        const arrow = parts.arrows[k]!;
        ghost.visible = arrow.visible = shown;
        if (!shown) continue;
        const p = toWorld(lab, s, lane.z);
        ghost.position.set(p.x, p.y, p.z);
        ghost.scale.setScalar(appear * explaining);
        const length = s.speed * 0.085 * appear * explaining;
        arrow.position.set(p.x, p.y, p.z);
        // Arrows point along the motion: heading is measured downwards.
        arrow.rotation.set(0, 0, -Math.PI / 2 - s.heading);
        (arrow.children[0] as Mesh).scale.set(1, Math.max(0.001, length), 1);
        (arrow.children[0] as Mesh).position.y = length / 2;
        (arrow.children[1] as Mesh).position.y = length + 0.05;
        if (i === 1) {
          const other = stateAt(d.lanes[0].trajectory, moment);
          const link = this.links[k]!;
          const q = toWorld(lab, other, d.lanes[0].z);
          link.visible = !(
            other.arrived && moment - d.lanes[0].trajectory.arrival > 1e-9
          );
          (link.geometry as BufferGeometry).setFromPoints([
            new Vector3(p.x, p.y, p.z),
            new Vector3(q.x, q.y, q.z),
          ]);
          link.computeLineDistances();
          (link.material as LineDashedMaterial).opacity =
            0.8 * appear * explaining;
        }
      }
    });
    for (const link of this.links) if (explaining <= 0) link.visible = false;

    // The tower's lights flash once as the gate opens; no countdown.
    this.lights.forEach((material) => {
      const go = f >= lab.releaseFrame && f < lab.releaseFrame + 14;
      material.emissive.set(go ? COLORS.primary : COLORS.text);
      material.emissiveIntensity = go
        ? 3.5 * (1 - (f - lab.releaseFrame) / 14)
        : 0.05;
    });
    const open = gateOpen(d, f);
    this.gate.position.set(
      -lab.span / 2 + R * 0.55 - open * 0.32,
      lab.drop / 2 - R * 1.1,
      0,
    );
    this.gate.visible = open < 0.98;

    // Streaks read as rain at this distance: left out.
    this.streaks.update(0);
    this.motes.update(f / fps, d.duration / fps);
    const won = { x: lab.span / 2, y: -lab.drop / 2, z: d.lanes[winner].z };
    // No extra particles at the reveal: the ring and the light carry it.
    this.reveal.update(won, -1, 1, 0);
    this.ring.update(
      { x: won.x + 0.02, y: won.y - R - 0.002, z: won.z },
      { x: 0, y: 1, z: 0 },
      clamp((f - beats.reveal - 2) / 26),
      0.7,
    );
    this.stage.render();
  }
}
