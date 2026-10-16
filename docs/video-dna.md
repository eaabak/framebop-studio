# Video DNA Lab

Video DNA Lab is where creators study reference videos: what is publicly
known about them, what viewers say in the comments, and how transcripts they
are allowed to use are structured. It is a research tool. It does not copy
videos, download them, promise views, or claim to see anyone's private
analytics.

This is the foundation (Phase 5A.1). It collects data and reports on it with
transparent rules. Analysis by a language model (hooks, storytelling, pacing,
original concepts) is planned for Phase 5A.2 and is shown in the interface as
not available.

## What a research project holds

| Entity               | What it is                                                                                     | Source                        |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Research project     | A name and what the user wants to learn                                                        | The user                      |
| Reference video      | A YouTube video id and its canonical link                                                      | Parsed from a pasted link     |
| Metadata snapshot    | Title, duration, public counts, channel details, with why any value is missing                 | YouTube Data API, or the user |
| Comment sample       | Up to 100 top-level public comments per request, in YouTube's order, without authors           | YouTube Data API              |
| Transcript, segments | A transcript file the user may use, with the user's statement of why                           | A file or pasted text         |
| Finding              | A statement about the data: observed or inferred, how it was produced and what limits it       | Framebop rules, or the user   |
| Evidence reference   | What a finding rests on: a snapshot field, comment or transcript line, with a quote and a date | The stored data               |

Everything is stored in the library's SQLite database (schema 6) and survives
restarts. Every snapshot, sample and transcript records when it was taken.
A snapshot is never overwritten: fetching again adds a new one, so changes
over time stay visible.

## Sources

### YouTube Data API v3

Requests are made only when the user asks, only to
`https://www.googleapis.com/youtube/v3`, and only with the user's own API key.

| Action                     | Request                                                                                    | Quota |
| -------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| Fetch details              | `videos.list` (snippet, contentDetails, statistics, status, topicDetails), `channels.list` | 2     |
| Fetch or load 100 comments | `commentThreads.list` (snippet, plain text, relevance or newest first)                     | 1     |

A pasted link is parsed for its 11-character video id and never requested,
so text pasted into Video DNA Lab cannot point Framebop at any other server.
Links to channels and playlists are refused with a reason.

The key is sent in the `x-goog-api-key` header, never in a URL, so it cannot
end up in a log line or an error message. Redirects are refused, responses
over 8 MB are refused, and requests time out after 20 seconds.

Failures are explained, not hidden:

| Failure                | What the user sees                                                             |
| ---------------------- | ------------------------------------------------------------------------------ |
| No key                 | Add a key in Settings, or enter the details by hand                            |
| Key refused or expired | YouTube did not accept the key                                                 |
| Key restricted         | Keys limited to websites, apps or IP addresses are refused from a desktop app  |
| API not enabled        | Enable YouTube Data API v3 in the key's Google Cloud project                   |
| Quota used up          | It resets at midnight Pacific Time; saved research stays; manual entry offered |
| Rate limited           | Wait a minute                                                                  |
| Offline or no answer   | Saved research stays; manual entry offered                                     |
| Video not found        | It may be private, unlisted or removed                                         |
| Comments turned off    | Recorded as a fact about the video, not as a failure                           |

