/**
 * The Python program that runs Qwen3-TTS through mlx-audio. Like Kokoro's,
 * it is kept here as text and written into the job's working folder for
 * each run.
 *
 * It reads one JSON request from stdin, loads the model only from the
 * folder it is given (HF_HUB_OFFLINE is also set), seeds MLX's random
 * generator so a take can be reproduced, speaks the narration one sentence
 * at a time with silence between sentences and longer silence between
 * paragraphs, reports each sentence as it completes, and writes a 16-bit
 * mono WAV file at the model's own sample rate. Tempo, loudness and the
 * final sample rate are applied afterwards with FFmpeg.
 *
 * mlx-audio's generate() routes by the model's tts_model_type: a Base model
 * clones the reference recording, a VoiceDesign model follows the
 * description in `instruct`, a CustomVoice model uses a preset speaker.
 */
export const QWEN3_TTS_SCRIPT = String.raw`
import json
import sys
import wave


def emit(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    request = json.loads(sys.stdin.readline())
    import numpy as np
    import mlx.core as mx
    from mlx_audio.tts.utils import load_model

    model = load_model(request["model"])
    rate = int(model.sample_rate)
    mx.random.seed(int(request["seed"]))

    options = {"lang_code": request["language"]}
    if request.get("refAudio"):
        options["ref_audio"] = request["refAudio"]
        options["ref_text"] = request["refText"]
    if request.get("speaker"):
        options["voice"] = request["speaker"]
    if request.get("instruct"):
        options["instruct"] = request["instruct"]

    def silence(seconds):
        return np.zeros(int(rate * seconds), dtype=np.float32)

    paragraphs = request["paragraphs"]
    total = sum(len(sentences) for sentences in paragraphs)
    parts = []
    done = 0
    for p, sentences in enumerate(paragraphs):
        if p:
            parts.append(silence(request["paragraphGapSeconds"]))
        for s, sentence in enumerate(sentences):
            if s:
                parts.append(silence(request["sentenceGapSeconds"]))
            for result in model.generate(text=sentence, **options):
                parts.append(np.array(result.audio, dtype=np.float32).reshape(-1))
            done += 1
            emit({"type": "progress", "done": done, "total": total})

    audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    if audio.size == 0 or not np.any(audio):
        emit({"type": "error", "message": "Qwen3-TTS produced no audio for this text."})
        return 1
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(request["output"], "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    emit({
        "type": "done",
        "samples": int(audio.size),
        "sampleRate": rate,
        "peak": float(np.abs(audio).max()),
    })
    return 0


try:
    sys.exit(main())
except Exception as error:
    emit({"type": "error", "message": "%s: %s" % (type(error).__name__, error)})
    sys.exit(1)
`;
