/**
 * A Three.js stage for motion graphics: a dark studio with a reflective
 * floor, soft shadows, studio reflections on every material, a key light
 * and two coloured rims. It never animates on its own: a scene sets every
 * object for a frame, then calls `render`, so a frame always looks the same.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { CameraPose, Vec3 } from "./camera";
import { applyPose } from "./lens";

export { type ScreenBox, fitShot, project } from "./lens";

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  constructor(
    readonly width: number,
    readonly height: number,
    background: string,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      // The render takes its picture after drawing; keep what was drawn.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene.background = new Color(background);
    this.camera = new PerspectiveCamera(35, width / height, 0.03, 80);
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  add(...objects: Object3D[]) {
    this.scene.add(...objects);
  }

  /** Points the camera; `offset` moves the target (a shake). */
  look(pose: CameraPose, offset?: Vec3) {
    applyPose(this.camera, pose, this.width / this.height, offset);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse((object) => {
      const mesh = object as Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const material of materials) material.dispose();
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export interface StudioRig {
  key: SpotLight;
  rims: [DirectionalLight, DirectionalLight];
  fill: HemisphereLight;
  /** 0..1 extra light for flashes. */
  flash(amount: number): void;
}

/**
 * The studio around a set: an infinite dark backdrop that fades into fog, a
 * floor that reflects softly and takes shadows, and the lights.
 */
export function buildStudio(
  stage: Stage,
  {
    floorY,
    rims,
    centre = { x: 0, y: 0, z: 0 },
  }: { floorY: number; rims: [string, string]; centre?: Vec3 },
): StudioRig {
  const background = stage.scene.background as Color;
  stage.scene.fog = new Fog(background, 5, 16);

  // A dome with a soft lighter band behind the set.
  const dome = new Mesh(
    new SphereGeometry(30, 48, 24),
    new MeshBasicMaterial({
      map: domeTexture(`#${background.getHexString()}`),
      side: BackSide,
      fog: false,
    }),
  );
  dome.position.set(centre.x, floorY, centre.z);

  const reflector = new Reflector(new PlaneGeometry(24, 24), {
    clipBias: 0.003,
    textureWidth: Math.round(stage.width / 2),
    textureHeight: Math.round(stage.height / 2),
    // Dim: a soft sheen under the set, not a second copy of it.
    color: 0x3c424f,
  });
  reflector.rotateX(-Math.PI / 2);
  reflector.position.set(centre.x, floorY - 0.002, centre.z);
  const floor = new Mesh(
    new PlaneGeometry(24, 24),
    new MeshStandardMaterial({
      color: background.clone().offsetHSL(0, 0, 0.012),
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.95,
    }),
  );
  floor.rotateX(-Math.PI / 2);
  floor.position.set(centre.x, floorY, centre.z);
  floor.receiveShadow = true;

  const key = new SpotLight(0xffffff, 60, 14, 0.62, 0.65, 1.6);
  key.position.set(centre.x - 1.6, floorY + 5.2, centre.z + 2.6);
  key.target.position.set(centre.x, floorY + 0.4, centre.z);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 14;

  const rimA = new DirectionalLight(new Color(rims[0]), 0.85);
  rimA.position.set(centre.x - 4, floorY + 2.4, centre.z - 4);
  const rimB = new DirectionalLight(new Color(rims[1]), 0.85);
  rimB.position.set(centre.x + 4, floorY + 2.2, centre.z - 3.5);
  const fill = new HemisphereLight(0x9fb4d8, 0x05060a, 0.35);

  stage.add(dome, reflector, floor, key, key.target, rimA, rimB, fill);
  const base = { key: key.intensity, fill: fill.intensity };
  return {
    key,
    rims: [rimA, rimB],
    fill,
    flash(amount) {
      key.intensity = base.key * (1 + amount * 0.8);
      fill.intensity = base.fill * (1 + amount * 2);
    },
  };
}

function domeTexture(background: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 512;
  const g = canvas.getContext("2d")!;
  const gradient = g.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, background);
  gradient.addColorStop(0.42, "#141a27");
  gradient.addColorStop(0.5, "#1a2131");
  gradient.addColorStop(0.56, "#121723");
  gradient.addColorStop(1, background);
  g.fillStyle = gradient;
  g.fillRect(0, 0, 8, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
