/**
 * The Python program that runs Kokoro. It is kept here as text and written
 * into the job's working folder for each run, so the application has no
 * separate script file to locate or ship.
 *
 * It reads one JSON request from stdin, loads the model only from the files
 * it is given (never from the network: HF_HUB_OFFLINE is also set), speaks
 * the sentences one by one, reports each as it completes, and writes a
 * 16-bit mono WAV file.
 */
export const KOKORO_SCRIPT = String.raw`
import json
import os
import sys
import wave


def emit(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    request = json.loads(sys.stdin.readline())
    import numpy as np
    import torch
    from kokoro import KModel, KPipeline

    repo = "hexgrad/Kokoro-82M"
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    model = KModel(repo_id=repo, config=request["config"], model=request["weights"]).to("cpu").eval()
    pipeline = KPipeline(lang_code=request["lang"], repo_id=repo, model=model)

    rate = 24000
    gap = np.zeros(int(rate * request["gapSeconds"]), dtype=np.float32)
    sentences = request["sentences"]
    parts = []
    for index, sentence in enumerate(sentences):
        for result in pipeline(sentence, voice=request["voice"], speed=request["speed"], split_pattern=None):
            if result.audio is not None:
                parts.append(result.audio.detach().cpu().numpy().astype(np.float32))
        if index < len(sentences) - 1:
            parts.append(gap)
        emit({"type": "progress", "done": index + 1, "total": len(sentences)})

    audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    if audio.size == 0:
        emit({"type": "error", "message": "Kokoro produced no audio for this text."})
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
