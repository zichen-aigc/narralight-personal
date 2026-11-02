import { canonicalApimartSeedanceModel, seedanceCapabilitiesFor, seedanceModeConstraints, type SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";

export type SeedanceApimartRequestInput = {
    model: string;
    prompt: string;
    resolution: string;
    size: string;
    duration: number;
    generateAudio: boolean;
    watermark: boolean;
    outputFormat: "mp4" | "mov";
    referenceMode: SeedanceReferenceMode;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    videoDurationsMs: (number | undefined)[];
    audioDurationsMs: (number | undefined)[];
};

export function validateSeedanceApimartRequest(input: Omit<SeedanceApimartRequestInput, "imageUrls" | "videoUrls" | "audioUrls"> & { imageCount: number; videoCount: number; audioCount: number }) {
    const capabilities = seedanceCapabilitiesFor(input.model);
    if (!capabilities) throw new Error(`${input.model} 没有已登记的 Seedance 能力`);
    if (!capabilities.resolutions.includes(input.resolution)) throw new Error(`${input.model} 不支持 ${input.resolution}，可选 ${capabilities.resolutions.join("/")}`);
    if (!capabilities.ratios.includes(input.size)) throw new Error(`${input.model} 不支持比例 ${input.size}`);
    const constraints = seedanceModeConstraints(capabilities, input.referenceMode);
    if (constraints.forceAdaptiveRatio && input.size !== "adaptive") throw new Error("当前模式的比例必须使用 adaptive");
    if (constraints.forceSmartDuration ? input.duration !== -1 : !Number.isInteger(input.duration) || input.duration < capabilities.duration.min || input.duration > capabilities.duration.max) throw new Error(constraints.forceSmartDuration ? "当前模式的时长必须使用 -1（智能选择）" : `时长必须是 ${capabilities.duration.min}-${capabilities.duration.max} 秒整数`);
    if (capabilities.family === "seedance-2.5" && !["mp4", "mov"].includes(input.outputFormat)) throw new Error("Seedance 2.5 输出格式必须是 mp4 或 mov");
    if (input.imageCount > capabilities.references.images) throw new Error(`参考图最多 ${capabilities.references.images} 张`);
    if (input.videoCount > capabilities.references.videos) throw new Error(`参考视频最多 ${capabilities.references.videos} 个`);
    if (input.audioCount > capabilities.references.audios) throw new Error(`参考音频最多 ${capabilities.references.audios} 个`);
    validateReferenceDurations("视频", input.videoCount, input.videoDurationsMs, capabilities.references.maxVideoDurationMs, capabilities.references.totalVideoDurationMs);
    validateReferenceDurations("音频", input.audioCount, input.audioDurationsMs, capabilities.references.maxAudioDurationMs, capabilities.references.totalAudioDurationMs);
    if (input.audioCount && capabilities.references.audioRequiresVisual && !input.imageCount && !input.videoCount) throw new Error("参考音频必须配合参考图或参考视频");
    const mode = capabilities.modes[input.referenceMode];
    if (!mode?.enabled) throw new Error(mode?.reason || "当前参考模式不可用");
    if (input.referenceMode === "text_to_video" && input.imageCount + input.videoCount + input.audioCount > 0) throw new Error("文生视频模式不能同时使用参考素材");
    if (input.referenceMode === "first_last_frame" && (input.imageCount !== 2 || input.videoCount || input.audioCount)) throw new Error("首尾帧模式需要恰好 2 张图片，且不能同时使用视频或音频参考");
    if (input.referenceMode === "first_frame" && (input.imageCount !== 1 || input.videoCount || input.audioCount)) throw new Error("首帧模式需要恰好 1 张图片，且不能同时使用视频或音频参考");
    if (input.referenceMode === "multi_image" && (input.imageCount < 2 || input.videoCount || input.audioCount)) throw new Error(`多图参考模式需要 2-${capabilities.references.images} 张图片，且不能同时使用视频或音频参考`);
    if (input.referenceMode === "video_edit" && !input.videoCount) throw new Error("视频编辑模式需要至少 1 个参考视频");
    if (input.referenceMode === "video_extend" && !input.videoCount) throw new Error("视频延长模式需要至少 1 个参考视频");
    if (input.referenceMode === "motion_transfer" && (!input.imageCount || !input.videoCount || input.audioCount)) throw new Error("动作模仿模式需要至少 1 张参考图和 1 个参考视频，且不能同时使用音频参考");
}

export function buildSeedanceApimartPayload(input: SeedanceApimartRequestInput) {
    validateSeedanceApimartRequest({
        ...input,
        imageCount: input.imageUrls.length,
        videoCount: input.videoUrls.length,
        audioCount: input.audioUrls.length,
    });
    const payload: Record<string, unknown> = {
        model: canonicalApimartSeedanceModel(input.model),
        prompt: input.prompt,
        resolution: input.resolution,
        size: input.size,
        duration: input.duration,
        generate_audio: input.generateAudio,
        watermark: input.watermark,
    };
    if (seedanceCapabilitiesFor(input.model)?.family === "seedance-2.5") payload.output_format = input.outputFormat;
    if (input.referenceMode === "video_edit") payload.omni_reference_task_type = "edit";
    else if (input.referenceMode === "video_extend") payload.omni_reference_task_type = "extend";
    else if (["omni", "motion_transfer"].includes(input.referenceMode) && input.imageUrls.length + input.videoUrls.length + input.audioUrls.length > 0) payload.omni_reference_task_type = "reference";
    if (input.referenceMode === "first_frame" || input.referenceMode === "first_last_frame") {
        payload.image_with_roles = input.imageUrls.map((url, index) => ({ url, role: index === 0 ? "first_frame" : "last_frame" }));
        return payload;
    }
    if (input.imageUrls.length) payload.image_urls = input.imageUrls;
    if (input.videoUrls.length) payload.video_urls = input.videoUrls;
    if (input.audioUrls.length) payload.audio_urls = input.audioUrls;
    return payload;
}

function validateReferenceDurations(kind: "视频" | "音频", referenceCount: number, values: (number | undefined)[], itemLimitMs: number, totalLimitMs: number) {
    if (values.length !== referenceCount) throw new Error(`参考${kind}与时长必须一一对应`);
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new Error(`参考${kind}时长必须已知、有限且大于 0`);
    const durations = values as number[];
    const invalid = durations.find((value) => value < 2_000 || value > itemLimitMs);
    if (invalid !== undefined) throw new Error(`参考${kind}单个需为 2-${formatSeconds(itemLimitMs)} 秒（实际 ${formatSeconds(invalid)} 秒）`);
    if (sum(durations) > totalLimitMs) throw new Error(`参考${kind}总时长不能超过 ${formatSeconds(totalLimitMs)} 秒`);
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function formatSeconds(durationMs: number) {
    return (durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
