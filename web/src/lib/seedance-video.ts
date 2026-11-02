import i18n from "@/i18n";
import { seedanceCapabilitiesFor, type SeedanceModelCapabilities } from "@/lib/seedance-model-capabilities";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export const SEEDANCE_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 200 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
};
export const SEEDANCE_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];

export function isVideoFileByMimeOrExtension(file: Pick<File, "name" | "type">) {
    return file.type.startsWith("video/") || /\.(?:mp4|mov)$/i.test(file.name);
}

export function normalizeSeedanceVideoFile(file: File) {
    const mimeType = SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) ? file.type : /\.mov$/i.test(file.name) ? "video/quicktime" : /\.mp4$/i.test(file.name) ? "video/mp4" : "";
    return mimeType && mimeType !== file.type ? new File([file], file.name, { type: mimeType, lastModified: file.lastModified }) : file;
}

export const seedanceResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
] as const;

export const seedanceRatioOptions = [
    { value: "16:9" },
    { value: "9:16" },
    { value: "1:1" },
    { value: "21:9" },
    { value: "3:4" },
    { value: "4:3" },
    { value: "adaptive" },
] as const;

export const seedanceDurationOptions = Array.from({ length: 12 }, (_, index) => index + 4);

const seedancePixels = {
    "480p": {
        "16:9": "864x496",
        "4:3": "752x560",
        "1:1": "640x640",
        "3:4": "560x752",
        "9:16": "496x864",
        "21:9": "992x432",
    },
    "720p": {
        "16:9": "1280x720",
        "4:3": "1112x834",
        "1:1": "960x960",
        "3:4": "834x1112",
        "9:16": "720x1280",
        "21:9": "1470x630",
    },
    "1080p": {
        "16:9": "1920x1080",
        "4:3": "1664x1248",
        "1:1": "1440x1440",
        "3:4": "1248x1664",
        "9:16": "1080x1920",
        "21:9": "2206x946",
    },
} as const;

export function isSeedanceVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "apiFormat">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.videoModel || config.model) : config;
    return Boolean(seedanceCapabilitiesFor(requestConfig.model || requestConfig.videoModel));
}

export function normalizeSeedanceResolution(value: string, model = "doubao-seedance-2.0") {
    const normalized = normalizeResolutionToken(value);
    return seedanceCapabilitiesFor(model)?.resolutions.includes(normalized) ? normalized : "720p";
}

export function normalizeResolutionToken(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    if (/^4k$/i.test(value)) return "4k";
    const resolution = String(value || "").toLowerCase().replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

export function normalizeSeedanceRatio(value: string) {
    if (!value || value === "auto" || value === "adaptive") return "adaptive";
    if (seedanceRatioOptions.some((item) => item.value === value)) return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return "adaptive";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "adaptive";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["4:3", 4 / 3],
        ["1:1", 1],
        ["3:4", 3 / 4],
        ["9:16", 9 / 16],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

export function seedancePixelLabel(resolution: string, ratio: string) {
    if (normalizeResolutionToken(resolution) === "4k") return "4K";
    const normalizedResolution = normalizeSeedanceResolution(resolution) as keyof typeof seedancePixels;
    const normalizedRatio = normalizeSeedanceRatio(ratio) as keyof (typeof seedancePixels)[typeof normalizedResolution] | "adaptive";
    if (normalizedRatio === "adaptive") return i18n.t("seedance.autoMatch");
    return seedancePixels[normalizedResolution][normalizedRatio] || "";
}

export function boolConfig(value: string | undefined, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

export function seedanceReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    return i18n.t(`seedance.references.${kind}`, { index: index + 1 });
}

export function buildSeedancePromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const labels = [
        ...images.map((_, index) => seedanceReferenceLabel("image", index)),
        ...videos.map((_, index) => seedanceReferenceLabel("video", index)),
        ...audios.map((_, index) => seedanceReferenceLabel("audio", index)),
    ];
    const text = prompt.trim();
    if (!labels.length) return text;
    return i18n.t("seedance.promptPrefix", { labels: labels.join(i18n.t("seedance.separator")), prompt: text });
}

export function seedanceVideoReferenceError(videos: ReferenceVideo[], capabilities?: { references: { maxVideoDurationMs?: number; totalVideoDurationMs?: number } }) {
    const maxDurationMs = capabilities?.references.maxVideoDurationMs || 15_000;
    const totalLimitMs = capabilities?.references.totalVideoDurationMs || 15_000;
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const label = seedanceReferenceLabel("video", index);
        if (!SEEDANCE_VIDEO_MIME_TYPES.includes(video.type)) return i18n.t("seedance.errors.format", { label });
        if (video.bytes && video.bytes > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes) return i18n.t("seedance.errors.size", { label });
        if (video.durationMs) {
            if (video.durationMs < 2000 || video.durationMs > maxDurationMs) return i18n.t("seedance.errors.duration", { label, min: 2, max: maxDurationMs / 1000, actual: formatReferenceSeconds(video.durationMs) });
            totalDurationMs += video.durationMs;
        }
        if (video.width && video.height) {
            if (video.width < 300 || video.width > 6000 || video.height < 300 || video.height > 6000) return i18n.t("seedance.errors.dimensions", { label });
            const ratio = video.width / video.height;
            if (ratio < 0.4 || ratio > 2.5) return i18n.t("seedance.errors.ratio", { label });
            const pixels = video.width * video.height;
            if (pixels < 640 * 640 || pixels > 3326 * 2494) return i18n.t("seedance.errors.pixels", { label });
        }
    }
    if (totalDurationMs > totalLimitMs) return i18n.t("seedance.errors.totalDuration", { max: totalLimitMs / 1000 });
    return "";
}

export function seedanceVideoReferenceHint() {
    return i18n.t("seedance.referenceHint");
}

function formatReferenceSeconds(durationMs: number) {
    return (durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
