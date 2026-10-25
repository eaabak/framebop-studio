/**
 * Motion accents: trails, bursts, shock rings, speed streaks and floating
 * dust. Each is updated from values for one frame; none keeps its own time.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Vector3,
} from "three";
import { type Vec3 } from "./camera";
import { glowTexture } from "./look";

/** A seeded generator, so scattered things land in the same places. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ribbon through recent positions that faces the camera and fades out. */
export class Trail {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly color = new Color();

  constructor(private readonly length: number) {
    const geometry = new BufferGeometry();
    this.positions = new Float32Array(length * 2 * 3);
    this.colors = new Float32Array(length * 2 * 4);
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new BufferAttribute(this.colors, 4));
    const index: number[] = [];
    for (let i = 0; i < length - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  /** `points` newest first; `width` at the head; `alpha` overall. */
  update(
    points: readonly Vec3[],
    width: number,
    color: string,
    alpha: number,
    eye: Vec3,
  ) {
    this.mesh.visible = alpha > 0.005 && points.length > 1;
    if (!this.mesh.visible) return;
    this.color.set(color);
    const n = this.length;
    const dir = new Vector3();
    const view = new Vector3();
    const side = new Vector3();
    for (let i = 0; i < n; i += 1) {
      const p = points[Math.min(i, points.length - 1)]!;
      const q = points[Math.min(i + 1, points.length - 1)]!;
      const r = points[Math.max(i - 1, 0)]!;
      dir.set(q.x - r.x, q.y - r.y, q.z - r.z);
      if (dir.lengthSq() < 1e-12) dir.set(1, 0, 0);
      view.set(eye.x - p.x, eye.y - p.y, eye.z - p.z);
      side.crossVectors(dir, view).normalize();
      const f = 1 - i / (n - 1);
      const w = width * (0.15 + 0.85 * f);
      for (const [k, s] of [
        [0, 1],
        [1, -1],
      ] as const) {
        const v = (i * 2 + k) * 3;
        this.positions[v] = p.x + side.x * w * s;
        this.positions[v + 1] = p.y + side.y * w * s;
        this.positions[v + 2] = p.z + side.z * w * s;
        const c = (i * 2 + k) * 4;
        const a = alpha * f * f;
        this.colors[c] = this.color.r * a;
        this.colors[c + 1] = this.color.g * a;
        this.colors[c + 2] = this.color.b * a;
        this.colors[c + 3] = a;
      }
    }
    const geometry = this.mesh.geometry;
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
  }
}

/** Sparks thrown out from a point and falling back. */
export class Burst {
  readonly points: Points;
  private readonly positions: Float32Array;
  private readonly velocities: Vec3[] = [];

  constructor(count: number, seed: number, color: string, size = 0.05) {
    const next = seeded(seed);
    this.positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = next() * Math.PI * 2;
      const up = 0.4 + next() * 0.9;
      const speed = 0.4 + next() * 0.9;
      this.velocities.push({
        x: Math.cos(a) * speed * 0.8,
        y: up * speed,
        z: Math.sin(a) * speed * 0.8,
      });
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    this.points = new Points(
      geometry,
      new PointsMaterial({
        map: glowTexture(),
        color: new Color(color),
        size,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** `age` in seconds since the burst; `life` how long it lasts. */
  update(origin: Vec3, age: number, life: number, strength = 1) {
    const material = this.points.material as PointsMaterial;
    this.points.visible = age >= 0 && age <= life;
    if (!this.points.visible) return;
    this.velocities.forEach((v, i) => {
      this.positions[i * 3] = origin.x + v.x * age;
      this.positions[i * 3 + 1] = origin.y + v.y * age - 1.6 * age * age;
      this.positions[i * 3 + 2] = origin.z + v.z * age;
    });
    material.opacity = strength * (1 - age / life) ** 1.5;
    this.points.geometry.attributes.position!.needsUpdate = true;
  }
}

/** A flat ring that grows and fades, lying in a plane facing `normal`. */
export class Shockwave {
  readonly mesh: Mesh;
  constructor(color: string) {
    this.mesh = new Mesh(
      new RingGeometry(0.92, 1, 96),
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
  }

  update(centre: Vec3, normal: Vec3, progress: number, radius: number) {
    this.mesh.visible = progress > 0 && progress < 1;
    if (!this.mesh.visible) return;
    this.mesh.position.set(centre.x, centre.y, centre.z);
    this.mesh.lookAt(
      centre.x + normal.x,
      centre.y + normal.y,
      centre.z + normal.z,
    );
    const r = radius * (1 - (1 - progress) ** 3);
    this.mesh.scale.set(r, r, r);
    (this.mesh.material as MeshBasicMaterial).opacity = (1 - progress) ** 1.4;
  }
}

/**
 * Fixed streaks of light along a direction, scattered through a box. They
 * stay still in the world, so a moving camera passes them: speed you feel.
 */
export class Streaks {
  readonly lines: LineSegments;
  constructor(
    count: number,
    seed: number,
    box: { min: Vec3; max: Vec3 },
    direction: Vec3,
    length: number,
  ) {
    const next = seeded(seed);
    const positions = new Float32Array(count * 6);
    const d = new Vector3(direction.x, direction.y, direction.z).normalize();
    for (let i = 0; i < count; i += 1) {
      const x = box.min.x + next() * (box.max.x - box.min.x);
      const y = box.min.y + next() * (box.max.y - box.min.y);
      const z = box.min.z + next() * (box.max.z - box.min.z);
      const l = length * (0.4 + next() * 0.6);
      positions.set([x, y, z, x + d.x * l, y + d.y * l, z + d.z * l], i * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.lines = new LineSegments(
      geometry,
      new LineBasicMaterial({
        color: "#cfe3ff",
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: true,
      }),
    );
  }

  update(opacity: number) {
    this.lines.visible = opacity > 0.005;
    (this.lines.material as LineBasicMaterial).opacity = opacity;
  }
}

/** Dust drifting slowly in the light, for depth. */
export class Motes {
  readonly points: Points;
  private readonly base: Float32Array;
  private readonly positions: Float32Array;

  constructor(count: number, seed: number, box: { min: Vec3; max: Vec3 }) {
    const next = seeded(seed);
    this.base = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      this.base[i * 3] = box.min.x + next() * (box.max.x - box.min.x);
      this.base[i * 3 + 1] = box.min.y + next() * (box.max.y - box.min.y);
      this.base[i * 3 + 2] = box.min.z + next() * (box.max.z - box.min.z);
    }
    this.positions = this.base.slice();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    this.points = new Points(
      geometry,
      new PointsMaterial({
        map: glowTexture(),
        color: "#9fb2d6",
        size: 0.025,
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** `time` in seconds; a loop of `period` seconds keeps the video seamless. */
  update(time: number, period: number) {
    const w = (2 * Math.PI) / period;
    for (let i = 0; i < this.base.length / 3; i += 1) {
      const k = (i % 3) + 1;
      this.positions[i * 3] =
        this.base[i * 3]! + Math.sin(w * k * time + i) * 0.06;
      this.positions[i * 3 + 1] =
        this.base[i * 3 + 1]! + Math.sin(w * time + i * 1.7) * 0.05;
      this.positions[i * 3 + 2] =
        this.base[i * 3 + 2]! + Math.cos(w * k * time + i) * 0.04;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
  }
}
