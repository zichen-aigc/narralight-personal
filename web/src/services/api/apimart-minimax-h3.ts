import { type MiniMaxH3ReferenceMode } from "@/lib/minimax-h3-capabilities";
import { MINIMAX_H3_CAPABILITIES, MINIMAX_H3_MODEL_ID } from "@/lib/minimax-h3-capabilities";

export type MiniMaxH3RequestInput = {
    model: string;
    prompt: string;
    resolution: string;
    aspectRatio: string;
    duration: number;
    referenceMode: MiniMaxH3ReferenceMode;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    videoDurationsMs: Array<number | undefined>;
    audioDurationsMs: Array<number | undefined>;
};

export type MiniMaxH3RequestCounts = Omit<MiniMaxH3RequestInput, "imageUrls" | "videoUrls" | "audioUrls"> & {
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export function validateMiniMaxH3Request(input: MiniMaxH3RequestCounts) {
    const capabilities = MINIMAX_H3_CAPABILITIES;
    if (input.model !== MINIMAX_H3_MODEL_ID) throw h3Error("h3_model_invalid", "MiniMax H3 请求必须使用 MiniMax-H3 模型 ID");
    if (!capabilities.modes.includes(input.referenceMode)) throw h3Error("h3_mode_unsupported", "MiniMax H3 不支持当前生成模式");
    if (!capabilities.resolutions.includes(input.resolution as "2K" | "768P")) throw h3Error("h3_resolution_unsupported", "MiniMax H3 分辨率只能是 2K 或 768P");
    if (!Number.isInteger(input.duration) || input.duration < capabilities.duration.min || input.duration > capabilities.duration.max)
        throw h3Error("h3_duration_invalid", "MiniMax H3 时长必须是 4-15 秒整数");
    if (input.imageCount > capabilities.references.images) throw h3Error("h3_image_count_invalid", "MiniMax H3 参考图最多 9 张");
    if (input.videoCount > capabilities.references.videos) throw h3Error("h3_video_count_invalid", "MiniMax H3 参考视频最多 3 个");
    if (input.audioCount > capabilities.references.audios) throw h3Error("h3_audio_count_invalid", "MiniMax H3 参考音频最多 3 个");
    validateDurations("视频", input.videoCount, input.videoDurationsMs, capabilities.references.totalVideoDurationMs);
    validateDurations("音频", input.audioCount, input.audioDurationsMs, capabilities.references.totalAudioDurationMs);

    const frameMode = input.referenceMode === "first_frame" || input.referenceMode === "last_frame" || input.referenceMode === "first_last_frame";
    if (frameMode && input.aspectRatio !== "adaptive") throw h3Error("h3_frame_ratio_invalid", "MiniMax H3 首帧、尾帧和首尾帧模式必须使用 adaptive");
    if (!frameMode && !capabilities.ratios.includes(input.aspectRatio as never)) throw h3Error("h3_ratio_unsupported", "MiniMax H3 不支持当前宽高比");
    if (input.referenceMode === "text_to_video" && input.aspectRatio === "adaptive") throw h3Error("h3_text_ratio_required", "MiniMax H3 文生视频必须选择具体宽高比");
    if (input.audioCount && input.imageCount + input.videoCount === 0) throw h3Error("h3_audio_requires_visual", "MiniMax H3 参考音频必须搭配参考图或参考视频");

    const hasMultimodal = input.imageCount + input.videoCount + input.audioCount > 0;
    if (input.referenceMode === "text_to_video" && hasMultimodal) throw h3Error("h3_text_references_forbidden", "MiniMax H3 文生视频模式不能同时提交参考素材");
    if (input.referenceMode === "first_frame" && (input.imageCount !== 1 || input.videoCount || input.audioCount))
        throw h3Error("h3_first_frame_invalid", "MiniMax H3 首帧模式需要恰好 1 张图片，且不能同时使用多模态参考");
    if (input.referenceMode === "last_frame" && (input.imageCount !== 1 || input.videoCount || input.audioCount))
        throw h3Error("h3_last_frame_invalid", "MiniMax H3 尾帧模式需要恰好 1 张图片，且不能同时使用多模态参考");
    if (input.referenceMode === "first_last_frame" && (input.imageCount !== 2 || input.videoCount || input.audioCount))
        throw h3Error("h3_first_last_frame_invalid", "MiniMax H3 首尾帧模式需要恰好 2 张图片，且不能同时使用多模态参考");
    if (input.referenceMode === "omni" && !hasMultimodal) throw h3Error("h3_omni_reference_required", "MiniMax H3 全能参考模式至少需要 1 个参考素材");
}

export function buildMiniMaxH3Payload(input: MiniMaxH3RequestInput) {
    validateMiniMaxH3Request({
        ...input,
        imageCount: input.imageUrls.length,
        videoCount: input.videoUrls.length,
        audioCount: input.audioUrls.length,
    });
    const payload: Record<string, unknown> = {
        model: MINIMAX_H3_MODEL_ID,
        prompt: input.prompt,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        duration: input.duration,
    };
    if (input.referenceMode === "first_frame") payload.first_frame_image = input.imageUrls[0];
    if (input.referenceMode === "last_frame") payload.last_frame_image = input.imageUrls[0];
    if (input.referenceMode === "first_last_frame") {
        payload.first_frame_image = input.imageUrls[0];
        payload.last_frame_image = input.imageUrls[1];
    }
    if (input.referenceMode === "omni") {
        if (input.imageUrls.length) payload.image_urls = input.imageUrls;
        if (input.videoUrls.length) payload.video_urls = input.videoUrls;
        if (input.audioUrls.length) payload.audio_urls = input.audioUrls;
    }
    return payload;
}

export function miniMaxH3ProviderError(value: unknown) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const nested = record.error && typeof record.error === "object" && !Array.isArray(record.error) ? (record.error as Record<string, unknown>) : {};
    const code = String(nested.code ?? record.code ?? "").trim();
    const message = String(nested.message ?? record.message ?? record.fail_reason ?? "").trim();
    if (code && message) return `MiniMax H3 生成失败 [${code}]：${message}`;
    if (message) return `MiniMax H3 生成失败：${message}`;
    if (code) return `MiniMax H3 生成失败 [${code}]`;
    return "MiniMax H3 视频生成失败";
}

function validateDurations(kind: "视频" | "音频", count: number, values: Array<number | undefined>, totalLimitMs: number) {
    if (values.length !== count) throw h3Error(`h3_${kind === "视频" ? "video" : "audio"}_duration_mismatch`, `MiniMax H3 参考${kind}与时长必须一一对应`);
    if (!count) return;
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 2_000 || value > 15_000))
        throw h3Error(`h3_${kind === "视频" ? "video" : "audio"}_duration_invalid`, `MiniMax H3 参考${kind}单个时长必须为 2-15 秒`);
    if ((values as number[]).reduce((total, value) => total + value, 0) > totalLimitMs)
        throw h3Error(`h3_${kind === "视频" ? "video" : "audio"}_total_duration_invalid`, `MiniMax H3 参考${kind}总时长不能超过 15 秒`);
}

function h3Error(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}
