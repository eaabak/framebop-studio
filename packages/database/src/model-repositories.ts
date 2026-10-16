import type {
  CatalogEntry,
  ExternalModel,
  InstallationState,
  ModelInstallation,
  ModelSource,
} from "@framebop/core";
import type { Connection, Row, SqlParams, SqlValue } from "./connection";

const text = (row: Row, column: string): string => row[column] as string;
const optionalText = (row: Row, column: string): string | null =>
  (row[column] as string | null) ?? null;
const numeric = (row: Row, column: string): number => Number(row[column]);

function toInstallation(row: Row): ModelInstallation {
  const errorCode = optionalText(row, "error_code");
  return {
    id: text(row, "id"),
    modelId: text(row, "model_id"),
    revision: text(row, "revision"),
    state: text(row, "state") as InstallationState,
    storageRoot: text(row, "storage_root"),
    directory: text(row, "directory"),
    bytesTotal: numeric(row, "bytes_total"),
    bytesDone: numeric(row, "bytes_done"),
    currentFile: optionalText(row, "current_file"),
    verification: text(
      row,
      "verification",
    ) as ModelInstallation["verification"],
    error:
      errorCode === null
        ? null
        : {
            code: errorCode,
            message: optionalText(row, "error_message") ?? "",
          },
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    startedAt: optionalText(row, "started_at"),
    completedAt: optionalText(row, "completed_at"),
  };
}

function toSource(row: Row): ModelSource {
  return {
    id: text(row, "id"),
    kind: text(row, "kind") as ModelSource["kind"],
    path: text(row, "path"),
    label: text(row, "label"),
    addedAt: text(row, "added_at"),
    lastScannedAt: optionalText(row, "last_scanned_at"),
    lastError: optionalText(row, "last_error"),
  };
}

function toExternal(row: Row): ExternalModel {
  return {
    id: text(row, "id"),
    sourceId: text(row, "source_id"),
    path: text(row, "path"),
    name: text(row, "name"),
    sizeBytes: numeric(row, "size_bytes"),
    format: text(row, "format"),
    repoId: optionalText(row, "repo_id"),
    revision: optionalText(row, "revision"),
    matchedModelId: optionalText(row, "matched_model_id"),
    discoveredAt: text(row, "discovered_at"),
  };
}

export type InstallationChanges = Partial<
  Pick<
    ModelInstallation,
    | "state"
    | "bytesDone"
    | "bytesTotal"
    | "currentFile"
    | "verification"
    | "error"
    | "startedAt"
    | "completedAt"
  >
>;

export class ModelRepository {
  constructor(private readonly db: Connection) {}

  /** Mirrors the catalog shipped in code. Entries no longer shipped are kept
   * while an installation still refers to them. */
  syncCatalog(entries: readonly CatalogEntry[], updatedAt: string): void {
    this.db.transaction(() => {
      for (const entry of entries) {
        this.db.run(
          `INSERT INTO model_catalog (id, definition_json, updated_at)
           VALUES (:id, :definition, :updatedAt)
           ON CONFLICT(id) DO UPDATE SET
             definition_json = excluded.definition_json,
             updated_at = excluded.updated_at`,
          { id: entry.id, definition: JSON.stringify(entry), updatedAt },
        );
      }
      this.db.run(
        `DELETE FROM model_catalog
         WHERE id NOT IN (SELECT value FROM json_each(:ids))
           AND id NOT IN (SELECT model_id FROM model_installations)`,
        { ids: JSON.stringify(entries.map((entry) => entry.id)) },
      );
    });
  }

  catalogIds(): string[] {
    return this.db
      .all("SELECT id FROM model_catalog ORDER BY id")
      .map((row) => text(row, "id"));
  }

  getInstallation(modelId: string): ModelInstallation | null {
    const row = this.db.get(
      "SELECT * FROM model_installations WHERE model_id = :modelId",
      { modelId },
    );
    return row ? toInstallation(row) : null;
  }

  listInstallations(): ModelInstallation[] {
    return this.db
      .all("SELECT * FROM model_installations ORDER BY created_at")
      .map(toInstallation);
  }

  insertInstallation(installation: ModelInstallation): void {
    this.db.run(
      `INSERT INTO model_installations (id, model_id, revision, state, storage_root, directory,
         bytes_total, bytes_done, current_file, verification, error_code, error_message,
         created_at, updated_at, started_at, completed_at)
       VALUES (:id, :modelId, :revision, :state, :storageRoot, :directory,
         :bytesTotal, :bytesDone, :currentFile, :verification, :errorCode, :errorMessage,
         :createdAt, :updatedAt, :startedAt, :completedAt)`,
      {
        id: installation.id,
        modelId: installation.modelId,
        revision: installation.revision,
        state: installation.state,
        storageRoot: installation.storageRoot,
        directory: installation.directory,
        bytesTotal: installation.bytesTotal,
        bytesDone: installation.bytesDone,
        currentFile: installation.currentFile,
        verification: installation.verification,
        errorCode: installation.error?.code ?? null,
        errorMessage: installation.error?.message ?? null,
        createdAt: installation.createdAt,
        updatedAt: installation.updatedAt,
        startedAt: installation.startedAt,
        completedAt: installation.completedAt,
      },
    );
  }