What the API does not offer, and Framebop therefore never shows or estimates:
audience retention, viewer demographics, revenue, impressions, click-through
rate, traffic sources and dislike counts (all visible only to a channel's
owner), and caption text (downloadable only by the video's owner).

### Values the API leaves out

The API omits a value rather than saying why. Framebop records the most
likely reason only where the API makes it clear: a missing like count beside
other statistics is "hidden" ("the owner may have hidden it"), a missing
comment count suggests comments are off, `hiddenSubscriberCount` means the
channel hides it, and a live or scheduled video has no final duration.
Public subscriber counts are noted as rounded to three significant figures,
as YouTube does.

### Entered by hand

Without a key, or offline, the user can type the details they see on the
video's page. They are saved as "Entered by you" with the date, and only
earlier manual entries are offered for editing, so values from the API never
become the user's.

### Transcripts

Transcripts are imported from a file the user picks (`.vtt`, `.srt`, `.txt`,
at most 5 MB) or from pasted text. Framebop does not extract or download
captions. Every import requires the user's statement of why they may use it
(their own content, a licence, permission, or an open licence) and an
explicit confirmation, which are stored with the transcript.

Supported formats: WebVTT (with identifiers, notes, styling tags and the
repeated lines of rolling captions removed), SubRip, and plain text, where
times written at the start of a line or on a line of their own (as copied
from a transcript panel) are read as start times. Invalid files are refused
with the line that is wrong. A transcript that runs past the end of the video
is imported with a warning. Its language is recorded as declared; nothing is
detected.

## Findings

Rule-based findings are recalculated from the stored data whenever it
changes, so they always match it. Each says how it was produced, what limits
it, and cites its evidence. None uses AI.

| Finding              | Rule                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Video facts          | Copied from the latest snapshot: duration, publication date, public counts                                               |
| Language information | The uploader's language fields, whether captions exist, and each transcript's declared language                          |
| Transcript length    | Words, segments, and how much of the video's duration the transcript spans                                               |
| Timing               | Words per minute overall, in the first 30 seconds and per quarter; gaps of 2 seconds or more                             |
| Comment topics       | Comments grouped by the most common words they share, after removing common words in six languages and generic reactions |
| Questions            | Comments containing a question mark                                                                                      |
| Moments              | Times written in comments (such as 4:12), counted per 30-second window, with the transcript's text for the top window    |

Comment findings state their sample: how many comments of how many public,
in which order (YouTube's relevance order is a ranking, not a random sample),
and that replies are not included. Word counts are runs of letters and
digits, which is not meaningful for languages written without spaces.

Users add their own notes, marked observed or inferred, with comments and
transcript lines they bookmark as evidence. Evidence keeps its quote; if the
source is deleted later, the note says so instead of breaking.

## Privacy, policies and storage

- Comment authors' names and channels are never stored.
- Framebop never downloads video, audio, captions or thumbnails. A thumbnail's
  address is recorded but not loaded.
- YouTube's API policies require stored API data to be refreshed or deleted
  after 30 days. Video DNA Lab marks older snapshots and comment samples, and
  offers to refresh or delete them. It does not delete research on its own.
- The API key is kept in the operating system's secure storage: the macOS
  Keychain (through `/usr/bin/security`, with the key passed on standard
  input, never as an argument), or the Secret Service on Linux (through
  `secret-tool`, if installed). Windows has no implementation yet, so there
  the key is kept in memory until Framebop closes. The key is never written
  to the library, the settings or the log, and never sent back to the
  interface. On macOS, the Keychain item is created by `/usr/bin/security`,
  so other programs running as the same user can read it through that tool
  without a prompt; it is still encrypted at rest and never in plain text on
  disk.

## Setting up a key

1. In the Google Cloud console, create or choose a project and enable
   "YouTube Data API v3".
2. Create an API key. Restrict it to the YouTube Data API v3. Do not add
   website or IP address restrictions: they block requests from a desktop app.
3. Paste it into **Settings → YouTube Data API key**.

The default quota is 10,000 units a day.

## For developers

| Variable                    | Effect                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `FRAMEBOP_YOUTUBE_API_KEY`  | Uses this key instead of a saved one, and never stores it. For local testing with a real key.     |
| `FRAMEBOP_YOUTUBE_ENDPOINT` | Sends API requests elsewhere. Only `https`, or `http` on the loopback interface. For a stand-in.  |
| `FRAMEBOP_SECRET_NAMESPACE` | The secret store's service name (default `framebop-studio`), so tests never touch the real entry. |

`packages/research/src/testing.ts` contains a deterministic stand-in for the
API: a complete video with 250 comments over three pages, a video with hidden
counts and comments turned off, a live stream, an unknown id, and the real
error bodies for an invalid key, an exhausted quota and a disabled API.

## AI analysis (Phase 5A.2)

The **AI analysis** tab runs six analyses with a local language model:
hook, narrative structure, pacing, audience signals, original concepts and
language strategy. They run as one job in the production lane, so they never
share memory with a generation job: Queued → Loading model → Analyzing (one
section at a time, saved as it finishes) → Validating → Completed, Failed or
Cancelled. The model is unloaded afterwards, whatever happens.

**Runtime.** llama.cpp's own `llama-server`, chosen in Settings and started
by Framebop for each piece of work: bound to 127.0.0.1 on a free port, with a
key generated per start and passed in a 0600 file that is deleted once the
server is up, its web interface and slot endpoint off, `--offline`, and every
`LLAMA_ARG_*` variable removed from its environment. The chat template is a
llama.cpp built-in named in the verified registry (`--no-jinja`), never the
template inside the model file. Its version is read with `--version`; a
crash, a failed load or a timeout is reported with the server's last lines.

**Models.** Only registry entries that state how to run them (`llm`:
built-in chat template and context length) are offered, installed by the
Model Manager or found in a folder the user added (read only). Each GGUF file
is read for its architecture, layers and trained context, and its memory is
estimated from that metadata (weights plus the 16-bit key and value cache). A
language model may use at most half of the computer's memory. Whether a model
works is known only from a real run ("Test the model" or a completed
analysis), recorded per model and runtime build.

**Grounding.** Each analysis gets a bounded selection of the collected data
in which every item has a handle (`s12`, `c3`, `m.title`), and must answer in
JSON matching a schema (constrained decoding in llama.cpp, then Zod). Items
are rejected, and listed as rejected with the reason, when they cite a handle
that was not in the material; state a number or quote words their evidence
does not contain; count comments themselves; claim retention (hook), visuals
(pacing), demographics (audience) or market figures (language); or, for
concepts, reuse the reference's title or repeat eight or more words of its
title, description or transcript. Quotes and timestamps shown as evidence are
always taken from storage. The material is marked as untrusted, and brackets
in it are neutralised so a comment cannot forge a handle. Framebop adds its
own measurements where it can (pacing figures, writing systems in comments),
marked "Measured by Framebop".

An analysis records a fingerprint of the data it read and is marked stale
when that data changes. `conceptHandoff` (core) turns a concept into the
shape Phase 5A.3 will use to start a production project.

Verified on an M4 Pro (24 GB) with llama.cpp build 11641 and Qwen2.5 1.5B
Instruct Q4_K_M: a test answer in 4.5 s including loading, all six analyses
in about 21 s, peak server memory 1.7 GB, cancellation in under a second
with the server stopped. With a model this small, concepts tend to restate
the reference's ideas rather than offer new ones; they pass the checks only
because they do not copy its words. Larger models should do better and are a
registry addition, not a code change.

## Story Architect (Phase 5A.3)

"Develop story" on a concept opens a story draft: the concept (copied, with
its evidence), project settings (title, target duration up to two hours,
language, audience, tone, visual direction, narration style, scene count,
speaking rate), an editable outline and editable scenes. Draft scenes use the
production scene's own fields, plus facts to check, research used, missing
assets and an approval flag.

Generation runs as a job in the production lane, loading the model once per
job: outline, then each section's scenes in a separate request, saved after
every section, cancellable, unloaded afterwards. Single sections and single
scenes can be written again; approved scenes and all other sections are never
replaced, and while a job runs the draft cannot be edited. Edits are saved as
numbered revisions (the last 30 are kept) and must name the revision they were
made on. Generation interrupted by a restart is marked as such; finished
sections stay.

The review, recalculated on every read, flags: outline or scene wording that
repeats eight or more words of the reference (title, description or
transcript); scenes that cover the reference's topics in its order; facts to
check in independent sources (the model's own list, or dates, figures and
"studies show" phrasing), noting that research from the reference is not
verification; the estimated length against the target (an estimate at the
chosen speaking rate; the narration audio gives the real length); missing
outline, sections without scenes and scenes without narration (these block
creation); and problems with the model's output.

"Create production project" needs a saved, reviewed draft without blocking
problems. It writes the project, one episode in draft state with the script,
and the scenes in order in one transaction; nothing is generated or rendered.
Asking again returns the same project. The draft keeps the mapping from its
scenes to the production scenes, and each production scene's description
names the facts to check and the research used. The editor then opens on the
new project.

Verified with Qwen2.5 1.5B: a 2-minute draft's outline in 5.5 s and three
scenes in 6.8 s (including loading). The small model wrote about 42 seconds of
narration for a 2-minute target and repeated the reference's wording in its
outline and one scene; the review flagged all of it, and the project was
created only after review.

## Duration-aware writing and the Production Blueprint (Phase 5B.1)

**Budgets.** A draft's target length and speaking rate give a word budget,
split across sections by their planned length and across each section's
scenes. A section is written in bounded steps: one request plans its scene
beats, then each scene's narration is written on its own with its word
budget and a structured summary of what came before (earlier sections and
their scenes, facts already introduced, the last line, the narrator's point
of view). Every scene is saved as soon as it is written.

**Review.** Sections under 70% or over 140% of their budget are flagged;
narration under half of the whole budget blocks creating a project (a short
script is never stretched to fit). Repeated sentences and facts introduced in
more than one section are flagged, and so is a model not known to suit long
scripts (`llm.longForm` in the registry, false for the verified 1.5B model).

**Lengthening.** "Lengthen" on a section rewrites only its short, unapproved,
unedited AI scenes toward their budget. A longer version is kept only if it is
meaningfully longer, keeps what the scene said, and repeats neither itself nor
other scenes; otherwise the scene stays and the reason is shown.

**Blueprint.** The production editor's Blueprint tab gives every scene a plan
(`scene_plans`, schema 9): production method, engine and model, required
assets, facts to check and research carried over from the story draft, and
where its duration came from (estimate, set by hand, or narration audio).
Methods are offered only as far as an engine reports it can perform them;
layered 2D animation is not available in this build. The preflight separates
technical problems (missing files, unsupported methods or engines,
incompatible models, unsupported output settings, narration longer than its
scene), media still to make, and editorial review (facts to check, reference
research, missing narration or visual descriptions, duration mismatches).
Narration previews use the existing Kokoro job; "Use measured length" sets a
scene to its audio's measured duration, never over a duration set by hand.
"Suggest longer narration" asks the local model for a longer version kept as
a suggestion until the user uses or discards it. `mediaProductionRequest`
(core) is the shape Phase 5B.2 will hand to media engines.

Verified with Qwen2.5 1.5B on an M4 Pro: an 8-minute draft (5 sections, 10
scenes) in 8.1 s for the outline and 35.4 s for the script, with 1,268 words
for a 1,200-word budget (sections from 53% to 165% of their budgets), many
repeated sentences and facts flagged, and one lengthening step that added 42
words to the short section and reported one unusable answer. A real Kokoro
preview of one scene measured 34.1 s against a 33.6 s estimate. The 8-minute
script was not reviewed for quality and is not production-ready as written.

## Not done

- AI analysis quality beyond the small verified model.
- Live checks against the real YouTube Data API with a valid key. The client
  was checked against the real API's responses to an invalid key and to no
  key, and against the stand-in for everything else.
- Comment replies, channel-level research and searching YouTube.
- Secure key storage on Windows; Linux storage is written but untested.
- Opening YouTube links from the desktop app (rather than the browser
  build) was not exercised.
