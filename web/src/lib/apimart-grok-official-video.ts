/** APIMart's official gateway contract. Deliberately separate from Ext and xAI native. */
export const APIMART_GROK_OFFICIAL_BASE_MODEL_ID = "grok-imagine-video-apimart-official";
export const APIMART_GROK_OFFICIAL_15_MODEL_ID = "grok-imagine-video-1.5-apimart-official";
export const APIMART_GROK_OFFICIAL_EDIT_MODEL_ID = "grok-imagine-video-edit-apimart-official";
// Operational protection only: APIMart has not published a fixed image-count limit.
export const APIMART_GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT = 30;
export const APIMART_GROK_OFFICIAL_SOURCE = "https://docs.apimart.ai/cn/api-reference/videos/grok-imagine/official";
const RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

export type ApimartGrokOfficialVideoCapabilities = {
    localModel: string;
    requestModel: "grok-imagine-video" | "grok-imagine-video-1.5";
    workflow: "generate" | "video_edit";
    resolutions: readonly string[];
    ratios: readonly string[];
    duration: { min: number; max: number; integer: true };
    prompt: { min: 1; max: 8000; unit: "unicode_code_points" };
    references: { images: number; videos: number; audios: 0; maxVideoDurationMs: number; totalVideoDurationMs: number; maxAudioDurationMs: 0; totalAudioDurationMs: 0; audioRequiresVisual: false };
    providerImageLimit: null;
    platformImageLimit: number;
    pricing: { status: "dynamic_required"; source: string };
    sources: readonly string[];
};

function capability(localModel: string, requestModel: ApimartGrokOfficialVideoCapabilities["requestModel"], edit = false): ApimartGrokOfficialVideoCapabilities {
    return {
        localModel, requestModel, workflow: edit ? "video_edit" : "generate",
        resolutions: edit ? [] : requestModel === "grok-imagine-video-1.5" ? ["480p", "720p", "1080p"] : ["480p", "720p"],
        ratios: edit ? [] : RATIOS,
        duration: { min: edit ? 0 : 1, max: edit ? 0 : 15, integer: true },
        prompt: { min: 1, max: 8000, unit: "unicode_code_points" },
        references: { images: edit ? 0 : APIMART_GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT, videos: edit ? 1 : 0, audios: 0, maxVideoDurationMs: edit ? 30_000 : 0, totalVideoDurationMs: edit ? 30_000 : 0, maxAudioDurationMs: 0, totalAudioDurationMs: 0, audioRequiresVisual: false },
        providerImageLimit: null, platformImageLimit: edit ? 0 : APIMART_GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT,
        pricing: { status: "dynamic_required", source: "https://apimart.ai/api/pricing/models/all" },
        sources: [APIMART_GROK_OFFICIAL_SOURCE],
    };
}

export const APIMART_GROK_OFFICIAL_VIDEO_CAPABILITIES: Record<string, ApimartGrokOfficialVideoCapabilities> = {
    [APIMART_GROK_OFFICIAL_BASE_MODEL_ID]: capability(APIMART_GROK_OFFICIAL_BASE_MODEL_ID, "grok-imagine-video"),
    [APIMART_GROK_OFFICIAL_15_MODEL_ID]: capability(APIMART_GROK_OFFICIAL_15_MODEL_ID, "grok-imagine-video-1.5"),
    [APIMART_GROK_OFFICIAL_EDIT_MODEL_ID]: capability(APIMART_GROK_OFFICIAL_EDIT_MODEL_ID, "grok-imagine-video", true),
};

export function apimartGrokOfficialVideoCapabilitiesFor(value: string | undefined) {
    const model = String(value || "").split("::").pop()?.toLowerCase() || "";
    // Canonical IDs identify generation; the distinct local edit ID selects edit.
    return APIMART_GROK_OFFICIAL_VIDEO_CAPABILITIES[model === "grok-imagine-video" ? APIMART_GROK_OFFICIAL_BASE_MODEL_ID : model === "grok-imagine-video-1.5" ? APIMART_GROK_OFFICIAL_15_MODEL_ID : model];
}

export function isApimartGrokOfficialVideoModel(value: string | undefined) {
    return Boolean(apimartGrokOfficialVideoCapabilitiesFor(value));
}

export function normalizeApimartGrokOfficialVideoSettings(model: string | undefined, settings: { resolution: string; ratio: string; duration: number }) {
    const capabilities = apimartGrokOfficialVideoCapabilitiesFor(model);
    if (!capabilities) return undefined;
    if (capabilities.workflow === "video_edit") return { resolution: "", ratio: "", duration: 0 };
    const resolution = String(settings.resolution || "").trim().toLowerCase().replace(/^(480|720|1080)$/, "$1p");
    const ratio = String(settings.ratio || "").trim().toLowerCase();
    return {
        resolution: capabilities.resolutions.includes(resolution) ? resolution : "480p",
        ratio: capabilities.ratios.includes(ratio) ? ratio : "auto",
        duration: Math.min(15, Math.max(1, Number.isFinite(settings.duration) ? Math.round(settings.duration) : 8)),
    };
}
