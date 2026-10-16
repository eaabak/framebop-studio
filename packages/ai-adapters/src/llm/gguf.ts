/**
 * Reads the metadata at the start of a GGUF file: format version, model
 * architecture and the few numbers needed to describe the model and estimate
 * its memory use. Values are only read, never interpreted as instructions;
 * the chat template a file may carry is never used (see llama-cpp.ts).
 */
import { open } from "node:fs/promises";

export interface GgufInfo {
  version: number;
  architecture: string | null;
  name: string | null;
  /** llama.cpp's file type number (the quantization), when stated. */
  fileType: number | null;
  blockCount: number | null;
  trainedContextTokens: number | null;
  embeddingLength: number | null;
  headCount: number | null;
  headCountKv: number | null;
  keyLength: number | null;
  valueLength: number | null;
  /** Whether the file carries its own chat template (it is not used). */
  hasChatTemplate: boolean;
}

/** Metadata larger than this is refused rather than read. */
const MAX_METADATA_BYTES = 256 * 1024 * 1024;
const MAX_KEYS = 100_000;

class Reader {
  private buffer = Buffer.alloc(0);
  private offset = 0;
  private position = 0;
  private consumed = 0;

  constructor(private readonly file: Awaited<ReturnType<typeof open>>) {}

  private async ensure(bytes: number): Promise<void> {
    if (this.consumed + bytes > MAX_METADATA_BYTES) {
      throw new Error("The GGUF metadata is unreasonably large.");
    }
    while (this.buffer.length - this.offset < bytes) {
      const chunk = Buffer.alloc(Math.max(1 << 20, bytes));
      const { bytesRead } = await this.file.read(
        chunk,
        0,
        chunk.length,
        this.position,
      );
      if (bytesRead === 0)
        throw new Error("The file ends inside its GGUF metadata.");
      this.position += bytesRead;
      this.buffer = Buffer.concat([
        this.buffer.subarray(this.offset),
        chunk.subarray(0, bytesRead),
      ]);
      this.offset = 0;
    }
  }

  async take(bytes: number): Promise<Buffer> {
    await this.ensure(bytes);
    const slice = this.buffer.subarray(this.offset, this.offset + bytes);
    this.offset += bytes;
    this.consumed += bytes;
    return slice;
  }

  async u32(): Promise<number> {
    return (await this.take(4)).readUInt32LE(0);
  }

  async u64(): Promise<number> {
    const value = (await this.take(8)).readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("A GGUF length is out of range.");
    return Number(value);
  }

  async string(): Promise<string> {
    const length = await this.u64();
    return (await this.take(length)).toString("utf8");
  }
}

// GGUF value types.
const SCALAR_BYTES: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
};
const STRING = 8;
const ARRAY = 9;

async function readValue(reader: Reader, type: number): Promise<unknown> {
  if (type === STRING) return reader.string();
  if (type === ARRAY) {
    const itemType = await reader.u32();
    const length = await reader.u64();
    // Arrays (vocabularies, merges) are skipped: nothing here needs them.
    for (let index = 0; index < length; index += 1)
      await readValue(reader, itemType);
    return null;
  }
  const bytes = SCALAR_BYTES[type];
  if (bytes === undefined) throw new Error(`Unknown GGUF value type ${type}.`);
  const raw = await reader.take(bytes);
  switch (type) {
    case 0:
      return raw.readUInt8(0);
    case 1:
      return raw.readInt8(0);
    case 2:
      return raw.readUInt16LE(0);
    case 3:
      return raw.readInt16LE(0);
    case 4:
      return raw.readUInt32LE(0);
    case 5:
      return raw.readInt32LE(0);
    case 6:
      return raw.readFloatLE(0);
    case 7:
      return raw.readUInt8(0) !== 0;
    case 10:
      return Number(raw.readBigUInt64LE(0));
    case 11:
      return Number(raw.readBigInt64LE(0));
    default:
      return raw.readDoubleLE(0);
  }
}

/** Reads a GGUF file's header. Throws with a plain reason if it is not one. */
export async function readGgufInfo(path: string): Promise<GgufInfo> {
  const file = await open(path, "r");
  try {
    const reader = new Reader(file);
    if ((await reader.take(4)).toString("latin1") !== "GGUF") {
      throw new Error("This is not a GGUF file.");
    }
    const version = await reader.u32();
    if (version < 2 || version > 3)
      throw new Error(`GGUF version ${version} is not supported.`);
    await reader.u64(); // tensor count
    const keyCount = await reader.u64();
    if (keyCount > MAX_KEYS)
      throw new Error("The GGUF metadata has too many entries.");

    const values = new Map<string, unknown>();
    let hasChatTemplate = false;
    for (let index = 0; index < keyCount; index += 1) {
      const key = await reader.string();
      const type = await reader.u32();
      const value = await readValue(reader, type);
      if (key === "tokenizer.chat_template") hasChatTemplate = true;
      else if (typeof value === "string" || typeof value === "number")
        values.set(key, value);
    }
    const architecture =
      typeof values.get("general.architecture") === "string"
        ? (values.get("general.architecture") as string)
        : null;
    const number = (suffix: string): number | null => {
      const value = architecture
        ? values.get(`${architecture}.${suffix}`)
        : undefined;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const fileType = values.get("general.file_type");
    return {
      version,
      architecture,
      name:
        typeof values.get("general.name") === "string"
          ? (values.get("general.name") as string)
          : null,
      fileType: typeof fileType === "number" ? fileType : null,
      blockCount: number("block_count"),
      trainedContextTokens: number("context_length"),
      embeddingLength: number("embedding_length"),
      headCount: number("attention.head_count"),
      headCountKv: number("attention.head_count_kv"),
      keyLength: number("attention.key_length"),
      valueLength: number("attention.value_length"),
      hasChatTemplate,
    };
  } finally {
    await file.close();
  }
}

/**
 * Bytes of the key and value cache at a context length, with 16-bit entries
 * (llama.cpp's default), computed from the file's own metadata. Null when
 * the file does not state what the formula needs.
 */
export function kvCacheBytes(
  info: GgufInfo,
  contextTokens: number,
): number | null {
  const { blockCount, headCount, headCountKv, embeddingLength } = info;
  if (!blockCount || !headCount || !embeddingLength) return null;
  const kvHeads = headCountKv ?? headCount;
  const keyLength = info.keyLength ?? embeddingLength / headCount;
  const valueLength = info.valueLength ?? embeddingLength / headCount;
  return blockCount * contextTokens * kvHeads * (keyLength + valueLength) * 2;
}
