/**
 * Frictionless sliding under uniform gravity, solved ahead of time.
 *
 * A path is a dense polyline from the start. Energy is conserved, so the
 * speed after falling a height h is sqrt(2 g h) whatever the path. Along each
 * straight piece the acceleration is constant, so the piece takes exactly
 * 2 ds / (v0 + v1), and the position at any moment inside it follows from
 * v0 and that acceleration. This is exact for the straight track and
 * converges quickly for the curve; tests compare both with the closed forms.
 *
 * Coordinates are metres with x to the right and y downwards from the start.
 * Nothing depends on earlier frames: `stateAt` answers for any time alone.
 */

export interface PathPoint {
  x: number;
  y: number;
}

export interface Trajectory {
  points: readonly PathPoint[];
  /** Arc length at each point. */
  s: Float64Array;
  /** Time each point is reached, from the release. */
  t: Float64Array;
  /** Speed at each point. */
  v: Float64Array;
  length: number;
  /** Time to reach the last point. */
  arrival: number;
  gravity: number;
}

export interface SlideState {
  x: number;
  y: number;
  /** Distance travelled along the path. */
  s: number;
  speed: number;
  /** Direction of travel, radians, measured from +x towards +y (down). */
  heading: number;
  /** 0 at the start, 1 at the finish, by distance. */
  progress: number;
  arrived: boolean;
}

/** Points along the straight line from the start to (span, drop). */
export function straightPath(
  span: number,
  drop: number,
  count = 2000,
): PathPoint[] {
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: (span * i) / count,
    y: (drop * i) / count,
  }));
}

/**
 * The cycloid from the start through (span, drop): x = r(θ − sin θ),
 * y = r(1 − cos θ). Its end angle solves (θ − sin θ) / (1 − cos θ) =
 * span / drop, which grows steadily on (0, 2π), so bisection finds it.
 */
export function cycloidThrough(
  span: number,
  drop: number,
): { radius: number; theta: number } {
  const ratio = span / drop;
  const f = (theta: number) =>
    (theta - Math.sin(theta)) / (1 - Math.cos(theta)) - ratio;
  let lo = 1e-9;
  let hi = 2 * Math.PI - 1e-9;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  const theta = (lo + hi) / 2;
  return { theta, radius: drop / (1 - Math.cos(theta)) };
}

/**
 * Points along that cycloid, evenly in θ. Arc length grows like θ², so the
 * points crowd together near the start, where the speed changes fastest.
 */
export function cycloidPath(
  span: number,
  drop: number,
  count = 4000,
): PathPoint[] {
  const { radius, theta } = cycloidThrough(span, drop);
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = (theta * i) / count;
    return {
      x: radius * (angle - Math.sin(angle)),
      y: radius * (1 - Math.cos(angle)),
    };
  });
}

/** Solves the slide along a path, from rest at its first point. */
export function simulateSlide(
  points: readonly PathPoint[],
  gravity: number,
): Trajectory {
  const n = points.length;
  const s = new Float64Array(n);
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  const y0 = points[0]!.y;
  for (let i = 1; i < n; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    const fallen = b.y - y0;
    if (fallen < 0) {
      throw new Error("The path rises above its start; the object stops.");
    }
    v[i] = Math.sqrt(2 * gravity * fallen);
    s[i] = s[i - 1]! + ds;
    const sum = v[i - 1]! + v[i]!;
    if (sum <= 0) throw new Error("The path does not start downhill.");
    t[i] = t[i - 1]! + (2 * ds) / sum;
  }
  return {
    points,
    s,
    t,
    v,
    length: s[n - 1]!,
    arrival: t[n - 1]!,
    gravity,
  };
}

/** Where the object is `time` seconds after the release. */
export function stateAt(trajectory: Trajectory, time: number): SlideState {
  const { points, s, t, v } = trajectory;
  const last = points.length - 1;
  const heading = (i: number) => {
    const a = points[Math.max(0, Math.min(last - 1, i))]!;
    const b = points[Math.max(1, Math.min(last, i + 1))]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  if (time <= 0) {
    return {
      ...points[0]!,
      s: 0,
      speed: 0,
      heading: heading(0),
      progress: 0,
      arrived: false,
    };
  }
  if (time >= trajectory.arrival) {
    return {
      ...points[last]!,
      s: trajectory.length,
      speed: v[last]!,
      heading: heading(last - 1),
      progress: 1,
      arrived: true,
    };
  }
  // The piece being travelled: t[i] <= time < t[i + 1].
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= time) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const ds = s[i + 1]! - s[i]!;
  const v0 = v[i]!;
  const accel = (v[i + 1]! * v[i + 1]! - v0 * v0) / (2 * ds);
  const tau = time - t[i]!;
  const along = Math.min(ds, v0 * tau + 0.5 * accel * tau * tau);
  const f = ds > 0 ? along / ds : 0;
  const a = points[i]!;
  const b = points[i + 1]!;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    s: s[i]! + along,
    speed: v0 + accel * tau,
    heading: Math.atan2(b.y - a.y, b.x - a.x),
    progress: (s[i]! + along) / trajectory.length,
    arrived: false,
  };
}

/** Closed-form arrival times, to check the numerical ones against. */
export function exactArrivals(
  span: number,
  drop: number,
  gravity: number,
): { straight: number; cycloid: number } {
  const { radius, theta } = cycloidThrough(span, drop);
  return {
    // Constant acceleration g·drop/L along a line of length L.
    straight: Math.sqrt((2 * (span * span + drop * drop)) / (gravity * drop)),
    cycloid: theta * Math.sqrt(radius / gravity),
  };
}