  updateInstallation(
    id: string,
    changes: InstallationChanges,
    updatedAt: string,
  ): void {
    const assignments = ["updated_at = :updated_at"];
    const params: SqlParams = { id, updated_at: updatedAt };
    const set = (column: string, value: SqlValue) => {
      assignments.push(`${column} = :${column}`);
      params[column] = value;
    };
    if (changes.state !== undefined) set("state", changes.state);
    if (changes.bytesDone !== undefined) set("bytes_done", changes.bytesDone);
    if (changes.bytesTotal !== undefined)
      set("bytes_total", changes.bytesTotal);
    if (changes.currentFile !== undefined)
      set("current_file", changes.currentFile);
    if (changes.verification !== undefined)
      set("verification", changes.verification);
    if (changes.error !== undefined) {
      set("error_code", changes.error?.code ?? null);
      set("error_message", changes.error?.message ?? null);
    }
    if (changes.startedAt !== undefined) set("started_at", changes.startedAt);
    if (changes.completedAt !== undefined)
      set("completed_at", changes.completedAt);
    this.db.run(
      `UPDATE model_installations SET ${assignments.join(", ")} WHERE id = :id`,
      params,
    );
  }

  deleteInstallation(id: string): void {
    this.db.run("DELETE FROM model_installations WHERE id = :id", { id });
  }

  /**
   * Downloads left in progress by a previous process. They are marked
   * interrupted and wait for the user: nothing is downloaded at startup.
   */
  markActiveAsInterrupted(at: string): number {
    return this.db.run(
      `UPDATE model_installations
       SET state = 'interrupted', updated_at = :at, current_file = NULL,
           error_code = 'INTERRUPTED',
           error_message = 'The application closed during the download. Resume to continue where it stopped.'
       WHERE state IN ('queued', 'downloading', 'verifying')`,
      { at },
    );
  }

  listSources(): ModelSource[] {
    return this.db
      .all("SELECT * FROM model_sources ORDER BY added_at")
      .map(toSource);
  }

  getSource(id: string): ModelSource | null {
    const row = this.db.get("SELECT * FROM model_sources WHERE id = :id", {
      id,
    });
    return row ? toSource(row) : null;
  }

  insertSource(source: ModelSource): void {
    this.db.run(
      `INSERT INTO model_sources (id, kind, path, label, added_at, last_scanned_at, last_error)
       VALUES (:id, :kind, :path, :label, :addedAt, :lastScannedAt, :lastError)`,
      { ...source },
    );
  }

  deleteSource(id: string): boolean {
    return this.db.run("DELETE FROM model_sources WHERE id = :id", { id }) > 0;
  }

  /** Replaces what is known about one source with a fresh scan. */
  replaceExternal(
    sourceId: string,
    models: readonly ExternalModel[],
    scannedAt: string,
    error: string | null,
  ): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM external_models WHERE source_id = :sourceId", {
        sourceId,
      });
      for (const model of models) {
        this.db.run(
          `INSERT INTO external_models (id, source_id, path, name, size_bytes, format,
             repo_id, revision, matched_model_id, discovered_at)
           VALUES (:id, :sourceId, :path, :name, :sizeBytes, :format,
             :repoId, :revision, :matchedModelId, :discoveredAt)`,
          { ...model },
        );
      }
      this.db.run(
        `UPDATE model_sources SET last_scanned_at = :scannedAt, last_error = :error
         WHERE id = :sourceId`,
        { sourceId, scannedAt, error },
      );
    });
  }

  getRegistryCache(): {
    url: string;
    manifestJson: string;
    fetchedAt: string;
  } | null {
    const row = this.db.get("SELECT * FROM registry_cache WHERE id = 1");
    return row
      ? {
          url: text(row, "url"),
          manifestJson: text(row, "manifest_json"),
          fetchedAt: text(row, "fetched_at"),
        }
      : null;
  }

  setRegistryCache(url: string, manifestJson: string, fetchedAt: string): void {
    this.db.run(
      `INSERT INTO registry_cache (id, url, manifest_json, fetched_at)
       VALUES (1, :url, :manifestJson, :fetchedAt)
       ON CONFLICT(id) DO UPDATE SET url = excluded.url,
         manifest_json = excluded.manifest_json, fetched_at = excluded.fetched_at`,
      { url, manifestJson, fetchedAt },
    );
  }

  clearRegistryCache(): void {
    this.db.run("DELETE FROM registry_cache");
  }

  listImported(): { id: string; definitionJson: string; importedAt: string }[] {
    return this.db
      .all("SELECT * FROM imported_models ORDER BY imported_at, id")
      .map((row) => ({
        id: text(row, "id"),
        definitionJson: text(row, "definition_json"),
        importedAt: text(row, "imported_at"),
      }));
  }

  insertImported(
    id: string,
    repoId: string,
    definitionJson: string,
    importedAt: string,
  ): void {
    this.db.run(
      `INSERT INTO imported_models (id, repo_id, definition_json, imported_at)
       VALUES (:id, :repoId, :definitionJson, :importedAt)`,
      { id, repoId, definitionJson, importedAt },
    );
  }

  deleteImported(id: string): boolean {
    return (
      this.db.run("DELETE FROM imported_models WHERE id = :id", { id }) > 0
    );
  }

  listExternal(): ExternalModel[] {
    return this.db
      .all("SELECT * FROM external_models ORDER BY source_id, path")
      .map(toExternal);
  }
}
