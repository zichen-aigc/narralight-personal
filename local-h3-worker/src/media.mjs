import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { FIXED_SPEC } from "./constants.mjs";
import { WorkerError } from "./errors.mjs";

export async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export function validateProbe(probe, spec = FIXED_SPEC) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const formatName = String(probe?.format?.format_name || "").split(",");
  if (!formatName.includes("mp4")) throw new WorkerError("media_container_invalid", "Rendered media is not an MP4 container");
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video) throw new WorkerError("media_video_missing", "Rendered MP4 has no video stream");
  if (!audio) throw new WorkerError("media_audio_missing", "Rendered MP4 has no audio stream");
  if (video.codec_name !== spec.videoCodec) throw new WorkerError("media_video_codec_invalid", `Expected ${spec.videoCodec} video, got ${video.codec_name || "unknown"}`);
  if (Number(video.width) !== spec.width || Number(video.height) !== spec.height) {
    throw new WorkerError("media_dimensions_invalid", `Expected ${spec.width}x${spec.height}, got ${video.width}x${video.height}`);
  }
  const parseRate = (value) => {
    const [numerator, denominator] = String(value || "0/1").split("/").map(Number);
    return denominator ? numerator / denominator : 0;
  };
  const averageRate = parseRate(video.avg_frame_rate);
  const frameRate = averageRate || parseRate(video.r_frame_rate);
  if (Math.abs(frameRate - spec.fps) > 0.05) throw new WorkerError("media_fps_invalid", `Expected ${spec.fps}fps, got ${frameRate}`);
  const frameCount = Number(video.nb_read_frames || video.nb_frames || 0);
  if (!Number.isSafeInteger(frameCount) || Math.abs(frameCount - spec.frames) > 1) {
    throw new WorkerError("media_frame_count_invalid", `Expected ${spec.frames} frames, got ${frameCount || "unknown"}`);
  }
  if (audio.codec_name !== spec.audioCodec) throw new WorkerError("media_audio_codec_invalid", `Expected ${spec.audioCodec} audio, got ${audio.codec_name || "unknown"}`);
  if (Number(audio.sample_rate) !== spec.audioSampleRate) throw new WorkerError("media_audio_rate_invalid", `Expected ${spec.audioSampleRate}Hz audio, got ${audio.sample_rate}`);
  if (Number(audio.channels) !== spec.audioChannels) throw new WorkerError("media_audio_channels_invalid", `Expected ${spec.audioChannels} audio channels, got ${audio.channels}`);
  const duration = Number(probe?.format?.duration || video.duration || audio.duration || 0);
  if (!Number.isFinite(duration) || Math.abs(duration - spec.durationSeconds) > 0.15) {
    throw new WorkerError("media_duration_invalid", `Expected about ${spec.durationSeconds.toFixed(2)}s, got ${duration || "unknown"}`);
  }
  return {
    container: probe?.format?.format_name || "",
    durationSeconds: duration,
    video: { codec: video.codec_name, width: Number(video.width), height: Number(video.height), fps: frameRate, frames: frameCount || null },
    audio: { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: Number(audio.channels) },
  };
}

export async function probeMedia(filename, ffprobePath, spec = FIXED_SPEC) {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", filename], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new WorkerError("ffprobe_unavailable", "ffprobe could not be started", { cause: error })));
    child.on("close", (code) => code === 0
      ? resolve(output)
      : reject(new WorkerError("ffprobe_failed", `ffprobe failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`)));
  });
  let probe;
  try { probe = JSON.parse(stdout); } catch (error) {
    throw new WorkerError("ffprobe_json_invalid", "ffprobe returned invalid JSON", { cause: error });
  }
  return validateProbe(probe, spec);
}

export async function inspectMedia(filename, ffprobePath, spec = FIXED_SPEC) {
  const file = await stat(filename);
  if (!file.isFile() || file.size <= 0) throw new WorkerError("media_file_empty", "Rendered MP4 is empty");
  const [sha256, metadata] = await Promise.all([sha256File(filename), probeMedia(filename, ffprobePath, spec)]);
  return { bytes: file.size, sha256, mimeType: "video/mp4", metadata };
}

export async function readChunk(filename, offset, length) {
  const handle = await open(filename, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
