/** Process-local hooks for the pinned 0.18.0 conv VAE sink. */
export const LTX_VIDEO_ENCODING = String.raw`
def configure_video_encoding(output_frames):
    from ltx_core_mlx.model.video_vae import video_vae as sink
    build_command = sink.build_ffmpeg_command
    write_chunks = sink.stream_chunks_to_ffmpeg
    state = {"frames": 0, "commands": 0}

    def command(*args, **kwargs):
        cmd = build_command(*args, **kwargs)
        # Encode the decoded RGB frames once, at the adapter's delivery quality.
        cmd[cmd.index("-crf") + 1] = "16"
        state["commands"] += 1
        return cmd[:-1] + ["-movflags", "+faststart", cmd[-1]]

    def bounded_chunks(chunks):
        try:
            for chunk in chunks:
                remaining = output_frames - state["frames"]
                if remaining <= 0:
                    break
                count = min(remaining, chunk.shape[2])
                state["frames"] += count
                yield chunk[:, :, :count, :, :]
                if state["frames"] == output_frames:
                    break
        finally:
            close = getattr(chunks, "close", None)
            if close is not None:
                close()

    def write(chunks, process):
        return write_chunks(bounded_chunks(chunks), process)

    sink.build_ffmpeg_command = command
    sink.stream_chunks_to_ffmpeg = write
    return state
`;
