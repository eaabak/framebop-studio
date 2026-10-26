import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encodePng } from "@framebop/ai-adapters";
import {
  call,
  openTestEngine,
  removeTemporaryDirectories,
  temporaryDirectory,
} from "../testing";
import { JobQueue } from "./jobs";

afterAll(removeTemporaryDirectories);

describe("character reference library", () => {
  it("imports a picture into a reference without replacing a scene's media", async () => {
    const dir = await temporaryDirectory();
    const engine = await openTestEngine(dir);
    try {
      const project = await call(engine, "projects.create", {
        name: "Fox story",
      });
      const other = await call(engine, "projects.create", {
        name: "Other story",
      });
      const ref = await call(engine, "visualReferences.save", {
        projectId: project.id,
        kind: "character",
        name: "Fox",
        description: "Orange fox with a white-tipped tail",
        seed: 43,
      });
      const path = join(dir, "fox.png");
      // Real PNG bytes, no network or model execution.
      await writeFile(
        path,
        encodePng(
          2,
          2,
          Buffer.from([255, 100, 0, 255, 100, 0, 255, 100, 0, 255, 100, 0]),
        ),
      );
      const imported = await call(engine, "visualReferences.importImage", {
        referenceId: ref.id,
        sourcePath: path,
      });
      expect(imported.asset.projectId).toBe(project.id);
      expect(imported.reference.assetIds).toEqual([imported.asset.id]);
      expect(imported.reference.seed).toBe(43);
      expect(await readFile(path)).toBeDefined();
      await expect(
        call(engine, "visualReferences.save", {
          projectId: other.id,
          kind: "character",
          name: "Invalid",
          assetIds: [imported.asset.id],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await writeFile(join(dir, "fake.png"), "not a picture");
      await expect(
        call(engine, "visualReferences.importImage", {
          referenceId: ref.id,
          sourcePath: join(dir, "fake.png"),
        }),
      ).rejects.toBeDefined();
      expect(
        (
          await call(engine, "visualReferences.list", { projectId: project.id })
        )[0]?.assetIds,
      ).toEqual([imported.asset.id]);
    } finally {
      await engine.close();
    }
  });
});

describe("model memory exclusion", () => {
  it("holds queued video work while an external writer or preview owns model memory", async () => {
    const engine = await openTestEngine(await temporaryDirectory());
    const queue = new JobQueue(engine.context);
    let busy = true,
      runs = 0;
    engine.context.modelBusy = () => busy;
    queue.register("video_generation", {
      canCancel: () => true,
      run: async () => {
        runs++;
        return { output: {} };
      },
    });
    try {
      const job = queue.submit({
        type: "video_generation",
        label: "Video",
        adapterId: "test",
        model: null,
        projectId: null,
        episodeId: null,
        sceneId: null,
        slot: null,
        input: {},
      });
      expect(runs).toBe(0);
      expect(engine.context.db.jobs.get(job.id)?.status).toBe("pending");
      busy = false;
      for (let i = 0; i < 60 && runs === 0; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      await queue.idle();
      expect(runs).toBe(1);
      expect(engine.context.db.jobs.get(job.id)?.status).toBe("completed");
    } finally {
      await queue.shutdown();
      await engine.close();
    }
  });
});
