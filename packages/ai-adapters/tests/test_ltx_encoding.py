"""CPU-only contract tests: python3 packages/ai-adapters/tests/test_ltx_encoding.py."""
import pathlib
import sys
import types
import unittest


class Chunk:
    def __init__(self, frames):
        self.shape = (1, 3, frames, 4, 4)

    def __getitem__(self, slices):
        return Chunk(slices[2].stop)


class EncodingTest(unittest.TestCase):
    def setUp(self):
        self.commands = []
        self.written = []
        self.closed = False
        self.consumed = 0
        sink = types.ModuleType("video_vae")

        def build_command(*args, **kwargs):
            self.commands.append((args, kwargs))
            return ["ffmpeg", "-crf", "18", "clip.mp4"]

        def write_chunks(chunks, process):
            self.written.extend(chunk.shape[2] for chunk in chunks)

        sink.build_ffmpeg_command = build_command
        sink.stream_chunks_to_ffmpeg = write_chunks
        self.sink = sink
        parent = types.ModuleType("ltx_core_mlx.model.video_vae")
        parent.video_vae = sink
        self.previous = sys.modules.get(parent.__name__)
        sys.modules[parent.__name__] = parent
        source = (pathlib.Path(__file__).resolve().parents[1] / "src/adapters/ltx-video-encoding.ts").read_text()
        python = source.split("String.raw`", 1)[1].rsplit("`;", 1)[0]
        namespace = {}
        exec(compile(python, "ltx-video-encoding", "exec"), namespace)
        self.configure = namespace["configure_video_encoding"]

    def tearDown(self):
        name = "ltx_core_mlx.model.video_vae"
        if self.previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = self.previous

    def chunks(self, sizes):
        try:
            for size in sizes:
                self.consumed += 1
                yield Chunk(size)
        finally:
            self.closed = True

    def test_trim_crosses_chunk_boundary_without_consuming_the_rest(self):
        state = self.configure(24)
        command = self.sink.build_ffmpeg_command("input", output_path="clip.mp4")
        self.assertEqual(command, ["ffmpeg", "-crf", "16", "-movflags", "+faststart", "clip.mp4"])
        self.sink.stream_chunks_to_ffmpeg(self.chunks([16, 16, 16]), None)
        self.assertEqual(self.written, [16, 8])
        self.assertEqual(state, {"frames": 24, "commands": 1})
        self.assertEqual(self.consumed, 2)
        self.assertTrue(self.closed)

    def test_exact_chunk_boundary_closes_the_decoder(self):
        state = self.configure(32)
        self.sink.stream_chunks_to_ffmpeg(self.chunks([16, 16, 16]), None)
        self.assertEqual(self.written, [16, 16])
        self.assertEqual(state["frames"], 32)
        self.assertEqual(self.consumed, 2)
        self.assertTrue(self.closed)

    def test_short_decode_remains_detectable_by_the_bridge(self):
        state = self.configure(72)
        self.sink.stream_chunks_to_ffmpeg(self.chunks([16, 16]), None)
        self.assertNotEqual(state["frames"], 72)
        self.assertEqual(state["frames"], 32)
        self.assertTrue(self.closed)


if __name__ == "__main__":
    unittest.main()
