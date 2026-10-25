/**
 * Materials and small textures that keep the look consistent: polished
 * metal, glossy coloured objects, emissive accents and soft glows.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";

/** Dark brushed metal for structures. */
export function structureMaterial(color = "#1c2230"): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.38 });
}

/** Bright polished metal for rails and trims. */
export function chromeMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: "#c9d2e3",
    metalness: 1,
    roughness: 0.16,
  });
}

/** A lacquered, coloured object with a clear coat and a faint inner glow. */
export function hero(color: string): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    metalness: 0.1,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    emissive: new Color(color),
    emissiveIntensity: 0.18,
  });
}

/** A surface that glows in a colour; scale `emissiveIntensity` to pulse. */
export function emissive(color: string, intensity = 1): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: "#05070a",
    emissive: new Color(color),
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
  });
}

let glow: Texture | null = null;

/** A soft round falloff, white, for additive glows and particles. */
export function glowTexture(): Texture {
  if (glow) return glow;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.65)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  glow = new CanvasTexture(canvas);
  glow.colorSpace = SRGBColorSpace;
  return glow;
}

/** An additive glow that always faces the camera. */
export function glowSprite(color: string, size: number): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: new Color(color),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}
