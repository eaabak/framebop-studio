/** Version-bound, offline bridge to ltx-pipelines-mlx 0.18.0. */
export const LTX_VIDEO_SCRIPT = String.raw`
import json, os, resource, socket, subprocess, sys, threading, time, traceback
from importlib.metadata import version

def emit(value):
    print(json.dumps(value), flush=True)

def deny_network(*args, **kwargs):
    raise RuntimeError("LTX generation is offline; install all model files first.")

socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network

def memory_guard():
    critical_since = None
    while True:
        time.sleep(5)
        try:
            result = subprocess.run(["/usr/sbin/sysctl", "-n", "kern.memorystatus_vm_pressure_level"], capture_output=True, text=True, timeout=3)
            if result.returncode != 0:
                continue
            if result.stdout.strip() == "4":
                critical_since = critical_since or time.monotonic()
                if time.monotonic() - critical_since >= 10:
                    emit({"type": "error", "message": "Stopped after sustained critical system memory pressure. Close other model jobs before retrying."})
                    os._exit(77)
            else:
                critical_since = None
        except (OSError, subprocess.TimeoutExpired):
            pass

def main():
    request = json.loads(sys.stdin.readline())
    for package, wanted in {"ltx-core-mlx": "0.18.0", "ltx-pipelines-mlx": "0.18.0", "mlx": "0.32.2", "mlx-lm": "0.31.1"}.items():
        if version(package) != wanted:
            raise RuntimeError(package + " must be " + wanted + " for this adapter.")
    threading.Thread(target=memory_guard, daemon=True).start()
    emit({"type": "phase", "stage": "loading_model", "message": "Loading LTX and text encoder"})
    import mlx.core as mx
    from ltx_pipelines_mlx import DistilledPipeline
    peaks = []
    reset_peak = mx.reset_peak_memory
    def record_peak():
        peaks.append(mx.get_peak_memory())
        return reset_peak()
    mx.reset_peak_memory = record_peak
    pipe = DistilledPipeline(model_dir=request["model"], gemma_model_id=request["textEncoder"], low_memory=True, low_ram_streaming=True)
    pipe.verbose = False
    pipe.generate_audio = False
    # This hook is version-bound, and reports completed, materialized sampler
    # predictions without retaining the VAE for intermediate previews.
    def step_hook(*args, stage=None, **kwargs):
        def step(index, count, prediction, sigma):
            mx.eval(prediction)
            offset = 0 if stage == 1 else 8
            emit({"type": "progress", "done": offset + index + 1, "total": 11, "message": "Stage %s: step %s of %s" % (stage, index + 1, count)})
        return step
    pipe._stepwise_hook = step_hook
    decode = pipe._decode_and_save_video
    def decode_with_progress(*args, **kwargs):
        emit({"type": "phase", "stage": "composing", "message": "Decoding video frames"})
        return decode(*args, **kwargs)
    pipe._decode_and_save_video = decode_with_progress
    options = {}
    if request.get("inputImage"):
        # One image anchors the first frame. It is not an identity embedding
        # or a guarantee that a character stays identical throughout a clip.
        from ltx_pipelines_mlx.utils.args import image_conditioning_input
        options["images"] = [image_conditioning_input(request["inputImage"], 0, request["referenceStrength"])]
    started = time.monotonic()
    pipe.generate_and_save(prompt=request["prompt"], output_path=request["output"], width=request["width"], height=request["height"], num_frames=request["frames"], frame_rate=24, seed=request["seed"], stage1_steps=8, stage2_steps=3, **options)
    mx.synchronize()
    emit({"type": "done", "seconds": time.monotonic() - started, "peakMetalBytes": max(peaks + [mx.get_peak_memory()]), "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})

try:
    main()
except Exception as error:
    traceback.print_exc(file=sys.stderr)
    emit({"type": "error", "message": str(error)})
    sys.exit(1)
`;
