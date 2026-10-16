import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const frame = Buffer.alloc(body.length + 8);
  frame.writeUInt32BE(data.length, 0);
  body.copy(frame, 4);
  frame.writeUInt32BE(crc32(body), body.length + 4);
  return frame;
}

/**
 * Encodes 8-bit RGB pixels as a PNG file.
 *
 * Small and dependency-free on purpose: it lets the test adapter produce a
 * real image on any platform, inside the single-file engine bundle, without
 * a native image library.
 */
export function encodePng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Buffer {
  const stride = width * 3;
  if (rgb.length !== stride * height) {
    throw new RangeError("Pixel data does not match the image dimensions.");
  }
  // Each scanline is prefixed with its filter type; 0 means unfiltered.
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    scanlines.set(
      rgb.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // colour type: RGB
  // Compression, filter and interlace methods stay at their only/default value, 0.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
