/**
 * Writing an episode's script from a topic with the local language model.
 *
 * The draft comes back as text in the editor's own format (a "# title" line
 * and a paragraph per scene); the interface decides where it goes, so
 * nothing the user wrote is replaced without them choosing it. One draft is
 * written at a time and can be stopped.
 */
import { countWords } from "@framebop/core";
import { AppError } from "@framebop/core";
import type { EngineContext } from "../context";
import type { LocalLlmService } from "./llm";
import { getSettings } from "./settings";

/** The catalog model the one-click setup installs for writing. */
export const SCRIPT_MODEL = "qwen3-4b-q4km";

/** Turns the model's answer into the editor's script format. */
export function cleanScript(text: string): string {
  const lines = text
    // Qwen3 opens with its (here empty) reasoning.
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/\*\*|__/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const out: string[] = [];
  for (const line of lines) {
    const heading =
      /^#{1,6}\s*(.+)$/.exec(line) ??
      /^((?:Scene|Sahne|Escena|Cena|Szene)\s*\d+\s*[:.\-–].*)$/i.exec(line);
    if (heading) {
      // "Scene 2: The market" becomes "# The market".
      const title = heading[1]!
        .replace(/^(?:Scene|Sahne|Escena|Cena|Szene)\s*\d+\s*[:.\-–]\s*/i, "")
        .replace(/:$/, "")
        .trim();
      if (out.length > 0 && out.at(-1) !== "") out.push("");
      // Small models sometimes run a title's words together.
      const spaced = title.includes(" ")
        ? title
        : title.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2");
      // A heading is a paragraph of its own: it names the one that follows.
      out.push(`# ${spaced || heading[1]!.trim()}`, "");
    } else if (line === "") {
      if (out.length > 0 && out.at(-1) !== "") out.push("");
    } else {
      // "örnektir.Bugün" → "örnektir. Bugün"
      out.push(line.replace(/(\p{Ll}[.!?])(\p{Lu})/gu, "$1 $2"));
    }
  }
  // Drop a lead-in such as "Here is your script:" before the first heading.
  const first = out.findIndex((line) => line.startsWith("# "));
  const body = first > 0 && first <= 2 ? out.slice(first) : out;
  return body.join("\n").trim();
}

export class ScriptWriterService {
  private running: AbortController | null = null;

  constructor(
    private readonly ctx: EngineContext,
    private readonly llm: LocalLlmService,
  ) {}

  async write(input: {
    episodeId: string;
    topic: string;
    modelId?: string | undefined;
  }): Promise<{ script: string; words: number }> {
    const episode = this.ctx.db.episodes.get(input.episodeId);
    const project = episode
      ? this.ctx.db.projects.get(episode.projectId)
      : null;
    if (!episode || !project) {
      throw new AppError("NOT_FOUND", "That episode does not exist.");
    }
    if (this.running) {
      throw new AppError("CONFLICT", "A script is already being written.");
    }
    const language =
      new Intl.DisplayNames(["en"], { type: "language" }).of(
        project.language,
      ) ?? project.language;
    const wordsPerMinute = getSettings(this.ctx).narrationWordsPerMinute;
    // A small local model writes best in short drafts.
    const words = Math.min(
      700,
      Math.max(
        80,
        Math.round((project.targetDurationSeconds * wordsPerMinute) / 60),
      ),
    );
    const scenes = Math.min(10, Math.max(3, Math.round(words / 45)));
    const controller = new AbortController();
    this.running = controller;
    try {
      const result = await this.llm.withModel(
        input.modelId ?? SCRIPT_MODEL,
        controller.signal,
        (provider) =>
          provider.generate({
            messages: [
              {
                role: "system",
                content:
                  "You write narration scripts for short videos. You write only the words the narrator says, clearly and vividly, for a general audience.",
              },
              {
                role: "user",
                content: [
                  `Write the narration script for a video about: ${input.topic}`,
                  `Language: ${language}. Write every word in ${language}.`,
                  `Length: about ${words} words in ${scenes} scenes.`,
                  "Format: for each scene, one line starting with # and a short scene title, then one paragraph of narration (two to four sentences).",
                  "Write nothing else: no introduction, no notes, no stage directions.",
                  // Qwen3's switch for answering without reasoning first.
                  "/no_think",
                ].join("\n"),
              },
            ],
            maxTokens: Math.ceil(words * 3) + 200,
            temperature: 0.7,
            signal: controller.signal,
          }),
      );
      if (controller.signal.aborted || result.finishReason === "cancelled") {
        throw new AppError("CANCELLED", "Writing the script was stopped.");
      }
      const script = cleanScript(result.text);
      if (countWords(script) < 10) {
        throw new AppError(
          "ENGINE_FAILURE",
          "The language model did not write a usable script. Try again or change the topic.",
        );
      }
      this.ctx.log.scope("script").info("Wrote a script draft", {
        episodeId: episode.id,
        words: countWords(script),
      });
      return { script, words: countWords(script) };
    } finally {
      this.running = null;
    }
  }

  cancel(): void {
    this.running?.abort();
  }
}
