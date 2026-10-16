/** Helpers shared by the engine's test suites. Not part of the bundle. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterRegistry,
  HostPlatform,
  SecretStore,
} from "@framebop/ai-adapters";
import {
  type CatalogEntry,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  rpcContract,
} from "@framebop/core";
import { type Engine, createEngine } from "./engine";
import type { LocalLlmOptions } from "./services/llm";

const temporaryDirectories: string[] = [];

export async function temporaryDirectory(
  prefix = "framebop-test-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

export async function removeTemporaryDirectories(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

/** A host with no external tools, so tests behave the same on every machine. */
export const bareHost: HostPlatform = {
  os: "linux",
  arch: "x64",
  executableName: (program) => program,
  toolDirectories: () => [],
  findApplication: async () => null,
};

export function openTestEngine(
  dataDir: string,
  options: {
    host?: HostPlatform;
    registry?: AdapterRegistry;
    modelCatalog?: CatalogEntry[];
    huggingFaceEndpoint?: string;
    youtubeEndpoint?: string;
    secretStore?: SecretStore | null;
    llm?: LocalLlmOptions;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<Engine> {
  return createEngine({
    dataDir,
    host: options.host ?? bareHost,
    env: options.env ?? { PATH: "" },
    registry: options.registry,
    // Tests never reach the real Hugging Face unless they say so.
    modelCatalog: options.modelCatalog ?? [],
    huggingFaceEndpoint: options.huggingFaceEndpoint ?? "http://127.0.0.1:9",
    // Nor YouTube, nor the computer's real keychain.
    youtubeEndpoint: options.youtubeEndpoint ?? "http://127.0.0.1:9",
    secretStore: options.secretStore ?? null,
    llm: options.llm,
  });
}

/**
 * Calls the engine and checks the result against the public contract, so
 * every test doubles as a contract test for the methods it touches.
 */
export async function call<M extends RpcMethod>(
  engine: Engine,
  method: M,
  params: RpcParams<M>,
): Promise<RpcResult<M>> {
  const result = await engine.dispatch(method, params);
  return rpcContract[method].result.parse(result) as RpcResult<M>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Writes a file that starts like a PNG. `seed` varies the content hash. */
export async function writePng(
  directory: string,
  name: string,
  seed = 0,
): Promise<string> {
  const path = join(directory, name);
  await writeFile(
    path,
    Buffer.from([...PNG_SIGNATURE, seed, 1, 2, 3, 4, 5, 6, 7]),
  );
  return path;
}

/** Writes a file that starts like an MP4 (`ftyp` box). */
export async function writeMp4(
  directory: string,
  name: string,
  seed = 0,
): Promise<string> {
  const path = join(directory, name);
  const header = Buffer.from([
    0,
    0,
    0,
    0x18,
    ...Buffer.from("ftypisom"),
    0,
    0,
    2,
    0,
  ]);
  await writeFile(path, Buffer.concat([header, Buffer.alloc(64, seed)]));
  return path;
}
