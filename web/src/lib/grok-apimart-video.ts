export type GrokApimartVideoCapabilities = {
    localModel: "grok-imagine-1.5-video-apimart";
    requestModel: "grok-imagine-1.5-video-ext";
    resolutions: readonly ["480p", "720p"];
    ratios: readonly ["16:9", "9:16", "1:1", "3:2", "2:3"];
    duration: { min: 6; max: 15; integer: true };
    references: { images: 7; videos: 0; audios: 0; maxVideoDurationMs: 0; maxAudioDurationMs: 0; totalVideoDurationMs: 0; totalAudioDurationMs: 0; audioRequiresVisual: false };
    pricing: {
        status: "dated_snapshot";
        checkedAt: "2026-09-05";
        source: "https://apimart.ai/api/pricing/models/all";
        usdPerSecond: { "480p": 0.0102; "720p": 0.01912 };
        exchangeRate: 7.30;
        discountAlreadyApplied: true;
    };
    sources: readonly string[];
};

export const GROK_APIMART_VIDEO_LOCAL_MODEL_ID = "grok-imagine-1.5-video-apimart";
export const GROK_APIMART_VIDEO_REQUEST_MODEL_ID = "grok-imagine-1.5-video-ext";
export const GROK_APIMART_VIDEO_CAPABILITIES: GrokApimartVideoCapabilities = {
    localModel: GROK_APIMART_VIDEO_LOCAL_MODEL_ID,
    requestModel: GROK_APIMART_VIDEO_REQUEST_MODEL_ID,
    resolutions: ["480p", "720p"],
    ratios: ["16:9", "9:16", "1:1", "3:2", "2:3"],
    duration: { min: 6, max: 15, integer: true },
    references: { images: 7, videos: 0, audios: 0, maxVideoDurationMs: 0, maxAudioDurationMs: 0, totalVideoDurationMs: 0, totalAudioDurationMs: 0, audioRequiresVisual: false },
    pricing: {
        status: "dated_snapshot",
        checkedAt: "2026-09-05",
        source: "https://apimart.ai/api/pricing/models/all",
        usdPerSecond: { "480p": 0.0102, "720p": 0.01912 },
        exchangeRate: 7.30,
        discountAlreadyApplied: true,
    },
    sources: [
        "https://docs.apimart.ai/cn/api-reference/videos/grok-imagine/generation.md",
        "https://apimart.ai/api/pricing/models/all",
    ],
};

export function isGrokApimartVideoModel(value: string | undefined) {
    const model = String(value || "").split("::").pop()?.toLowerCase();
    return model === GROK_APIMART_VIDEO_LOCAL_MODEL_ID || model === GROK_APIMART_VIDEO_REQUEST_MODEL_ID;
}

export function grokApimartVideoCapabilitiesFor(value: string | undefined) {
    return isGrokApimartVideoModel(value) ? GROK_APIMART_VIDEO_CAPABILITIES : undefined;
}

export function normalizeGrokApimartVideoSettings(settings: { resolution: string; ratio: string; duration: number }) {
    const resolution = String(settings.resolution || "").trim().toLowerCase();
    const ratio = String(settings.ratio || "").trim().toLowerCase();
    const roundedDuration = Number.isFinite(settings.duration) ? Math.round(settings.duration) : GROK_APIMART_VIDEO_CAPABILITIES.duration.min;
    return {
        resolution: GROK_APIMART_VIDEO_CAPABILITIES.resolutions.includes(resolution as "480p" | "720p") ? resolution as "480p" | "720p" : "720p",
        ratio: GROK_APIMART_VIDEO_CAPABILITIES.ratios.includes(ratio as never) ? ratio as "16:9" | "9:16" | "1:1" | "3:2" | "2:3" : "16:9",
        duration: Math.max(GROK_APIMART_VIDEO_CAPABILITIES.duration.min, Math.min(GROK_APIMART_VIDEO_CAPABILITIES.duration.max, roundedDuration)),
    };
}

export function grokApimartVideoSettingIssues(settings: { resolution: string; ratio: string; duration: number }) {
    const issues: string[] = [];
    if (!GROK_APIMART_VIDEO_CAPABILITIES.resolutions.includes(settings.resolution as never)) issues.push("Grok 1.5 视频分辨率只能是 480p 或 720p");
    if (!GROK_APIMART_VIDEO_CAPABILITIES.ratios.includes(settings.ratio as never)) issues.push("Grok 1.5 视频不支持当前宽高比");
    if (!Number.isInteger(settings.duration) || settings.duration < 6 || settings.duration > 15) issues.push("Grok 1.5 视频时长必须是 6-15 秒整数");
    return issues;
}
