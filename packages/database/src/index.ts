import {
  ScenePlanRepository,
  VisualReferenceRepository,
} from "./blueprint-repositories";
import { Connection } from "./connection";
import { InspectionRepository } from "./doctor-repositories";
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from "./migrations";
import { ModelRepository } from "./model-repositories";
import { RenderRepository } from "./render-repositories";
import { ResearchRepository } from "./research-repositories";
import { StoryRepository } from "./story-repositories";
import {
  AssetRepository,
  EpisodeRepository,
  JobRepository,
  ProjectRepository,
  SceneRepository,
  SettingsRepository,
} from "./repositories";

export { Connection } from "./connection";
export { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from "./migrations";
export type { JobChanges } from "./repositories";
export type { InstallationChanges } from "./model-repositories";
export type { StoredRender } from "./render-repositories";
export type { CommentSort, StoredFinding } from "./research-repositories";
export type { StoredStoryDraft } from "./story-repositories";

export interface LibraryDatabase {
  readonly connection: Connection;
  readonly schemaVersion: number;
  readonly projects: ProjectRepository;
  readonly episodes: EpisodeRepository;
  readonly scenes: SceneRepository;
  readonly assets: AssetRepository;
  readonly jobs: JobRepository;
  readonly settings: SettingsRepository;
  readonly models: ModelRepository;
  readonly renders: RenderRepository;
  readonly research: ResearchRepository;
  readonly stories: StoryRepository;
  readonly plans: ScenePlanRepository;
  readonly visualReferences: VisualReferenceRepository;
  readonly inspections: InspectionRepository;
  transaction<T>(work: () => T): T;
  close(): void;
}

/** Opens (creating if needed) the library database at `path` and migrates it. */
export function openLibraryDatabase(path: string): LibraryDatabase {
  const connection = new Connection(path);
  try {
    migrate(connection, MIGRATIONS, {
      backupPath: (version) => `${path}.before-schema-${version + 1}.backup`,
    });
  } catch (error) {
    connection.close();
    throw error;
  }
  const assets = new AssetRepository(connection);
  return {
    connection,
    schemaVersion: LATEST_SCHEMA_VERSION,
    projects: new ProjectRepository(connection, assets),
    episodes: new EpisodeRepository(connection, assets),
    scenes: new SceneRepository(connection),
    assets,
    jobs: new JobRepository(connection),
    settings: new SettingsRepository(connection),
    models: new ModelRepository(connection),
    renders: new RenderRepository(connection),
    research: new ResearchRepository(connection),
    stories: new StoryRepository(connection),
    plans: new ScenePlanRepository(connection),
    visualReferences: new VisualReferenceRepository(connection),
    inspections: new InspectionRepository(connection),
    transaction: (work) => connection.transaction(work),
    close: () => connection.close(),
  };
}
