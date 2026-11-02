import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const MAX_TOOL_OUTPUT = 2 * 1024 * 1024;

function packagedBinary(kind) {
    const packageName = process.platform === "win32"
        ? `@${kind}-installer/win32-x64`
        : process.platform === "linux" && process.arch === "x64"
          ? `@${kind}-installer/linux-x64`
          : "";
    if (!packageName) return "";
    try {
        const root = dirname(require.resolve(`${packageName}/package.json`));
        return join(root, process.platform === "win32" ? `${kind}.exe` : kind);
    } catch {
        return "";
    }
}

function mediaToolPath(kind, explicitPath) {
    const envName = kind === "ffprobe" ? "INFINITE_CANVAS_FFPROBE_PATH" : "INFINITE_CANVAS_FFMPEG_PATH";
    const candidate = String(explicitPath || process.env[envName] || packagedBinary(kind));
    if (candidate && existsSync(candidate)) return candidate;
    throw Object.assign(new Error(`本机缺少 ${kind} 媒体工具`), { status: 503, code: `${kind}_missing` });
}

function runTool(executable, args, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const stdout = [];
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let timer;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(value);
        };
        const collect = (target, chunk, currentBytes) => {
            if (currentBytes + chunk.length > MAX_TOOL_OUTPUT) {
                try { child.kill(); } catch {}
                finish(Object.assign(new Error("媒体工具输出过大"), { code: "media_tool_output_too_large" }));
                return currentBytes;
            }
            target.push(chunk);
            return currentBytes + chunk.length;
        };
        child.stdout.on("data", (chunk) => { stdoutBytes = collect(stdout, chunk, stdoutBytes); });
        child.stderr.on("data", (chunk) => { stderrBytes = collect(stderr, chunk, stderrBytes); });
        child.once("error", () => finish(Object.assign(new Error("媒体工具无法启动"), { code: "media_tool_start_failed" })));
        child.once("exit", (code) => {
            if (code === 0) return finish(null, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
            return finish(Object.assign(new Error("媒体工具处理失败"), { code: "media_tool_failed", exitCode: code }));
        });
        timer = setTimeout(() => {
            try { child.kill(); } catch {}
            finish(Object.assign(new Error("媒体工具处理超时"), { code: "media_tool_timeout" }));
        }, timeoutMs);
        timer.unref?.();
    });
}

function rate(value) {
    const [numerator, denominator = "1"] = String(value || "0").split("/");
    const result = Number(numerator) / Number(denominator);
    return Number.isFinite(result) ? result : 0;
}

export async function probeVideoFile(filePath, options = {}) {
    const executable = mediaToolPath("ffprobe", options.ffprobePath);
    const result = await runTool(executable, ["-v", "error", "-count_frames", "-show_entries", "format=format_name,duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,nb_frames,nb_read_frames,sample_rate,channels", "-of", "json", filePath], options.timeoutMs || 30_000);
    let payload;
    try { payload = JSON.parse(result.stdout); }
    catch { throw Object.assign(new Error("ffprobe 未返回有效媒体信息"), { status: 422, code: "ffprobe_invalid_output" }); }
    const stream = Array.isArray(payload?.streams) ? payload.streams.find((item) => item?.codec_type === "video") : null;
    const audioStream = Array.isArray(payload?.streams) ? payload.streams.find((item) => item?.codec_type === "audio") : null;
    const durationSeconds = Number(payload?.format?.duration);
    const fps = rate(stream?.avg_frame_rate) || rate(stream?.r_frame_rate);
    if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw Object.assign(new Error("视频媒体信息不完整"), { status: 422, code: "video_probe_incomplete" });
    return {
        formatNames: String(payload?.format?.format_name || "").split(",").filter(Boolean),
        codec: String(stream.codec_name || "").toLowerCase(),
        pixelFormat: String(stream.pix_fmt || "").toLowerCase(),
        width: Number(stream.width || 0),
        height: Number(stream.height || 0),
        fps,
        frameCount: Number(stream.nb_read_frames || stream.nb_frames || 0),
        durationSeconds,
        bytes: Number(payload?.format?.size || 0),
        ...(audioStream ? { audio: { codec: String(audioStream.codec_name || "").toLowerCase(), sampleRate: Number(audioStream.sample_rate || 0), channels: Number(audioStream.channels || 0) } } : {}),
    };
}

export async function probeAudioFile(filePath, options = {}) {
    const executable = mediaToolPath("ffprobe", options.ffprobePath);
    const result = await runTool(executable, ["-v", "error", "-show_entries", "format=format_name,duration,size:stream=codec_type,codec_name", "-of", "json", filePath], options.timeoutMs || 30_000);
    let payload;
    try { payload = JSON.parse(result.stdout); }
    catch { throw Object.assign(new Error("ffprobe 未返回有效媒体信息"), { status: 422, code: "ffprobe_invalid_output" }); }
    const stream = Array.isArray(payload?.streams) ? payload.streams.find((item) => item?.codec_type === "audio") : null;
    const durationSeconds = Number(payload?.format?.duration);
    if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw Object.assign(new Error("音频媒体信息不完整"), { status: 422, code: "audio_probe_incomplete" });
    return {
        formatNames: String(payload?.format?.format_name || "").split(",").filter(Boolean),
        codec: String(stream.codec_name || "").toLowerCase(),
        durationSeconds,
        bytes: Number(payload?.format?.size || 0),
    };
}

export async function transcodeVideoPreview(sourcePath, targetPath, options = {}) {
    const executable = mediaToolPath("ffmpeg", options.ffmpegPath);
    await runTool(executable, ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", targetPath], options.timeoutMs || 10 * 60_000);
    return { changed: true };
}
