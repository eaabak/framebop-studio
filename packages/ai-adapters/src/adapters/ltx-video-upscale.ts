import { LTX_VIDEO_MEMORY } from "./ltx-video-memory";

/** Offline, frame-streamed bridge to the separately installed Real-ESRGAN MLX runtime. */
export const LTX_VIDEO_UPSCALE = String.raw`
import json, os, pathlib, resource, socket, subprocess, sys, threading, time
from importlib.metadata import version

def emit(event):
    print(json.dumps(event), flush=True)

def deny(*args, **kwargs):
    raise RuntimeError("Video enhancement is offline; choose local weights first.")

socket.socket.connect = deny
socket.socket.connect_ex = deny
socket.create_connection = deny

${LTX_VIDEO_MEMORY}

def main():
    request = json.loads(sys.stdin.readline())
    started = time.monotonic()
    threading.Thread(target=memory_guard, daemon=True).start()
    if version("realesrgan-mlx") != "0.1.0":
        raise RuntimeError("Enhancement needs realesrgan-mlx 0.1.0; see docs/ltx-video.md.")
    import mlx.core as mx
    import numpy as np
    from PIL import Image, ImageOps
    from realesrgan_mlx.pipeline_mlx import make_upsampler
    up = make_upsampler("realesr-animevideov3", tile=256, tile_pad=16, weights_dir=request["weights"])
    width, height = request["width"], request["height"]
    decoder = encoder = None
    # Stderr goes to job-local files rather than blocking unread pipes.
    root = pathlib.Path(request["output"]).parent
    with (root / "upscale-decode.log").open("w") as decode_log, (root / "upscale-encode.log").open("w") as encode_log:
        try:
            decoder = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-i", request["input"], "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=decode_log)
            encoder = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-n", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%sx%s" % (request["targetWidth"], request["targetHeight"]), "-r", "24", "-i", "-", "-an", "-c:v", "libx264", "-threads", "4", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", request["output"]], stdin=subprocess.PIPE, stderr=encode_log)
            for index in range(request["frames"]):
                data = decoder.stdout.read(width * height * 3)
                if len(data) != width * height * 3:
                    raise RuntimeError("Enhancement received a truncated source frame.")
                frame = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
                enhanced, _ = up.enhance(frame)
                final = ImageOps.fit(Image.fromarray(enhanced), (request["targetWidth"], request["targetHeight"]), method=Image.Resampling.LANCZOS)
                encoder.stdin.write(final.tobytes())
                del frame, enhanced, final
                mx.clear_cache()
                emit({"type": "progress", "stage": "composing", "done": index + 1, "total": request["frames"], "message": "Enhancing frame %s of %s" % (index + 1, request["frames"])})
            if decoder.stdout.read(1):
                raise RuntimeError("Enhancement received more frames than expected.")
            encoder.stdin.close()
            encoder.wait(timeout=60)
            decoder.wait(timeout=15)
            if encoder.returncode or decoder.returncode:
                raise RuntimeError("FFmpeg failed during enhancement; no scene media was replaced.")
            emit({"type": "done", "seconds": time.monotonic() - started, "peakMetalBytes": mx.get_peak_memory(), "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
        finally:
            for process in (decoder, encoder):
                if process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()

try:
    main()
except Exception as error:
    emit({"type": "error", "message": str(error)})
    sys.exit(1)
`;
