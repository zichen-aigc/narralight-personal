import type { SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";

export type RunningHubGrokWorkflow = "text_to_video" | "first_frame" | "multi_image" | "video_edit" | "video_extend";

export type RunningHubGrokVideoCapabilities = {
    model: string;
    detailId: string;
    createPath: string;
    workflow: RunningHubGrokWorkflow;
    prompt: { min: number; max?: number };
    resolutions: readonly string[];
    ratios: readonly string[];
    duration: { values?: readonly number[]; min?: number; max?: number; integer: true };
    references: {
        images: number;
        videos: number;
        audios: 0;
        imageMaxBytes: number;
        videoMaxBytes: number;
        imageMimeTypes: readonly string[];
        videoMimeTypes: readonly string[];
        minVideoDurationMs?: number;
        maxVideoDurationMs?: number;
        maxAudioDurationMs: 0;
        totalVideoDurationMs: number;
        totalAudioDurationMs: 0;
        audioRequiresVisual: false;
    };
    requestFields: readonly string[];
    pricing: { checkedAt: "2026-09-06"; source: string; unit: string; rmb: Readonly<Record<string, number>>; imageRmb?: number };
};

export const RUNNINGHUB_GROK_TEXT_MODEL_ID = "xai/grok-imagine-video-v1.5/text-to-video/stable";
export const RUNNINGHUB_GROK_IMAGE_MODEL_ID = "xai/grok-imagine-video-v1.5/image-to-video/stable";
export const RUNNINGHUB_GROK_REFERENCE_MODEL_ID = "xai/grok-imagine-video-v1.5/reference-to-video/stable";
export const RUNNINGHUB_GROK_EDIT_MODEL_ID = "xai/grok-imagine-video/edit-video/stable";
export const RUNNINGHUB_GROK_EXTEND_MODEL_ID = "xai/grok-imagine-video/video-extend/stable";

const MB = 1024 * 1024;
const RATIOS = ["16:9", "1:1", "9:16", "3:2", "2:3"] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const detailPage = (detailId: string) => `https://www.runninghub.ai/call-api/api-detail/${detailId}`;

export const RUNNINGHUB_GROK_VIDEO_CAPABILITIES: Readonly<Record<string, RunningHubGrokVideoCapabilities>> = {
    [RUNNINGHUB_GROK_TEXT_MODEL_ID]: {
        model: RUNNINGHUB_GROK_TEXT_MODEL_ID,
        detailId: "2133100000000700029",
        createPath: "/rhart-video-g-official/text-to-video-v1.5",
        workflow: "text_to_video",
        prompt: { min: 5, max: 2048 },
        resolutions: ["480p", "720p", "1080p"],
        ratios: RATIOS,
        duration: { min: 1, max: 15, integer: true },
        references: { images: 0, videos: 0, audios: 0, imageMaxBytes: 0, videoMaxBytes: 0, imageMimeTypes: [], videoMimeTypes: [], maxAudioDurationMs: 0, totalVideoDurationMs: 0, totalAudioDurationMs: 0, audioRequiresVisual: false },
        requestFields: ["prompt", "duration", "aspectRatio", "resolution"],
        pricing: { checkedAt: "2026-09-06", source: detailPage("2133100000000700029"), unit: "RMB/output-second", rmb: { "480p": 0.56, "720p": 0.98, "1080p": 1.75 } },
    },
    [RUNNINGHUB_GROK_IMAGE_MODEL_ID]: {
        model: RUNNINGHUB_GROK_IMAGE_MODEL_ID,
        detailId: "2132764885651525688",
        createPath: "/rhart-video-g-official/image-to-video-v1.5",
        workflow: "first_frame",
        prompt: { min: 5, max: 2048 },
        resolutions: ["480p", "720p"],
        ratios: [],
        duration: { min: 1, max: 15, integer: true },
        references: { images: 1, videos: 0, audios: 0, imageMaxBytes: 100 * MB, videoMaxBytes: 0, imageMimeTypes: IMAGE_MIME_TYPES, videoMimeTypes: [], maxAudioDurationMs: 0, totalVideoDurationMs: 0, totalAudioDurationMs: 0, audioRequiresVisual: false },
        requestFields: ["prompt", "imageUrl", "duration", "resolution"],
        pricing: { checkedAt: "2026-09-06", source: detailPage("2132764885651525688"), unit: "RMB/output-second + RMB/input-image", rmb: { "480p": 0.56, "720p": 0.95 }, imageRmb: 0.07 },
    },
    [RUNNINGHUB_GROK_REFERENCE_MODEL_ID]: {
        model: RUNNINGHUB_GROK_REFERENCE_MODEL_ID,
        detailId: "2133100000000700028",
        createPath: "/rhart-video-g-official/reference-to-video-v1.5",
        workflow: "multi_image",
        prompt: { min: 5, max: 2048 },
        resolutions: ["480p", "720p"],
        ratios: RATIOS,
        duration: { min: 1, max: 15, integer: true },
        references: { images: 7, videos: 0, audios: 0, imageMaxBytes: 100 * MB, videoMaxBytes: 0, imageMimeTypes: IMAGE_MIME_TYPES, videoMimeTypes: [], maxAudioDurationMs: 0, totalVideoDurationMs: 0, totalAudioDurationMs: 0, audioRequiresVisual: false },
        requestFields: ["prompt", "referenceImages", "duration", "aspectRatio", "resolution"],
        pricing: { checkedAt: "2026-09-06", source: detailPage("2133100000000700028"), unit: "RMB/output-second + RMB/input-image", rmb: { "480p": 0.56, "720p": 0.98 }, imageRmb: 0.07 },
    },
    [RUNNINGHUB_GROK_EDIT_MODEL_ID]: {
        model: RUNNINGHUB_GROK_EDIT_MODEL_ID,
        detailId: "2028310887460519937",
        createPath: "/rhart-video-g-official/edit-video",
        workflow: "video_edit",
        prompt: { min: 5, max: 800 },
        resolutions: ["480p", "720p"],
        ratios: [],
        duration: { integer: true },
        references: { images: 0, videos: 1, audios: 0, imageMaxBytes: 0, videoMaxBytes: 50 * MB, imageMimeTypes: [], videoMimeTypes: ["video/mp4"], minVideoDurationMs: 1_000, maxVideoDurationMs: 8_000, maxAudioDurationMs: 0, totalVideoDurationMs: 8_000, totalAudioDurationMs: 0, audioRequiresVisual: false },
        requestFields: ["prompt", "videoUrl", "resolution"],
        pricing: { checkedAt: "2026-09-06", source: detailPage("2028310887460519937"), unit: "RMB/input-second", rmb: { input: 0.41 } },
    },
    [RUNNINGHUB_GROK_EXTEND_MODEL_ID]: {
        model: RUNNINGHUB_GROK_EXTEND_MODEL_ID,
        detailId: "2043991611295436803",
        createPath: "/rhart-video-g-official/video-extend",
        workflow: "video_extend",
        prompt: { min: 1, max: 2048 },
        resolutions: [],
        ratios: [],
        duration: { values: [6, 10], integer: true },
        references: { images: 0, videos: 1, audios: 0, imageMaxBytes: 0, videoMaxBytes: 100 * MB, imageMimeTypes: [], videoMimeTypes: ["video/mp4", "video/quicktime"], maxAudioDurationMs: 0, totalVideoDurationMs: 0, totalAudioDurationMs: 0, audioRequiresVisual: false },
        requestFields: ["videoUrl", "prompt", "duration"],
        pricing: { checkedAt: "2026-09-06", source: detailPage("2043991611295436803"), unit: "RMB/request", rmb: { "6": 1.89, "10": 3.15 } },
    },
};

export const RUNNINGHUB_GROK_MODEL_IDS = Object.keys(RUNNINGHUB_GROK_VIDEO_CAPABILITIES);

export function runningHubGrokCapabilitiesFor(value: string | undefined) {
    const model = String(value || "").split("::").pop()?.toLowerCase() || "";
    return RUNNINGHUB_GROK_VIDEO_CAPABILITIES[model];
}

export function isRunningHubGrokVideoModel(value: string | undefined) {
    return Boolean(runningHubGrokCapabilitiesFor(value));
}

export function runningHubGrokMediaTypeAllowed(name: string, mimeType: string | undefined, allowed: readonly string[]) {
    const normalized = String(mimeType || "").toLowerCase() === "image/jpg" ? "image/jpeg" : String(mimeType || "").toLowerCase();
    if (allowed.includes(normalized)) return true;
    const pathname = String(name || "").split(/[?#]/, 1)[0].toLowerCase();
    const extensionType = pathname.endsWith(".jpg") || pathname.endsWith(".jpeg") ? "image/jpeg"
        : pathname.endsWith(".png") ? "image/png"
            : pathname.endsWith(".webp") ? "image/webp"
                : pathname.endsWith(".mp4") ? "video/mp4"
                    : pathname.endsWith(".mov") ? "video/quicktime"
                        : "";
    return allowed.includes(extensionType);
}

export function runningHubGrokReferenceMode(value: string | undefined): SeedanceReferenceMode | undefined {
    return runningHubGrokCapabilitiesFor(value)?.workflow;
}

export function normalizeRunningHubGrokSettings(model: string | undefined, settings: { resolution: string; ratio: string; duration: number }) {
    const capability = runningHubGrokCapabilitiesFor(model);
    if (!capability) return undefined;
    const resolution = String(settings.resolution || "").trim().toLowerCase();
    const ratio = String(settings.ratio || "").trim().toLowerCase();
    const rounded = Number.isFinite(settings.duration) ? Math.round(settings.duration) : capability.duration.values?.[0] ?? capability.duration.min ?? 1;
    const duration = capability.duration.values
        ? capability.duration.values.includes(rounded) ? rounded : capability.duration.values[0]
        : Math.max(capability.duration.min ?? rounded, Math.min(capability.duration.max ?? rounded, rounded));
    return {
        resolution: capability.resolutions.includes(resolution) ? resolution : capability.resolutions.includes("720p") ? "720p" : capability.resolutions[0] || "",
        ratio: capability.ratios.includes(ratio) ? ratio : capability.ratios[0] || "",
        duration,
        referenceMode: capability.workflow,
    };
}
