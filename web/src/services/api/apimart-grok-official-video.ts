import { apimartGrokOfficialVideoCapabilitiesFor } from "@/lib/apimart-grok-official-video";
import { throwApiError } from "@/services/api-error";

export type ApimartGrokOfficialVideoRequestCounts = {
    model: string;
    prompt: string;
    resolution?: string;
    ratio?: string;
    duration?: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};
export type ApimartGrokOfficialVideoRequestInput = Omit<ApimartGrokOfficialVideoRequestCounts, "imageCount" | "videoCount"> & {
    imageUrls: string[];
    videoUrls: string[];
    nsfwCheck?: boolean;
};

export function validateApimartGrokOfficialVideoRequest(input: ApimartGrokOfficialVideoRequestCounts) {
    const capability = apimartGrokOfficialVideoCapabilitiesFor(input.model);
    if (!capability) throw officialError("model_invalid", "APIMart 官方 Grok 模型无效");
    if (typeof input.prompt !== "string" || !input.prompt.trim() || Array.from(input.prompt.trim()).length > 8000)
        throw officialError("prompt_invalid", "APIMart 官方 Grok 提示词必须是 1–8000 个 Unicode 字符");
    if (/@\[node:|<IMAGE_\d+>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(input.prompt))
        throw officialError("reference_token_unresolved", "参考素材引用尚未转换；请使用已连接素材的图片引用或自然语言说明，不能直接发送 @ 或 <IMAGE_n> 标记");
    if (![input.imageCount, input.videoCount, input.audioCount].every((count) => Number.isSafeInteger(count) && count >= 0)) throw officialError("reference_count_invalid", "参考素材数量无效");
    if (input.audioCount) throw officialError("audio_unsupported", "APIMart 官方 Grok 不支持参考音频");
    if (capability.workflow === "video_edit") {
        if (input.imageCount || input.videoCount !== 1) throw officialError("edit_reference_invalid", "Grok 视频编辑需要且仅需要一个源视频，不能混入参考图片");
        return;
    }
    if (input.videoCount) throw officialError("video_unsupported", "Grok 文生/参考图生成不支持参考视频；修改已有视频请选择 Grok 官方视频编辑");
    if (input.imageCount > capability.platformImageLimit) throw officialError("platform_image_limit", `叙光平台当前单次最多处理 ${capability.platformImageLimit} 张参考图；这不是供应商公开上限`);
    if (!capability.resolutions.includes(String(input.resolution))) throw officialError("resolution_unsupported", `当前 Grok 官方模型支持 ${capability.resolutions.join("、")}`);
    if (!capability.ratios.includes(String(input.ratio))) throw officialError("ratio_unsupported", "Grok 官方模型不支持当前宽高比");
    if (!Number.isSafeInteger(input.duration) || Number(input.duration) < 1 || Number(input.duration) > 15) throw officialError("duration_invalid", "Grok 官方生成时长必须为 1–15 秒整数");
}

export function buildApimartGrokOfficialVideoPayload(input: ApimartGrokOfficialVideoRequestInput): Record<string, unknown> {
    validateApimartGrokOfficialVideoRequest({ ...input, imageCount: input.imageUrls.length, videoCount: input.videoUrls.length });
    const capability = apimartGrokOfficialVideoCapabilitiesFor(input.model)!;
    if (input.nsfwCheck === true) throw officialError("moderation_unmetered", "当前尚未接入额外审核费用计量，请勿启用 nsfw_check");
    const common = { model: capability.requestModel, prompt: input.prompt.trim(), ...(typeof input.nsfwCheck === "boolean" ? { nsfw_check: input.nsfwCheck } : {}) };
    if (capability.workflow === "video_edit") {
        // Source must be a local immutable object: the server probes it for trusted billing,
        // then publishes a provider-accessible URL. Never trust a client duration claim.
        if (!/^narralight-object:\/\/sha256\/[a-f0-9]{64}\?mime=video%2F(?:mp4|quicktime)$/i.test(input.videoUrls[0]))
            throw officialError("edit_source_untrusted", "Grok 视频编辑请先导入 MP4/MOV 源视频到叙光素材库，以便服务端验证时长和计量");
        return { ...common, video: { url: input.videoUrls[0] } };
    }
    return { ...common, duration: input.duration, resolution: input.resolution, aspect_ratio: input.ratio, ...(input.imageUrls.length ? { image_urls: input.imageUrls.map(publicHttpsUrl) } : {}) };
}

export type ApimartGrokOfficialPricing = {
    status: "verified" | "blocked" | "pending";
    catalogVersion?: string;
    sourceUrl: string;
    submissionPolicy?: "strict";
    capturedAt?: string;
    expiresAt?: string;
    platformImageLimit: number;
    editSourceRelayAvailable?: boolean;
    models: Record<string, { rates: Record<string, number>; imageMicrousd: number | null; videoMicrousd: number | null }>;
    message?: string;
    code?: string;
};

export function parseApimartGrokOfficialPricing(value: unknown): ApimartGrokOfficialPricing {
    const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const models = record.models && typeof record.models === "object" && !Array.isArray(record.models) ? (record.models as Record<string, unknown>) : undefined;
    const validAmount = (amount: unknown) => typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0;
    let valid =
        ["verified", "blocked", "pending"].includes(String(record.status)) &&
        models &&
        Number.isSafeInteger(record.platformImageLimit) &&
        Number(record.platformImageLimit) > 0 &&
        typeof record.editSourceRelayAvailable === "boolean" &&
        (record.submissionPolicy === undefined || ["strict"].includes(String(record.submissionPolicy))) &&
        record.status !== "pending";
    if (record.status === "verified") {
        valid = Boolean(
            valid &&
            record.sourceUrl === "https://apimart.ai/api/pricing/models/all" &&
            String(record.catalogVersion).startsWith("apimart-grok-official-live-") &&
            Number.isFinite(Date.parse(String(record.expiresAt))) &&
            ["grok-imagine-video", "grok-imagine-video-1.5"].every((name) => {
                const model = models?.[name] as ApimartGrokOfficialPricing["models"][string] | undefined;
                return (
                    model &&
                    model.rates &&
                    ["480p", "720p", ...(name.endsWith("1.5") ? ["1080p"] : [])].every((res) => validAmount(model.rates[res]) && model.rates[res] > 0) &&
                    validAmount(model.imageMicrousd) &&
                    (name.endsWith("1.5") || validAmount(model.videoMicrousd))
                );
            }),
        );
    } else valid = Boolean(valid && Object.keys(models || {}).length === 0 && String(record.code).startsWith("grok_official_") && typeof record.message === "string");
    if (!valid) throw officialError("pricing_contract_invalid", "当前后台没有返回可确认的官方 Grok 合同");
    return value as ApimartGrokOfficialPricing;
}

export async function fetchApimartGrokOfficialPricing(options?: { signal?: AbortSignal }): Promise<ApimartGrokOfficialPricing> {
    const response = await fetch("/api/local/apimart/grok-official/pricing", { signal: options?.signal, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) await throwApiError(response, "Grok 官方价格目录尚未验证，暂不能提交付费任务");
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw officialError("pricing_contract_invalid", "当前后台没有返回官方 Grok JSON 合同");
    return parseApimartGrokOfficialPricing(await response.json());
}

export function apimartGrokOfficialVideoProviderError(value: unknown) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const nested = record.error && typeof record.error === "object" && !Array.isArray(record.error) ? (record.error as Record<string, unknown>) : {};
    const code = String(nested.code ?? record.code ?? "").trim();
    const message = String(nested.message ?? (typeof record.error === "string" ? record.error : undefined) ?? record.message ?? record.fail_reason ?? "供应商未返回具体错误").trim();
    return `Grok 官方视频任务失败${code ? ` [${code}]` : ""}：${message}`;
}

export function publicHttpsUrl(value: string) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            !host.includes(".") ||
            /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
            /\.(localhost|local)$/.test(host)
        )
            throw new Error();
        return url.toString();
    } catch {
        throw officialError("reference_url_invalid", "Grok 官方参考图必须是公网 HTTPS 地址");
    }
}
function officialError(code: string, message: string) {
    return Object.assign(new Error(message), { code: `apimart_grok_official_${code}` });
}
