// Server-owned pilot contract. Public prices are a captured estimate, not an account entitlement.
export const API888_PROVIDER = "888api";
export const API888_CHANNEL_ID = "888api";
export const API888_BASE_URL = "https://888api.xin";
export const API888_CREDENTIAL_TARGET = "888API_API_KEY";
export const API888_PRICE_VERSION = "888api-public-a42d372ccf0b5dd13ecf71203521f9d2-2026-10-24-v2";
export const API888_PRICE_SOURCE = "https://888api.xin/api/pricing";
export const API888_IMAGE_SIZES = Object.freeze(["1024x1024", "1536x864", "864x1536", "2048x2048", "2048x1152", "1152x2048", "2880x2880", "3840x2160", "2160x3840"]);

const MODELS = Object.freeze({
    "gpt-image-2": Object.freeze({ kind: "image", operations: ["image.generate"], billingUnit: "generation", unitPriceMicrormb: 50_000, maxImages: 0, maxVideos: 0, maxAudios: 0 }),
    "wan3.0-video": Object.freeze({
        kind: "video",
        operations: ["video.text", "video.image", "video.reference"],
        billingUnit: "second",
        unitPriceMicrormb: 220_000,
        minSeconds: 2,
        maxSeconds: 30,
        maxImages: 10,
        maxVideos: 1,
        maxAudios: 0,
    }),
    "seedance2.0-933-economy": Object.freeze({
        kind: "video",
        operations: ["video.text", "video.image", "video.reference"],
        billingUnit: "generation",
        unitPriceMicrormb: 5_000_000,
        minSeconds: 15,
        maxSeconds: 15,
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
    }),
});

const failure = (code, message) => Object.assign(new Error(message), { status: 409, code });
const integer = (value) => typeof value === "number" && Number.isSafeInteger(value);
const isPublicUrl = (value) => {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.hash;
    } catch {
        return false;
    }
};
const LOCAL_OBJECT = /^narralight-object:\/\/sha256\/([a-f0-9]{64})\?mime=(image%2F(?:jpeg|png|webp)|video%2F(?:mp4|quicktime)|audio%2F(?:wav|mpeg))$/i;
export function api888LocalObject(value) {
    const match = typeof value === "string" ? LOCAL_OBJECT.exec(value) : null;
    return match ? { hash: match[1].toLowerCase(), mimeType: decodeURIComponent(match[2]).toLowerCase() } : null;
}

export function api888Models() {
    return Object.entries(MODELS).map(([modelId, entry]) => ({ modelId, ...entry, operations: [...entry.operations], priceVersion: API888_PRICE_VERSION, priceSource: API888_PRICE_SOURCE }));
}

export function validate888ApiRequest(payload, operation, options = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw failure("api888_payload_invalid", "888API 请求必须是 JSON 对象");
    const model = MODELS[payload.model];
    if (!model) throw failure("api888_model_unpriced", "888API 型号未完成能力与价格核验");
    if (operation !== (model.kind === "image" ? "image.generate" : "video.generate")) throw failure("api888_operation_unsupported", "888API 型号与请求操作不匹配");
    if (typeof payload.prompt !== "string" || !payload.prompt.trim() || payload.prompt.length > 20_000) throw failure("api888_prompt_invalid", "888API 提示词为空或过长");
    const allowed = model.kind === "image" ? new Set(["model", "prompt", "n", "size"]) : new Set(["model", "prompt", "duration", "seconds", "ratio", "images", "videos", "audios"]);
    if (Object.keys(payload).some((key) => !allowed.has(key))) throw failure("api888_parameter_unverified", "888API 请求含未经验证的参数");
    if (model.kind === "image") {
        if (payload.n !== 1 || !API888_IMAGE_SIZES.includes(payload.size)) throw failure("api888_image_spec_unpriced", "888API 图片仅支持每次 1 张及已核价的九种尺寸");
        return {
            modelId: payload.model,
            operation,
            billingUnit: model.billingUnit,
            unitPriceMicrormb: model.unitPriceMicrormb,
            quantity: 1,
            inputImageCount: 0,
            inputVideoCount: 0,
            inputAudioCount: 0,
        };
    }
    const seconds = model.billingUnit === "second" ? payload.seconds : payload.duration;
    if (!integer(seconds) || seconds < model.minSeconds || seconds > model.maxSeconds || (model.billingUnit === "second" ? payload.duration !== undefined : payload.seconds !== undefined))
        throw failure("api888_duration_invalid", "888API 时长字段或范围与该型号计价不符");
    const ratios = payload.model === "wan3.0-video" ? ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] : ["16:9", "9:16", "1:1"];
    if (payload.ratio !== undefined && !ratios.includes(payload.ratio)) throw failure("api888_ratio_invalid", "888API 画幅比例不支持");
    const counts = {};
    for (const [key, max] of [
        ["images", model.maxImages],
        ["videos", model.maxVideos],
        ["audios", model.maxAudios],
    ]) {
        const values = payload[key] ?? [];
        if (!Array.isArray(values) || values.length > max || values.some((value) => !(options.allowLocalObjects && api888LocalObject(value)) && !(options.allowRelayedUrls && isPublicUrl(value))))
            throw failure("api888_reference_invalid", `888API ${key} 参考素材必须是已保存的叙光对象`);
        counts[key] = values.length;
    }
    if (payload.audios?.length && !counts.images && !counts.videos) throw failure("api888_audio_context_required", "音频参考需要同时提供图片或视频参考");
    return {
        modelId: payload.model,
        operation,
        billingUnit: model.billingUnit,
        unitPriceMicrormb: model.unitPriceMicrormb,
        quantity: model.billingUnit === "second" ? seconds : 1,
        seconds,
        inputImageCount: counts.images,
        inputVideoCount: counts.videos,
        inputAudioCount: counts.audios,
    };
}

export function api888VideoResult(payload, expectedTaskId) {
    if (!["completed", "succeeded", "success"].includes(String(payload?.status || "").toLowerCase())) return null;
    const ids = [payload?.id, payload?.task_id].filter((value) => value !== undefined && value !== null).map(String);
    if (!ids.length || ids.some((id) => id !== expectedTaskId)) throw failure("api888_task_identity_mismatch", "888API 结果任务 ID 与本地记录不一致");
    const value = payload.url ?? payload.video_url ?? payload.result_url ?? payload.task_result?.videos?.[0]?.url;
    const ownContent = `${API888_BASE_URL}/v1/videos/${encodeURIComponent(expectedTaskId)}/content`;
    if (value !== undefined && value !== null) {
        if (!isPublicUrl(value)) throw failure("api888_result_url_invalid", "888API 完成结果地址无效");
        const url = new URL(value);
        if (url.hostname === "888api.xin" && url.pathname.startsWith("/v1/videos/") && url.pathname !== `/v1/videos/${encodeURIComponent(expectedTaskId)}/content`)
            throw failure("api888_result_task_mismatch", "888API 下载地址不属于原任务");
    }
    // Use the provider's task-bound content endpoint. Its authenticated 302 is
    // followed only after each redirect target passes the server's public-host check.
    return { url: ownContent, resultIndex: 0 };
}
