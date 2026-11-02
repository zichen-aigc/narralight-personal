export type SeedanceReferenceMode = "text_to_video" | "omni" | "video_edit" | "video_extend" | "first_frame" | "last_frame" | "first_last_frame" | "multi_image" | "motion_transfer" | "draft";

export type SeedanceReferenceModeCapability = {
    enabled: boolean;
    requestFields: Array<"image_urls" | "image_with_roles" | "video_urls" | "audio_urls" | "return_last_frame" | "omni_reference_task_type" | "draft">;
    reason?: string;
};

export type SeedanceModelCapabilities = {
    family: "seedance-1.5" | "seedance-2.0" | "seedance-2.5";
    providerContract?: "apimart" | "volcengine-ark" | "runninghub";
    fps: 24;
    resolutions: string[];
    ratios: string[];
    duration: { min: number; max: number; integer: true };
    references: { images: number; videos: number; audios: number; maxVideoDurationMs: number; maxAudioDurationMs: number; totalVideoDurationMs: number; totalAudioDurationMs: number; audioRequiresVisual: boolean };
    modes: Record<SeedanceReferenceMode, SeedanceReferenceModeCapability>;
    outputFormats?: Array<"mp4" | "mov">;
    pricing: { status: "pending_sync"; formulaStatus: "unverified"; source: string; checkedAt: string };
    sources: string[];
};

export const SEEDANCE_REFERENCE_MODES: SeedanceReferenceMode[] = ["text_to_video", "omni", "video_edit", "video_extend", "first_frame", "last_frame", "first_last_frame", "multi_image", "motion_transfer", "draft"];
export const SEEDANCE_RECOMMENDED_DURATIONS = [4, 6, 8, 10, 12, 14, 15, 20, 25, 30];

