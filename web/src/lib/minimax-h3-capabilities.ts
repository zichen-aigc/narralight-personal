import type { SeedanceReferenceMode } from "./seedance-model-capabilities";

export type MiniMaxH3ReferenceMode = Extract<SeedanceReferenceMode, "text_to_video" | "first_frame" | "last_frame" | "first_last_frame" | "omni">;

export type MiniMaxH3Capabilities = {
    model: "MiniMax-H3";
    resolutions: readonly ["2K", "768P"];
    ratios: readonly ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"];
    duration: { min: 4; max: 15; integer: true };
    references: {
        images: 9;
        videos: 3;
        audios: 3;
        maxVideoDurationMs: 15_000;
        maxAudioDurationMs: 15_000;
        totalVideoDurationMs: 15_000;
        totalAudioDurationMs: 15_000;
        audioRequiresVisual: true;
    };
    modes: readonly MiniMaxH3ReferenceMode[];
    pricing: {
        status: "dated_snapshot";
        checkedAt: "2026-09-03";
        source: "https://apimart.ai/api/pricing/model?model=MiniMax-H3";
        usdPerSecond: { "768P": 0.0714; "2K": 0.1143 };
        freeReferenceImages: 5;
        usdPerExtraReferenceImage: 0.0286;
        videoReferenceBilling: "additive_duration";
        discountAlreadyApplied: true;
    };
    sources: readonly string[];
};

export const MINIMAX_H3_MODEL_ID = "MiniMax-H3";
export const MINIMAX_H3_MODES: readonly MiniMaxH3ReferenceMode[] = ["text_to_video", "first_frame", "last_frame", "first_last_frame", "omni"];
export const MINIMAX_H3_CAPABILITIES: MiniMaxH3Capabilities = {
    model: MINIMAX_H3_MODEL_ID,
    resolutions: ["2K", "768P"],
    ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"],
    duration: { min: 4, max: 15, integer: true },
    references: {
        images: 9,
        videos: 3,
        audios: 3,
        maxVideoDurationMs: 15_000,
        maxAudioDurationMs: 15_000,
        totalVideoDurationMs: 15_000,
        totalAudioDurationMs: 15_000,
        audioRequiresVisual: true,
    },
    modes: MINIMAX_H3_MODES,
    pricing: {
        status: "dated_snapshot",
        checkedAt: "2026-09-03",
        source: "https://apimart.ai/api/pricing/model?model=MiniMax-H3",
        usdPerSecond: { "768P": 0.0714, "2K": 0.1143 },
        freeReferenceImages: 5,
        usdPerExtraReferenceImage: 0.0286,
        videoReferenceBilling: "additive_duration",
        discountAlreadyApplied: true,
    },
    sources: [
        "https://docs.apib.ai/cn/api-reference/videos/minimax-h3/generation.md",
        "https://apimart.ai/api/pricing/model?model=MiniMax-H3",
    ],
};

export function isMiniMaxH3Model(value: string | undefined) {
    return String(value || "").split("::").pop()?.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase();
}

export function miniMaxH3CapabilitiesFor(value: string | undefined) {
    return isMiniMaxH3Model(value) ? MINIMAX_H3_CAPABILITIES : undefined;
}

export function normalizeMiniMaxH3Resolution(value: string | undefined): "2K" | "768P" {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "768" || normalized === "768p" ? "768P" : "2K";
}

export function normalizeMiniMaxH3Settings(settings: { referenceMode: SeedanceReferenceMode; resolution: string; ratio: string; duration: number }) {
    const referenceMode = MINIMAX_H3_MODES.includes(settings.referenceMode as MiniMaxH3ReferenceMode) ? settings.referenceMode as MiniMaxH3ReferenceMode : "text_to_video";
    const duration = Number.isFinite(settings.duration) ? Math.round(settings.duration) : MINIMAX_H3_CAPABILITIES.duration.min;
    const requestedRatio = String(settings.ratio || "").toLowerCase();
    const ratio = ["first_frame", "last_frame", "first_last_frame"].includes(referenceMode)
        ? "adaptive"
        : referenceMode === "text_to_video" && requestedRatio === "adaptive"
            ? "16:9"
        : MINIMAX_H3_CAPABILITIES.ratios.includes(requestedRatio as never)
            ? requestedRatio
            : referenceMode === "text_to_video" ? "16:9" : "adaptive";
    return {
        referenceMode,
        resolution: normalizeMiniMaxH3Resolution(settings.resolution),
        ratio,
        duration: Math.max(MINIMAX_H3_CAPABILITIES.duration.min, Math.min(MINIMAX_H3_CAPABILITIES.duration.max, duration)),
    };
}

export function miniMaxH3SettingIssues(settings: { referenceMode: SeedanceReferenceMode; resolution: string; ratio: string; duration: number }) {
    const issues: string[] = [];
    if (!MINIMAX_H3_MODES.includes(settings.referenceMode as MiniMaxH3ReferenceMode)) issues.push("MiniMax H3 不支持当前生成模式");
    if (!MINIMAX_H3_CAPABILITIES.resolutions.includes(settings.resolution as never)) issues.push("MiniMax H3 分辨率只能是 2K 或 768P");
    if (!Number.isInteger(settings.duration) || settings.duration < 4 || settings.duration > 15) issues.push("MiniMax H3 时长必须是 4-15 秒整数");
    const frameMode = ["first_frame", "last_frame", "first_last_frame"].includes(settings.referenceMode);
    if (frameMode && settings.ratio !== "adaptive") issues.push("MiniMax H3 首帧、尾帧或首尾帧模式必须使用自适应比例");
    if (!frameMode && !MINIMAX_H3_CAPABILITIES.ratios.includes(settings.ratio as never)) issues.push("MiniMax H3 不支持当前宽高比");
    if (settings.referenceMode === "text_to_video" && settings.ratio === "adaptive") issues.push("MiniMax H3 文生视频必须选择具体宽高比");
    return issues;
}
