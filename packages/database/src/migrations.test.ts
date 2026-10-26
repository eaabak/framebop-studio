import { describe, expect, it } from "vitest";
import { Connection } from "./connection";
import { MIGRATIONS, migrate } from "./migrations";

describe("text-to-video schema upgrade", () => {
  it("preserves complete existing scene plans and their foreign-key behavior", () => {
    const db = new Connection(":memory:");
    try {
      migrate(
        db,
        MIGRATIONS.filter((m) => m.version <= 13),
      );
      db.exec(`
        INSERT INTO projects (id,name,target_duration_seconds,language,created_at,updated_at) VALUES ('project','Fox story',5,'en','now','now');
        INSERT INTO episodes (id,project_id,sequence_index,title,created_at,updated_at) VALUES ('episode','project',0,'Episode','now','now');
        INSERT INTO scenes (id,episode_id,sequence_index,duration_seconds,created_at,updated_at) VALUES ('scene','episode',0,5,'now','now');
        INSERT INTO scene_plans (scene_id,method,engine_id,model,duration_source,notes,animation_json,visual_reference_ids_json,assembly_json,updated_at)
          VALUES ('scene','image-to-video','old-engine','old-model','manual','Keep this','{"images":{}}','["reference"]','{"shots":[]}', 'now');
      `);
      const before = db.get("SELECT * FROM scene_plans WHERE scene_id='scene'");
      expect(migrate(db)).toEqual([14]);
      expect(
        db.get("SELECT * FROM scene_plans WHERE scene_id='scene'"),
      ).toEqual(before);
      db.exec(
        "UPDATE scene_plans SET method='text-to-video' WHERE scene_id='scene'",
      );
      expect(
        db.get("SELECT method FROM scene_plans WHERE scene_id='scene'")?.method,
      ).toBe("text-to-video");
      expect(db.all("PRAGMA foreign_key_check")).toEqual([]);
      db.exec("DELETE FROM scenes WHERE id='scene'");
      expect(
        db.get("SELECT * FROM scene_plans WHERE scene_id='scene'"),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