const API_REFERENCE = "https://docs.apimart.ai/en/api-reference/videos/doubao-seedance-2-0/generation";
const MODEL_PAGE = "https://apimart.ai/zh/model/doubao-seedance-2-0";
const APIMART_25_API_REFERENCE = "https://docs.apimart.ai/cn/api-reference/videos/seedance-2-5/generation";
const APIMART_25_MODEL_PAGE = "https://apimart.ai/zh/model/doubao-seedance-2-5";
const APIMART_RATIOS = ["16:9", "9:16", "1:1", "21:9", "3:4", "4:3", "adaptive"];
const VOLCENGINE_RATIOS = ["16:9", "9:16", "1:1", "21:9", "3:4", "4:3", "adaptive"];
const VOLCENGINE_API_REFERENCE = "https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1520757?lang=zh";
const RUNNINGHUB_API_REFERENCE = "https://www.runninghub.ai/zh-cn/call-api/api-detail/2133100000000700025";
export const RUNNINGHUB_SEEDANCE_25_MODEL_ID = "bytedance/seedance-2.5-global-token/multimodal-video";
const disabledMode = (reason = "当前模型不支持此模式"): SeedanceReferenceModeCapability => ({ enabled: false, requestFields: [], reason });
const modeSet = (enabled: Partial<Record<SeedanceReferenceMode, SeedanceReferenceModeCapability>>): Record<SeedanceReferenceMode, SeedanceReferenceModeCapability> => Object.fromEntries(SEEDANCE_REFERENCE_MODES.map((mode) => [mode, enabled[mode] || disabledMode()])) as Record<SeedanceReferenceMode, SeedanceReferenceModeCapability>;
const apimartModes = modeSet({
    omni: { enabled: true, requestFields: ["image_urls", "video_urls", "audio_urls"] },
    video_edit: { enabled: true, requestFields: ["video_urls"] },
    video_extend: { enabled: false, requestFields: ["return_last_frame"], reason: "当前文档只证实返回尾帧，未证实直接延长视频的请求语义" },
    first_last_frame: { enabled: true, requestFields: ["image_with_roles"] },
    multi_image: { enabled: true, requestFields: ["image_urls"] },
    motion_transfer: { enabled: true, requestFields: ["image_urls", "video_urls"] },
});
const apimart25Modes = modeSet({
    text_to_video: { enabled: true, requestFields: [] },
    omni: { enabled: true, requestFields: ["image_urls", "video_urls", "audio_urls", "omni_reference_task_type"] },
    video_edit: { enabled: true, requestFields: ["video_urls", "omni_reference_task_type"] },
    video_extend: { enabled: true, requestFields: ["video_urls", "omni_reference_task_type"] },
    first_frame: { enabled: true, requestFields: ["image_with_roles"] },
    first_last_frame: { enabled: true, requestFields: ["image_with_roles"] },
    multi_image: { enabled: true, requestFields: ["image_urls"] },
    motion_transfer: { enabled: true, requestFields: ["image_urls", "video_urls", "omni_reference_task_type"] },
});
const volcengine20Modes = modeSet({
    text_to_video: { enabled: true, requestFields: [] },
    omni: { enabled: true, requestFields: ["image_urls", "video_urls", "audio_urls"] },
    video_edit: { enabled: true, requestFields: ["video_urls"] },
    video_extend: { enabled: true, requestFields: ["video_urls"] },
    first_frame: { enabled: true, requestFields: ["image_with_roles"] },
    first_last_frame: { enabled: true, requestFields: ["image_with_roles"] },
    multi_image: { enabled: true, requestFields: ["image_urls"] },
    motion_transfer: { enabled: true, requestFields: ["image_urls", "video_urls"] },
});
const volcengine25Modes = modeSet({
    ...volcengine20Modes,
    omni: { enabled: true, requestFields: ["image_urls", "video_urls", "audio_urls", "omni_reference_task_type"] },
    video_edit: { enabled: true, requestFields: ["video_urls", "omni_reference_task_type"] },
    video_extend: { enabled: true, requestFields: ["video_urls", "omni_reference_task_type"] },
});
const volcengine15Modes = modeSet({
    text_to_video: { enabled: true, requestFields: [] },
    first_frame: { enabled: true, requestFields: ["image_with_roles"] },
    first_last_frame: { enabled: true, requestFields: ["image_with_roles"] },
    draft: { enabled: true, requestFields: ["draft"] },
});
const runningHub25Modes = modeSet({
    text_to_video: { enabled: true, requestFields: [] },
    omni: { enabled: true, requestFields: ["image_urls", "video_urls", "audio_urls", "omni_reference_task_type"] },
    video_edit: { enabled: true, requestFields: ["video_urls", "omni_reference_task_type"] },
    video_extend: { enabled: true, requestFields: ["video_urls", "omni_reference_task_type"] },
    multi_image: { enabled: true, requestFields: ["image_urls", "omni_reference_task_type"] },
    motion_transfer: { enabled: true, requestFields: ["image_urls", "video_urls", "omni_reference_task_type"] },
});

function apimartCapability(resolutions: string[]): SeedanceModelCapabilities {
    return {
        family: "seedance-2.0",
        providerContract: "apimart",
        fps: 24,
        resolutions,
        ratios: [...APIMART_RATIOS],
        duration: { min: 4, max: 15, integer: true },
        references: { images: 9, videos: 3, audios: 3, maxVideoDurationMs: 15_000, maxAudioDurationMs: 15_000, totalVideoDurationMs: 15_000, totalAudioDurationMs: 15_000, audioRequiresVisual: true },
        modes: apimartModes,
        pricing: { status: "pending_sync", formulaStatus: "unverified", source: MODEL_PAGE, checkedAt: "2026-08-10" },
        sources: [API_REFERENCE, MODEL_PAGE],
    };
}

function apimart25Capability(): SeedanceModelCapabilities {
    return {
        family: "seedance-2.5",
        providerContract: "apimart",
        fps: 24,
        resolutions: ["480p", "720p", "1080p"],
        ratios: [...APIMART_RATIOS],
        duration: { min: 4, max: 30, integer: true },
        references: { images: 30, videos: 10, audios: 10, maxVideoDurationMs: 30_000, maxAudioDurationMs: 30_000, totalVideoDurationMs: 30_000, totalAudioDurationMs: 30_000, audioRequiresVisual: false },
        modes: apimart25Modes,
        outputFormats: ["mp4", "mov"],
        pricing: { status: "pending_sync", formulaStatus: "unverified", source: APIMART_25_MODEL_PAGE, checkedAt: "2026-09-02" },
        sources: [APIMART_25_API_REFERENCE, APIMART_25_MODEL_PAGE],
    };
}

