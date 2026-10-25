/**
 * The lens: how a camera pose maps the world onto the picture, and how a
 * shot is composed from the points it must show. Shared by the 3D stage,
 * the overlays drawn over it, and anything that plans shots.
 */
import { PerspectiveCamera, Vector3 } from "three";
import { type CameraPose, type Vec3, eyeOf } from "./camera";

export function applyPose(
  camera: PerspectiveCamera,
  pose: CameraPose,
  aspect: number,
  offset?: Vec3,
) {
  const target = offset
    ? {
        x: pose.target.x + offset.x,
        y: pose.target.y + offset.y,
        z: pose.target.z + offset.z,
      }
    : pose.target;
  const eye = eyeOf({ ...pose, target });
  camera.position.set(eye.x, eye.y, eye.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(target.x, target.y, target.z);
  camera.rotateZ(pose.roll);
  camera.fov = pose.fov;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

const scratch = new PerspectiveCamera();
const point = new Vector3();

/**
 * Where a world point lands in the picture for a pose, in pixels, without
 * a stage: overlays and the 3D world share the camera this way.
 */
export function project(
  pose: CameraPose,
  width: number,
  height: number,
  p: Vec3,
  offset?: Vec3,
): { x: number; y: number; depth: number; scale: number } {
  applyPose(scratch, pose, width / height, offset);
  point.set(p.x, p.y, p.z).applyMatrix4(scratch.matrixWorldInverse);
  const depth = -point.z;
  point.applyMatrix4(scratch.projectionMatrix);
  // Pixels per world unit at that depth.
  const scale = height / 2 / Math.tan((pose.fov * Math.PI) / 360) / depth;
  return {
    x: ((point.x + 1) / 2) * width,
    y: ((1 - point.y) / 2) * height,
    depth,
    scale,
  };
}

export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Frames a shot: keeps the angle, lens and roll of `angle` and finds the
 * target and distance that fit `points` into `box` on the picture. Vertical
 * video leaves little room across, so shots are composed this way rather
 * than by guessing distances.
 */
export function fitShot(
  angle: Pick<CameraPose, "yaw" | "pitch" | "fov" | "roll">,
  points: readonly Vec3[],
  box: ScreenBox,
  width: number,
  height: number,
): CameraPose {
  const n = points.length;
  let target = {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
    z: points.reduce((s, p) => s + p.z, 0) / n,
  };
  let distance = 3;
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  const right = new Vector3();
  const up = new Vector3();
  for (let i = 0; i < 60; i += 1) {
    const pose = { ...angle, target, distance };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const q = project(pose, width, height, p);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    const ratio = Math.max((maxX - minX) / boxW, (maxY - minY) / boxH, 1e-3);
    // Pixels per world unit at the target, to turn a pixel error into a move.
    const scale = height / 2 / Math.tan((angle.fov * Math.PI) / 360) / distance;
    const dx = (minX + maxX) / 2 - (box.left + box.right) / 2;
    const dy = (minY + maxY) / 2 - (box.top + box.bottom) / 2;
    scratch.matrixWorld.extractBasis(right, up, point);
    target = {
      x: target.x + (right.x * dx - up.x * dy) / scale,
      y: target.y + (right.y * dx - up.y * dy) / scale,
      z: target.z + (right.z * dx - up.z * dy) / scale,
    };
    distance = Math.min(40, Math.max(0.2, distance * ratio ** 0.8));
  }
  return { ...angle, target, distance };
}
