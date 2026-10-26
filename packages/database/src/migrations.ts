import { rmSync } from "node:fs";
import { AppError } from "@framebop/core";
import type { Connection } from "./connection";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Forward-only, append-only. Never edit a migration that has shipped: add a
 * new one. Each runs inside its own transaction.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        target_duration_seconds INTEGER NOT NULL,
        language TEXT NOT NULL,
        visual_style TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE episodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        sequence_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        script TEXT NOT NULL DEFAULT '',
        production_state TEXT NOT NULL DEFAULT 'draft'
          CHECK (production_state IN ('draft', 'in_production', 'ready', 'exported')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX episodes_project_idx ON episodes(project_id, sequence_index);

      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        origin TEXT NOT NULL CHECK (origin IN ('imported', 'generated')),
        relative_path TEXT NOT NULL UNIQUE,
        thumbnail_path TEXT,
        original_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_seconds REAL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX assets_project_hash_idx ON assets(project_id, sha256);

      CREATE TABLE scenes (
        id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        sequence_index INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        duration_seconds REAL NOT NULL,
        narration_text TEXT NOT NULL DEFAULT '',
        image_prompt TEXT NOT NULL DEFAULT '',
        motion_prompt TEXT NOT NULL DEFAULT '',
        camera_motion TEXT NOT NULL DEFAULT 'static',
        camera_instructions TEXT NOT NULL DEFAULT '',
        animation_engine TEXT,
        image_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        video_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        audio_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        generation_state TEXT NOT NULL DEFAULT 'idle'
          CHECK (generation_state IN ('idle', 'queued', 'generating', 'ready', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX scenes_episode_idx ON scenes(episode_id, sequence_index);

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        label TEXT NOT NULL,
        progress REAL,
        engine TEXT,
        model TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
        scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      ) STRICT;
      CREATE INDEX jobs_created_idx ON jobs(created_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "production-job-queue",
    // SQLite cannot alter a CHECK constraint, so the table is rebuilt and
    // existing rows are carried over with their names translated.
    sql: `
      CREATE TABLE jobs_next (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN (
          'media_import', 'image_generation', 'video_generation',
          'audio_generation', 'video_render')),
        status TEXT NOT NULL CHECK (status IN (
          'pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
        label TEXT NOT NULL,
        progress REAL,
        progress_message TEXT,
        adapter_id TEXT,
        model TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
        scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
        slot TEXT CHECK (slot IN ('image', 'video', 'audio')),
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        output_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        error_message TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        retry_of_job_id TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO jobs_next (
        id, type, status, label, progress, adapter_id, model, project_id,
        episode_id, scene_id, slot, input_json, output_json, output_asset_id,
        error_code, error_message, created_at, started_at, finished_at, updated_at)
      SELECT
        id,
        CASE type
          WHEN 'asset.import' THEN 'media_import'
          WHEN 'image.generate' THEN 'image_generation'
          WHEN 'video.generate' THEN 'video_generation'
          WHEN 'speech.synthesize' THEN 'audio_generation'
          ELSE 'video_render'
        END,
        CASE
          WHEN status = 'succeeded' THEN 'completed'
          WHEN status = 'failed' AND error_code = 'INTERRUPTED' THEN 'interrupted'
          -- A job cannot still be waiting or working across an upgrade.
          WHEN status IN ('queued', 'running') THEN 'interrupted'
          ELSE status
        END,
        label,
        CASE WHEN status = 'succeeded' THEN progress END,
        CASE WHEN engine = 'manual-import' THEN NULL ELSE engine END,
        model,
        project_id,
        episode_id,
        scene_id,
        CASE WHEN json_extract(input_json, '$.slot') IN ('image', 'video', 'audio')
          THEN json_extract(input_json, '$.slot') END,
        input_json,
        output_json,
        (SELECT a.id FROM assets a
          WHERE a.id = json_extract(jobs.output_json, '$.assetId')),
        error_code,
        error_message,
        created_at,
        started_at,
        finished_at,
        COALESCE(finished_at, started_at, created_at)
      FROM jobs;

      DROP TABLE jobs;
      ALTER TABLE jobs_next RENAME TO jobs;

      CREATE INDEX jobs_created_idx ON jobs(created_at);
      CREATE INDEX jobs_status_idx ON jobs(status, created_at);
      -- At most one waiting or running job per scene slot and kind of work.
      -- The queue checks this itself; the index makes it impossible to violate.
      CREATE UNIQUE INDEX jobs_one_active_per_target_idx
        ON jobs(type, scene_id, slot)
        WHERE status IN ('pending', 'running') AND scene_id IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: "model-manager",
    sql: `
      -- The curated catalog, mirrored from code at every start so that
      -- installations can reference what they installed.
      CREATE TABLE model_catalog (
        id TEXT PRIMARY KEY,
        definition_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE model_installations (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES model_catalog(id),
        revision TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'queued', 'downloading', 'verifying', 'installed',
          'failed', 'cancelled', 'interrupted')),
        storage_root TEXT NOT NULL,
        directory TEXT NOT NULL UNIQUE,
        bytes_total INTEGER NOT NULL,
        bytes_done INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        verification TEXT NOT NULL DEFAULT 'pending'
          CHECK (verification IN ('pending', 'verified', 'failed')),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      ) STRICT;
      -- One installation per catalog model: a second download of the same
      -- model is never started next to the first.
      CREATE UNIQUE INDEX model_installations_model_idx
        ON model_installations(model_id);

      CREATE TABLE model_sources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('folder', 'huggingface-cache')),
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        added_at TEXT NOT NULL,
        last_scanned_at TEXT,
        last_error TEXT
      ) STRICT;

      CREATE TABLE external_models (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES model_sources(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        format TEXT NOT NULL,
        repo_id TEXT,
        revision TEXT,
        matched_model_id TEXT,
        discovered_at TEXT NOT NULL,
        UNIQUE (source_id, path)
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "rendering",
    sql: `
      -- How a scene begins, and text shown over it.
      ALTER TABLE scenes ADD COLUMN transition TEXT NOT NULL DEFAULT 'cut'
        CHECK (transition IN ('cut', 'fade'));
      ALTER TABLE scenes ADD COLUMN overlay_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE scenes ADD COLUMN overlay_position TEXT NOT NULL DEFAULT 'bottom'
        CHECK (overlay_position IN ('top', 'center', 'bottom'));

      -- Background music for a whole episode.
      ALTER TABLE episodes ADD COLUMN music_asset_id TEXT
        REFERENCES assets(id) ON DELETE SET NULL;
      ALTER TABLE episodes ADD COLUMN music_volume REAL NOT NULL DEFAULT 0.15
        CHECK (music_volume >= 0 AND music_volume <= 1);

      -- Exported videos. The files belong to the user and are never deleted
      -- by the application; forgetting an episode forgets only these rows.
      CREATE TABLE renders (
        id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        job_id TEXT,
        path TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        fps REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        size_bytes INTEGER NOT NULL,
        validation_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX renders_by_episode ON renders(episode_id, created_at);
    `,
  },
  {
    version: 5,
    name: "model-gallery",
    sql: `
      -- The last registry fetched on request, kept so it survives a restart
      -- and works offline. The registry bundled with the app is the fallback.
      CREATE TABLE registry_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        url TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      ) STRICT;

      -- Models the user added from Hugging Face, pinned to a commit.
      CREATE TABLE imported_models (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        imported_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 6,
    name: "video-research",
    sql: `
      -- Video DNA Lab. Every row records its source and when it was taken.
      CREATE TABLE research_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE reference_videos (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('youtube')),
        video_id TEXT NOT NULL,
        url TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL,
        UNIQUE (project_id, platform, video_id)
      ) STRICT;

      CREATE TABLE metadata_snapshots (
        id TEXT PRIMARY KEY,
        reference_video_id TEXT NOT NULL REFERENCES reference_videos(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('youtube-data-api', 'manual')),
        retrieved_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        requests_json TEXT NOT NULL,
        quota_units INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX metadata_snapshots_by_video
        ON metadata_snapshots(reference_video_id, retrieved_at);

      -- At most one sample per video: starting over replaces it.
      CREATE TABLE comment_samples (
        id TEXT PRIMARY KEY,
        reference_video_id TEXT NOT NULL UNIQUE REFERENCES reference_videos(id) ON DELETE CASCADE,
        sort_order TEXT NOT NULL CHECK (sort_order IN ('relevance', 'time')),
        status TEXT NOT NULL CHECK (status IN ('more-available', 'complete', 'comments-disabled')),
        next_page_token TEXT,
        pages_fetched INTEGER NOT NULL,
        reported_total INTEGER,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      -- Top-level public comments. Authors are deliberately not stored.
      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        sample_id TEXT NOT NULL REFERENCES comment_samples(id) ON DELETE CASCADE,
        comment_id TEXT NOT NULL,
        text TEXT NOT NULL,
        like_count INTEGER,
        reply_count INTEGER,
        published_at TEXT,
        position INTEGER NOT NULL,
        UNIQUE (sample_id, comment_id)
      ) STRICT;
      CREATE INDEX comments_by_sample ON comments(sample_id, position);

      CREATE TABLE transcripts (
        id TEXT PRIMARY KEY,
        reference_video_id TEXT NOT NULL REFERENCES reference_videos(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('webvtt', 'srt', 'text')),
        language TEXT,
        rights_basis TEXT NOT NULL,
        rights_note TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        segment_count INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        has_timestamps INTEGER NOT NULL,
        covered_seconds REAL,
        warnings_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE transcript_segments (
        id TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        start_ms INTEGER,
        end_ms INTEGER,
        text TEXT NOT NULL
      ) STRICT;
      CREATE INDEX transcript_segments_by_transcript
        ON transcript_segments(transcript_id, position);

      CREATE TABLE research_findings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
        reference_video_id TEXT REFERENCES reference_videos(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        statement TEXT NOT NULL,
        basis TEXT NOT NULL CHECK (basis IN ('observed', 'inferred')),
        generator TEXT NOT NULL CHECK (generator IN ('framebop-rules', 'user', 'local-model')),
        method TEXT NOT NULL,
        uncertainty TEXT,
        confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX research_findings_by_video
        ON research_findings(reference_video_id, position);

      -- What a finding rests on. The target is a snapshot, sample, comment,
      -- transcript or segment; the excerpt keeps the evidence readable if
      -- that source is later deleted.
      CREATE TABLE evidence_references (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('metadata-snapshot', 'comment-sample', 'comment', 'transcript', 'transcript-segment')),
        target_id TEXT NOT NULL,
        locator TEXT,
        excerpt TEXT,
        source TEXT NOT NULL,
        retrieved_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX evidence_by_finding ON evidence_references(finding_id, position);
    `,
  },
  {
    version: 7,
    name: "local-language-model",
    // The jobs table is rebuilt to allow the new job type (SQLite cannot
    // alter a CHECK constraint). No other table refers to it.
    sql: `
      CREATE TABLE jobs_next (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN (
          'media_import', 'image_generation', 'video_generation',
          'audio_generation', 'video_render', 'research_analysis')),
        status TEXT NOT NULL CHECK (status IN (
          'pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
        label TEXT NOT NULL,
        progress REAL,
        progress_message TEXT,
        adapter_id TEXT,
        model TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
        scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
        slot TEXT CHECK (slot IN ('image', 'video', 'audio')),
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        output_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        error_message TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        retry_of_job_id TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO jobs_next SELECT
        id, type, status, label, progress, progress_message, adapter_id, model,
        project_id, episode_id, scene_id, slot, input_json, output_json,
        output_asset_id, metadata_json, error_code, error_message, attempt,
        retry_of_job_id, cancel_requested_at, created_at, started_at,
        finished_at, updated_at
      FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_next RENAME TO jobs;
      CREATE INDEX jobs_created_idx ON jobs(created_at);
      CREATE INDEX jobs_status_idx ON jobs(status, created_at);
      CREATE UNIQUE INDEX jobs_one_active_per_target_idx
        ON jobs(type, scene_id, slot)
        WHERE status IN ('pending', 'running') AND scene_id IS NOT NULL;

      -- Video DNA analyses by the local language model.
      CREATE TABLE research_analyses (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
        reference_video_id TEXT NOT NULL REFERENCES reference_videos(id) ON DELETE CASCADE,
        job_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'loading-model', 'analyzing',
          'validating', 'completed', 'failed', 'cancelled', 'interrupted')),
        model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        runtime TEXT,
        config_json TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        sections_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      ) STRICT;
      CREATE INDEX research_analyses_by_video
        ON research_analyses(reference_video_id, created_at);

      -- Real test runs of a language model with a runtime build.
      CREATE TABLE llm_inference_checks (
        model_id TEXT NOT NULL,
        runtime TEXT NOT NULL,
        ok INTEGER NOT NULL,
        detail TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (model_id, runtime)
      ) STRICT;
    `,
  },
  {
    version: 8,
    name: "story-architect",
    sql: `
      CREATE TABLE jobs_next (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN (
          'media_import', 'image_generation', 'video_generation',
          'audio_generation', 'video_render', 'research_analysis',
          'story_generation')),
        status TEXT NOT NULL CHECK (status IN (
          'pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
        label TEXT NOT NULL,
        progress REAL,
        progress_message TEXT,
        adapter_id TEXT,
        model TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
        scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
        slot TEXT CHECK (slot IN ('image', 'video', 'audio')),
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        output_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        error_message TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        retry_of_job_id TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO jobs_next SELECT
        id, type, status, label, progress, progress_message, adapter_id, model,
        project_id, episode_id, scene_id, slot, input_json, output_json,
        output_asset_id, metadata_json, error_code, error_message, attempt,
        retry_of_job_id, cancel_requested_at, created_at, started_at,
        finished_at, updated_at
      FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_next RENAME TO jobs;
      CREATE INDEX jobs_created_idx ON jobs(created_at);
      CREATE INDEX jobs_status_idx ON jobs(status, created_at);
      CREATE UNIQUE INDEX jobs_one_active_per_target_idx
        ON jobs(type, scene_id, slot)
        WHERE status IN ('pending', 'running') AND scene_id IS NOT NULL;

      -- Story drafts developed from Video DNA concepts. The editable draft
      -- and its generation state are one JSON document.
      CREATE TABLE story_drafts (
        id TEXT PRIMARY KEY,
        research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
        reference_video_id TEXT NOT NULL REFERENCES reference_videos(id) ON DELETE CASCADE,
        analysis_id TEXT NOT NULL,
        concept_item_id TEXT NOT NULL,
        draft_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        source_fingerprint TEXT NOT NULL,
        handoff_json TEXT,
        production_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX story_drafts_by_project ON story_drafts(research_project_id, updated_at);

      -- Earlier saved versions of each draft, newest kept.
      CREATE TABLE story_draft_revisions (
        draft_id TEXT NOT NULL REFERENCES story_drafts(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        draft_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (draft_id, revision)
      ) STRICT;
    `,
  },
  {
    version: 9,
    name: "production-blueprint",
    sql: `
      -- One production plan per scene: how its picture will be made, what it
      -- needs, and what came with it from a story draft.
      CREATE TABLE scene_plans (
        scene_id TEXT PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,
        method TEXT NOT NULL CHECK (method IN ('static-image', 'layered-2d',
          'video-clip', 'image-generation', 'image-to-video')),
        engine_id TEXT,
        model TEXT,
        required_assets_json TEXT NOT NULL DEFAULT '[]',
        claims_json TEXT NOT NULL DEFAULT '[]',
        research_json TEXT NOT NULL DEFAULT '[]',
        duration_source TEXT NOT NULL CHECK (duration_source IN ('estimate', 'manual', 'audio')),
        notes TEXT NOT NULL DEFAULT '',
        proposed_narration TEXT,
        proposal_job_id TEXT,
        story_draft_id TEXT,
        draft_scene_id TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 10,
    name: "layered-2d-animation",
    sql: `
      -- The 2D animation a layered-2d scene is drawn from, as JSON.
      ALTER TABLE scene_plans ADD COLUMN animation_json TEXT;
    `,
  },
  {
    version: 11,
    name: "scene-media-production",
    sql: `
      -- The phase a running generation has reached.
      ALTER TABLE jobs ADD COLUMN stage TEXT;

      -- Characters, places and styles that several scenes share.
      CREATE TABLE visual_references (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('character', 'environment', 'style')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        palette TEXT NOT NULL DEFAULT '',
        asset_ids_json TEXT NOT NULL DEFAULT '[]',
        seed INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX visual_references_by_project ON visual_references(project_id, name);

      ALTER TABLE scene_plans ADD COLUMN visual_reference_ids_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 12,
    name: "scene-assembly",
    sql: `
      -- The shots a scene shows and its subtitle text, as JSON:
      -- {"shots": [...], "captionText": null}.
      ALTER TABLE scene_plans ADD COLUMN assembly_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 13,
    name: "scene-doctor",
    sql: `
      CREATE TABLE jobs_next (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN (
          'media_import', 'image_generation', 'video_generation',
          'audio_generation', 'video_render', 'research_analysis',
          'story_generation', 'video_inspection')),
        status TEXT NOT NULL CHECK (status IN (
          'pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
        label TEXT NOT NULL,
        progress REAL,
        progress_message TEXT,
        adapter_id TEXT,
        model TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
        scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
        slot TEXT CHECK (slot IN ('image', 'video', 'audio')),
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        output_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        error_message TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        retry_of_job_id TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        stage TEXT
      ) STRICT;
      INSERT INTO jobs_next SELECT
        id, type, status, label, progress, progress_message, adapter_id, model,
        project_id, episode_id, scene_id, slot, input_json, output_json,
        output_asset_id, metadata_json, error_code, error_message, attempt,
        retry_of_job_id, cancel_requested_at, created_at, started_at,
        finished_at, updated_at, stage
      FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_next RENAME TO jobs;
      CREATE INDEX jobs_created_idx ON jobs(created_at);
      CREATE INDEX jobs_status_idx ON jobs(status, created_at);
      CREATE UNIQUE INDEX jobs_one_active_per_target_idx
        ON jobs(type, scene_id, slot)
        WHERE status IN ('pending', 'running') AND scene_id IS NOT NULL;

      -- Scene Doctor reports. The inspected video is referenced, never
      -- copied or changed; evidence pictures live under media/inspections.
      CREATE TABLE inspections (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        name TEXT NOT NULL,
        source_json TEXT NOT NULL,
        thresholds_json TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        overview_json TEXT,
        scenes_json TEXT NOT NULL DEFAULT '[]',
        issues_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;
      CREATE INDEX inspections_by_date ON inspections(created_at);
    `,
  },

  {
    version: 14,
    name: "text-to-video-production",
    sql: `
      CREATE TABLE scene_plans_next (
        scene_id TEXT PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,
        method TEXT NOT NULL CHECK (method IN ('static-image', 'layered-2d',
          'video-clip', 'image-generation', 'image-to-video', 'text-to-video')),
        engine_id TEXT,
        model TEXT,
        required_assets_json TEXT NOT NULL DEFAULT '[]',
        claims_json TEXT NOT NULL DEFAULT '[]',
        research_json TEXT NOT NULL DEFAULT '[]',
        duration_source TEXT NOT NULL CHECK (duration_source IN ('estimate', 'manual', 'audio')),
        notes TEXT NOT NULL DEFAULT '',
        proposed_narration TEXT,
        proposal_job_id TEXT,
        story_draft_id TEXT,
        draft_scene_id TEXT,
        updated_at TEXT NOT NULL,
        animation_json TEXT,
        visual_reference_ids_json TEXT NOT NULL DEFAULT '[]',
        assembly_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;
      INSERT INTO scene_plans_next (scene_id, method, engine_id, model, required_assets_json, claims_json, research_json, duration_source, notes, proposed_narration, proposal_job_id, story_draft_id, draft_scene_id, updated_at, animation_json, visual_reference_ids_json, assembly_json)
        SELECT scene_id, method, engine_id, model, required_assets_json, claims_json, research_json, duration_source, notes, proposed_narration, proposal_job_id, story_draft_id, draft_scene_id, updated_at, animation_json, visual_reference_ids_json, assembly_json FROM scene_plans;
      DROP TABLE scene_plans;
      ALTER TABLE scene_plans_next RENAME TO scene_plans;
    `,
  },
];

export const LATEST_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/** Brings the database up to date and returns the versions applied by this call. */
export interface MigrateOptions {
  /**
   * Where to write a snapshot of the database before upgrading it from the
   * given schema version. No snapshot is taken when omitted.
   */
  backupPath?: (fromVersion: number) => string;
}

export function migrate(
  connection: Connection,
  migrations: readonly Migration[] = MIGRATIONS,
  options: MigrateOptions = {},
): number[] {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const current = Number(
    connection.get(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    )?.version,
  );
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (current > latest) {
    // Refuse rather than guess: an older build must never write to a newer schema.
    throw new AppError(
      "CONFLICT",
      `This library was last opened by a newer version of Framebop Studio (schema ${current}, this build supports ${latest}). Update the app to open it.`,
    );
  }

  const pending = migrations.filter((migration) => migration.version > current);
  // Upgrading rewrites tables that hold the user's work. Keep a snapshot of
  // the library as it was, so a faulty migration can never be the only copy.
  if (current > 0 && pending.length > 0 && options.backupPath) {
    const target = options.backupPath(current);
    rmSync(target, { force: true });
    connection.run("VACUUM INTO :target", { target });
  }

  const applied: number[] = [];
  for (const migration of pending) {
    connection.transaction(() => {
      connection.exec(migration.sql);
      connection.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (:version, :name, :at)",
        {
          version: migration.version,
          name: migration.name,
          at: new Date().toISOString(),
        },
      );
    });
    applied.push(migration.version);
  }
  return applied;
}