function volcengineCapability(input: { family: SeedanceModelCapabilities["family"]; resolutions: string[]; maxDuration: number; images: number; videos: number; audios: number; referenceDurationMs: number; audioRequiresVisual: boolean; modes: Record<SeedanceReferenceMode, SeedanceReferenceModeCapability> }): SeedanceModelCapabilities {
    return {
        family: input.family,
        providerContract: "volcengine-ark",
        fps: 24,
        resolutions: input.resolutions,
        ratios: [...VOLCENGINE_RATIOS],
        duration: { min: 4, max: input.maxDuration, integer: true },
        references: { images: input.images, videos: input.videos, audios: input.audios, maxVideoDurationMs: input.referenceDurationMs, maxAudioDurationMs: input.referenceDurationMs, totalVideoDurationMs: input.referenceDurationMs, totalAudioDurationMs: input.referenceDurationMs, audioRequiresVisual: input.audioRequiresVisual },
        modes: input.modes,
        pricing: { status: "pending_sync", formulaStatus: "unverified", source: VOLCENGINE_API_REFERENCE, checkedAt: "2026-08-18" },
        outputFormats: input.family === "seedance-2.5" ? ["mp4", "mov"] : undefined,
        sources: [VOLCENGINE_API_REFERENCE],
    };
}

function runningHub25Capability(): SeedanceModelCapabilities {
    return {
        family: "seedance-2.5",
        providerContract: "runninghub",
        fps: 24,
        resolutions: ["480p", "720p", "native1080p", "1080p", "2k", "4k"],
        ratios: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        duration: { min: 4, max: 30, integer: true },
        outputFormats: ["mp4"],
        references: { images: 30, videos: 10, audios: 10, maxVideoDurationMs: 30_000, maxAudioDurationMs: 30_000, totalVideoDurationMs: 30_000, totalAudioDurationMs: 30_000, audioRequiresVisual: false },
        modes: runningHub25Modes,
        pricing: { status: "pending_sync", formulaStatus: "unverified", source: RUNNINGHUB_API_REFERENCE, checkedAt: "2026-09-04" },
        sources: [RUNNINGHUB_API_REFERENCE],
    };
}

export const SEEDANCE_MODEL_CAPABILITIES: Record<string, SeedanceModelCapabilities> = {
    "doubao-seedance-2.5": apimart25Capability(),
    "seedance-2.5": apimart25Capability(),
    "doubao-seedance-2.0": apimartCapability(["480p", "720p", "1080p", "4k"]),
    "doubao-seedance-2.0-fast": apimartCapability(["480p", "720p"]),
    "doubao-seedance-2.0-mini": apimartCapability(["480p", "720p"]),
    "doubao-seedance-2-5-260628": volcengineCapability({ family: "seedance-2.5", resolutions: ["480p", "720p", "1080p"], maxDuration: 30, images: 30, videos: 10, audios: 10, referenceDurationMs: 30_000, audioRequiresVisual: false, modes: volcengine25Modes }),
    "doubao-seedance-2-0-260128": volcengineCapability({ family: "seedance-2.0", resolutions: ["480p", "720p", "1080p", "4k"], maxDuration: 15, images: 9, videos: 3, audios: 3, referenceDurationMs: 15_000, audioRequiresVisual: true, modes: volcengine20Modes }),
    "doubao-seedance-2-0-fast-260128": volcengineCapability({ family: "seedance-2.0", resolutions: ["480p", "720p"], maxDuration: 15, images: 9, videos: 3, audios: 3, referenceDurationMs: 15_000, audioRequiresVisual: true, modes: volcengine20Modes }),
    "doubao-seedance-2-0-mini-260615": volcengineCapability({ family: "seedance-2.0", resolutions: ["480p", "720p"], maxDuration: 15, images: 9, videos: 3, audios: 3, referenceDurationMs: 15_000, audioRequiresVisual: true, modes: volcengine20Modes }),
    "doubao-seedance-1-5-pro-251215": volcengineCapability({ family: "seedance-1.5", resolutions: ["480p", "720p", "1080p"], maxDuration: 12, images: 2, videos: 0, audios: 0, referenceDurationMs: 15_000, audioRequiresVisual: true, modes: volcengine15Modes }),
    [RUNNINGHUB_SEEDANCE_25_MODEL_ID]: runningHub25Capability(),
};

