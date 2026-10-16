/**
 * The contract AI analysis will follow once a local language model is
 * available (Phase 5A.2). Nothing here runs a model.
 *
 * An analyzer reads only an evidence bundle, the data collected for one
 * reference video, and returns inferred findings. Before anything is saved,
 * `checkInferredFindings` rejects findings without a stated confidence or
 * without evidence that exists in the bundle, and replaces every quote with
 * the stored text, so a model can neither invent a source nor misquote one.
 */
import type {
  AnalysisCapability,
  AnalysisTask,
  MetadataSnapshot,
  Transcript,
} from "@framebop/core";
import {
  type CommentInput,
  type EvidenceDraft,
  type FindingDraft,
  type SegmentInput,
  excerpt,
} from "./analysis";

export interface EvidenceBundle {
  snapshot: MetadataSnapshot | null;
  comments: readonly CommentInput[];
  transcripts: readonly {
    transcript: Transcript;
    segments: readonly SegmentInput[];
  }[];
  /** The stored comment sample the comments come from, if any. */
  commentSampleId?: string | null;
  commentsRetrievedAt?: string | null;
}

/** The part of a text generation provider an analyzer needs. */
export interface TextGenerator {
  generate(request: {
    messages: readonly {
      role: "system" | "user" | "assistant";
      content: string;
    }[];
    maxTokens: number;
    temperature: number;
    jsonSchema?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
    finishReason?: string;
  }>;
}

export const PLANNED_ANALYSES: Record<
  AnalysisTask,
  Pick<AnalysisCapability, "label" | "description">
> = {
  hooks: {
    label: "Hook",
    description:
      "The opening premise, what makes a viewer curious, and how the setup leads in. Never retention.",
  },
  narrative: {
    label: "Narrative structure",
    description:
      "Sections in order, with transitions, examples and the conclusion, from the transcript.",
  },
  pacing: {
    label: "Pacing",
    description:
      "Speech density, section lengths and pauses from real timestamps. Nothing visual.",
  },
  audience: {
    label: "Audience signals",
    description:
      "Recurring questions, criticism, requests and gaps in the retrieved comments. No demographics.",
  },
  concepts: {
    label: "Original concepts",
    description:
      "New video ideas that answer what the research found, never rewrites of the reference.",
  },
  language: {
    label: "Language strategy",
    description:
      "Localization directions, with observations kept apart from market hypotheses.",
  },
};

export interface CheckedFindings {
  accepted: FindingDraft[];
  rejected: { draft: FindingDraft; problems: string[] }[];
}

export function checkInferredFindings(
  drafts: readonly FindingDraft[],
  bundle: EvidenceBundle,
): CheckedFindings {
  const comments = new Map(
    bundle.comments.map((comment) => [comment.id, comment]),
  );
  const segments = new Map<
    string,
    { segment: SegmentInput; transcript: Transcript }
  >();
  for (const { transcript, segments: list } of bundle.transcripts) {
    for (const segment of list)
      segments.set(segment.id, { segment, transcript });
  }
  const transcripts = new Map(
    bundle.transcripts.map(({ transcript }) => [transcript.id, transcript]),
  );

  /** The evidence as stored, or null if the bundle has no such item. */
  function ground(item: EvidenceDraft): EvidenceDraft | null {
    switch (item.kind) {
      case "comment": {
        const comment = comments.get(item.targetId);
        return comment
          ? {
              ...item,
              excerpt: excerpt(comment.text),
              source: "youtube-data-api",
            }
          : null;
      }
      case "transcript-segment": {
        const found = segments.get(item.targetId);
        return found
          ? {
              ...item,
              excerpt: excerpt(found.segment.text),
              source: "transcript-file",
              retrievedAt: found.transcript.importedAt,
            }
          : null;
      }
      case "transcript": {
        const transcript = transcripts.get(item.targetId);
        return transcript
          ? {
              ...item,
              excerpt: transcript.fileName,
              source: "transcript-file",
              retrievedAt: transcript.importedAt,
            }
          : null;
      }
      case "metadata-snapshot":
        return bundle.snapshot && bundle.snapshot.id === item.targetId
          ? {
              ...item,
              source: bundle.snapshot.source,
              retrievedAt: bundle.snapshot.retrievedAt,
            }
          : null;
      default:
        return null;
    }
  }

  const result: CheckedFindings = { accepted: [], rejected: [] };
  for (const draft of drafts) {
    const problems: string[] = [];
    if (draft.confidence === null) {
      problems.push("A model's finding must state its confidence.");
    }
    const evidence = draft.evidence.map(ground);
    if (evidence.length === 0) {
      problems.push("A finding must cite at least one item of collected data.");
    }
    evidence.forEach((item, index) => {
      if (item === null) {
        problems.push(
          `Evidence ${index + 1} (${draft.evidence[index]?.kind}) is not in the collected data.`,
        );
      }
    });
    if (problems.length > 0) {
      result.rejected.push({ draft, problems });
    } else {
      result.accepted.push({
        ...draft,
        evidence: evidence.filter(
          (item): item is EvidenceDraft => item !== null,
        ),
      });
    }
  }
  return result;
}