export function canonicalApimartSeedanceModel(model: string) {
    return String(model || "").toLowerCase() === "doubao-seedance-2.5" ? "seedance-2.5" : model;
}

export function seedanceCapabilitiesFor(model: string | undefined) {
    const name = String(model || "").split("::").pop()?.toLowerCase() || "";
    return SEEDANCE_MODEL_CAPABILITIES[name];
}

export function enabledSeedanceReferenceModes(capabilities: SeedanceModelCapabilities | undefined) {
    return SEEDANCE_REFERENCE_MODES.filter((mode) => capabilities?.modes[mode]?.enabled);
}

export function seedanceDurationSlider(capabilities: SeedanceModelCapabilities) {
    const { min, max } = capabilities.duration;
    const marks = [...new Set([min, ...SEEDANCE_RECOMMENDED_DURATIONS.filter((value) => value >= min && value <= max), max])].sort((a, b) => a - b);
    return { min, max, step: 1, marks };
}

export function seedanceModeConstraints(capabilities: SeedanceModelCapabilities, referenceMode: SeedanceReferenceMode) {
    const forceAdaptiveRatio = capabilities.family === "seedance-2.5" && ["video_edit", "video_extend", "first_frame", "first_last_frame"].includes(referenceMode);
    const forceSmartDuration = capabilities.family === "seedance-2.5" && referenceMode === "video_edit";
    return { forceAdaptiveRatio, forceSmartDuration };
}

export function normalizeSeedanceSettings(capabilities: SeedanceModelCapabilities, settings: { referenceMode: SeedanceReferenceMode; resolution: string; ratio: string; duration: number }) {
    const enabledModes = enabledSeedanceReferenceModes(capabilities);
    const referenceMode = enabledModes.includes(settings.referenceMode) ? settings.referenceMode : enabledModes[0] || "omni";
    const constraints = seedanceModeConstraints(capabilities, referenceMode);
    const duration = Number.isFinite(settings.duration) ? Math.round(settings.duration) : capabilities.duration.min;
    return {
        referenceMode,
        resolution: capabilities.resolutions.includes(settings.resolution) ? settings.resolution : capabilities.resolutions[0],
        ratio: constraints.forceAdaptiveRatio ? "adaptive" : capabilities.ratios.includes(settings.ratio) ? settings.ratio : capabilities.ratios[0],
        duration: constraints.forceSmartDuration ? -1 : Math.max(capabilities.duration.min, Math.min(capabilities.duration.max, duration)),
    };
}

export function seedanceSettingIssues(model: string, settings: { resolution: string; ratio: string; duration: number; referenceMode?: SeedanceReferenceMode }) {
    const capabilities = seedanceCapabilitiesFor(model);
    if (!capabilities) return [];
    const issues: string[] = [];
    const constraints = settings.referenceMode ? seedanceModeConstraints(capabilities, settings.referenceMode) : { forceAdaptiveRatio: false, forceSmartDuration: false };
    if (!capabilities.resolutions.includes(settings.resolution)) issues.push(`${model} 不支持 ${settings.resolution}，请选择 ${capabilities.resolutions.join("/")}`);
    if (!capabilities.ratios.includes(settings.ratio)) issues.push(`${model} 不支持比例 ${settings.ratio}`);
    if (constraints.forceAdaptiveRatio && settings.ratio !== "adaptive") issues.push("当前模式的比例必须使用 adaptive");
    if (constraints.forceSmartDuration ? settings.duration !== -1 : !Number.isInteger(settings.duration) || settings.duration < capabilities.duration.min || settings.duration > capabilities.duration.max) issues.push(constraints.forceSmartDuration ? "当前模式的时长必须使用 -1（智能选择）" : `时长必须是 ${capabilities.duration.min}-${capabilities.duration.max} 秒整数`);
    return issues;
}
