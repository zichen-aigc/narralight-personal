import { createHash } from "node:crypto";
import { isIP } from "node:net";

const GROK_OFFICIAL_BASE = "grok-imagine-video";
const GROK_OFFICIAL_15 = "grok-imagine-video-1.5";
export const GROK_OFFICIAL_BASE_LOCAL = "grok-imagine-video-apimart-official";
export const GROK_OFFICIAL_15_LOCAL = "grok-imagine-video-1.5-apimart-official";
export const GROK_OFFICIAL_EDIT_LOCAL = "grok-imagine-video-edit-apimart-official";
const GROK_OFFICIAL_PRICE_URL = "https://apimart.ai/api/pricing/models/all";
const GROK_OFFICIAL_PRICE_PREFIX = "apimart-grok-official-live-";

// Platform operation safeguards, not provider limits (the public contract does not give an image count limit).
export const GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT = 30;
export const GROK_OFFICIAL_PLATFORM_EDIT_MAX_MS = 30_000;
const GROK_OFFICIAL_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const localModels = new Map([
    [GROK_OFFICIAL_BASE_LOCAL, GROK_OFFICIAL_BASE],
    [GROK_OFFICIAL_15_LOCAL, GROK_OFFICIAL_15],
    [GROK_OFFICIAL_EDIT_LOCAL, GROK_OFFICIAL_BASE],
]);
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const localVideoPattern = /^narralight-object:\/\/sha256\/([a-f0-9]{64})\?mime=video%2F(mp4|quicktime)$/i;

export function grokOfficialRequestModel(value) {
    const model = String(value || "")
        .split("::")
        .pop();
    return localModels.get(model) || ([GROK_OFFICIAL_BASE, GROK_OFFICIAL_15].includes(model) ? model : "");
}

export function isGrokOfficialModel(value) {
    return Boolean(grokOfficialRequestModel(value));
}
export function isGrokOfficialEditModel(value) {
    return (
        String(value || "")
            .split("::")
            .pop() === GROK_OFFICIAL_EDIT_LOCAL
    );
}
export function grokOfficialModelsMatch(stored, request, payload) {
    return (
        grokOfficialRequestModel(stored) === request &&
        isGrokOfficialModel(stored) &&
        (String(stored).split("::").pop() === GROK_OFFICIAL_BASE ? true : isGrokOfficialEditModel(stored) === Boolean(payload?.video))
    );
}
export function grokOfficialLocalVideo(value) {
    const match = localVideoPattern.exec(String(value || ""));
    return match ? { hash: match[1].toLowerCase(), mimeType: match[2].toLowerCase() === "mp4" ? "video/mp4" : "video/quicktime" } : null;
}

function publicHttps(value) {
    try {
        if (typeof value !== "string") throw new Error();
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        const parts = host.split(".").map(Number);
        const privateV4 =
            isIP(host) === 4 &&
            (parts[0] === 0 ||
                parts[0] === 10 ||
                parts[0] === 127 ||
                (parts[0] === 169 && parts[1] === 254) ||
                (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
                (parts[0] === 192 && parts[1] === 168));
        const privateV6 = isIP(host) === 6 && (host === "::" || host === "::1" || /^(?:fc|fd|fe[89ab])/.test(host) || host.startsWith("::ffff:"));
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            !host ||
            host === "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            (!isIP(host) && !host.includes(".")) ||
            privateV4 ||
            privateV6
        )
            throw new Error();
        return value;
    } catch {
        throw fail("grok_official_reference_url_invalid", "Grok 官方素材必须使用公网 HTTPS 地址");
    }
}

export function grokOfficialInputCounts(payload) {
    return { inputImageCount: Array.isArray(payload?.image_urls) ? payload.image_urls.length : 0, inputVideoCount: payload?.video ? 1 : 0, inputAudioCount: 0 };
}

export function validateGrokOfficialPayload(payload, { allowLocalVideo = false } = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("grok_official_payload_invalid", "Grok 官方请求必须为 JSON 对象");
    if (![GROK_OFFICIAL_BASE, GROK_OFFICIAL_15].includes(payload.model)) throw fail("grok_official_model_invalid", "Grok 官方模型名称无效");
    const edit = Object.hasOwn(payload, "video");
    const allowed = edit ? ["model", "prompt", "nsfw_check", "video"] : ["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "image_urls"];
    if (Object.keys(payload).some((key) => !allowed.includes(key))) throw fail("grok_official_field_unsupported", "Grok 官方请求包含当前模式不支持的字段");
    if (typeof payload.prompt !== "string" || !payload.prompt.trim() || Array.from(payload.prompt.trim()).length > 8000)
        throw fail("grok_official_prompt_invalid", "Grok 官方提示词必须为 1–8000 个 Unicode 字符");
    if (/@\[node:|<IMAGE_[^>]*>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(payload.prompt))
        throw fail("grok_official_reference_token_unsupported", "Grok 官方请求不得包含内部引用或未经确认的素材标签");
    if (payload.nsfw_check !== undefined && payload.nsfw_check !== false) throw fail("grok_official_moderation_unmetered", "当前尚未接入审核额外计量，请关闭额外审核");
    if (edit) {
        if (payload.model !== GROK_OFFICIAL_BASE) throw fail("grok_official_edit_unsupported", "Grok 官方 1.5 不支持视频编辑");
        if (!payload.video || typeof payload.video !== "object" || Array.isArray(payload.video) || Object.keys(payload.video).length !== 1 || typeof payload.video.url !== "string")
            throw fail("grok_official_edit_video_invalid", "Grok 官方编辑需要一个 video.url 源视频");
        if (!(allowLocalVideo && grokOfficialLocalVideo(payload.video.url))) publicHttps(payload.video.url);
        return { model: payload.model, mode: "video_edit", resolution: "720p", duration: null, ratio: "", ...grokOfficialInputCounts(payload) };
    }
    const duration = payload.duration ?? 8;
    const resolution = payload.resolution ?? "480p";
    const ratio = payload.aspect_ratio ?? "auto";
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 15) throw fail("grok_official_duration_invalid", "Grok 官方生成时长必须为 1–15 秒整数");
    if (!(payload.model === GROK_OFFICIAL_15 ? ["480p", "720p", "1080p"] : ["480p", "720p"]).includes(resolution)) throw fail("grok_official_resolution_invalid", "Grok 官方当前模型不支持所选分辨率");
    if (!GROK_OFFICIAL_RATIOS.includes(ratio)) throw fail("grok_official_ratio_invalid", "Grok 官方宽高比无效");
    if (payload.image_urls !== undefined) {
        if (!Array.isArray(payload.image_urls) || !payload.image_urls.length || payload.image_urls.length > GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT)
            throw fail("grok_official_image_count_invalid", `参考图须为 1–${GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT} 张（叙光操作保护上限，非供应商上限）`);
        payload.image_urls.forEach(publicHttps);
    }
    return { model: payload.model, mode: payload.image_urls ? "multi_image" : "text_to_video", duration, resolution, ratio, ...grokOfficialInputCounts(payload) };
}

function parseGrokOfficialCatalog(payload, capturedAt = Date.now()) {
    const rows = payload?.data?.models?.video;
    if (payload?.success !== true || !Array.isArray(rows)) throw fail("grok_official_pricing_invalid", "Grok 官方实时价格目录结构无效", 503);
    const models = {};
    for (const model of [GROK_OFFICIAL_BASE, GROK_OFFICIAL_15]) {
        const matches = rows.filter((row) => row.id === model);
        if (matches.length !== 1) continue;
        const row = matches[0];
        if (row.billing_type !== "per_second" || row.fixed_prices?.unit !== "usd_per_second" || row.fixed_prices?.dimension !== "resolution" || !Array.isArray(row.fixed_prices.items)) continue;
        const rates = {};
        for (const resolution of model === GROK_OFFICIAL_15 ? ["480p", "720p", "1080p"] : ["480p", "720p"]) {
            const items = row.fixed_prices.items.filter((item) => String(item.key).toLowerCase() === resolution);
            if (items.length === 1 && Number.isFinite(items[0].after_discount) && items[0].after_discount > 0) rates[resolution] = Math.ceil(items[0].after_discount * 1_000_000);
        }
        const material = (kind, unit) =>
            row.input_material_prices?.[kind]?.unit === unit && Number.isFinite(row.input_material_prices[kind].after_discount) && row.input_material_prices[kind].after_discount >= 0
                ? Math.ceil(row.input_material_prices[kind].after_discount * 1_000_000)
                : null;
        models[model] = { rates, imageMicrousd: material("image", "usd_per_image"), videoMicrousd: material("video", "usd_per_second") };
    }
    for (const model of [GROK_OFFICIAL_BASE, GROK_OFFICIAL_15]) {
        const price = models[model];
        const resolutions = model === GROK_OFFICIAL_15 ? ["480p", "720p", "1080p"] : ["480p", "720p"];
        if (!price || resolutions.some((resolution) => !price.rates[resolution]) || price.imageMicrousd === null || (model === GROK_OFFICIAL_BASE && price.videoMicrousd === null))
            throw fail("grok_official_price_missing", "Grok 官方实时目录缺少型号、规格或素材价格", 503);
    }
    const version = createHash("sha256").update(JSON.stringify(models)).digest("hex").slice(0, 20);
    return { catalogVersion: `${GROK_OFFICIAL_PRICE_PREFIX}${version}`, sourceUrl: GROK_OFFICIAL_PRICE_URL, capturedAt: new Date(capturedAt).toISOString(), models };
}

export function quoteGrokOfficial(payload, catalog, exchangeRateMicrormbPerUnit, sourceDurationMs = 0, now = Date.now(), maxAgeMs = 600_000) {
    if (!catalog || now - Date.parse(catalog.capturedAt) > maxAgeMs || Date.parse(catalog.capturedAt) > now) throw fail("grok_official_pricing_stale", "Grok 官方实时价格待验证，已阻止付费提交", 503);
    if (!Number.isSafeInteger(exchangeRateMicrormbPerUnit) || exchangeRateMicrormbPerUnit <= 0) throw fail("grok_official_fx_missing", "Grok 官方计价缺少已配置 USD/CNY 汇率", 409);
    const model = grokOfficialRequestModel(payload?.model);
    const edit = Boolean(payload?.video);
    const resolution = edit ? "720p" : (payload.resolution ?? "480p");
    const duration = edit ? sourceDurationMs / 1000 : (payload.duration ?? 8);
    const counts = grokOfficialInputCounts(payload);
    if (
        !model ||
        counts.inputImageCount > GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT ||
        (edit && model !== GROK_OFFICIAL_BASE) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        (edit && sourceDurationMs > GROK_OFFICIAL_PLATFORM_EDIT_MAX_MS) ||
        (!edit && (!Number.isSafeInteger(duration) || duration > 15))
    )
        throw fail("grok_official_quote_contract_invalid", "Grok 官方请求计量合同无效");
    const price = catalog.models[model];
    const rate = price?.rates?.[resolution];
    if (!rate || (counts.inputImageCount && price.imageMicrousd === null) || (edit && price.videoMicrousd === null))
        throw fail("grok_official_price_missing", "当前 Grok 官方模型/素材规格没有经过验证的实时价格", 503);
    const estimatedSupplierCostMicrounits = Math.ceil(duration * rate + counts.inputImageCount * (price.imageMicrousd || 0) + (edit ? duration * price.videoMicrousd : 0));
    const estimatedCostMicrormb = Math.ceil((estimatedSupplierCostMicrounits * exchangeRateMicrormbPerUnit) / 1_000_000);
    if (!Number.isSafeInteger(estimatedSupplierCostMicrounits) || !Number.isSafeInteger(estimatedCostMicrormb)) throw fail("grok_official_cost_overflow", "Grok 官方计价超出安全范围");
    const billingVariant = `${model}.${edit ? "video_edit" : counts.inputImageCount ? "multi_image" : "text_to_video"}.${resolution}`;
    return {
        catalogVersion: catalog.catalogVersion,
        model,
        ...counts,
        inputVideoDurationMs: edit ? sourceDurationMs : 0,
        duration,
        resolution,
        currency: "USD",
        billingUnit: "second",
        unitPriceMicrounits: rate,
        estimatedQuantityMicrounits: Math.ceil(duration * 1_000_000),
        estimatedSupplierCostMicrounits,
        exchangeRateMicrormbPerUnit,
        estimatedCostMicrormb,
        billingVariant,
        costQuality: "calculated",
        pricingSnapshot: {
            provider: "apimart",
            model,
            catalogVersion: catalog.catalogVersion,
            sourceUrl: catalog.sourceUrl,
            capturedAt: catalog.capturedAt,
            billingVariant,
            outputResolution: resolution,
            outputDurationMs: Math.ceil(duration * 1000),
            ...counts,
            inputVideoDurationMs: edit ? sourceDurationMs : 0,
            imageMicrousd: price.imageMicrousd,
            videoMicrousd: edit ? price.videoMicrousd : 0,
            unitPriceMicrounits: rate,
            exchangeRateMicrormbPerUnit,
        },
    };
}

// A zero reservation is a deferred estimate, never a claim that generation is free.
// Stable admission evidence avoids a refreshed catalog invalidating an in-flight Take.

export function createGrokOfficialPricing({
    fetchCatalog = async () => {
        const response = await fetch(GROK_OFFICIAL_PRICE_URL, { signal: AbortSignal.timeout(15_000), redirect: "error" });
        if (!response.ok) throw new Error("catalog unavailable");
        return response.json();
    },
    now = Date.now,
    maxAgeMs = 600_000,
} = {}) {
    let catalog = null;
    let pending = null;
    return {
        peek() {
            return catalog && now() - Date.parse(catalog.capturedAt) >= 0 && now() - Date.parse(catalog.capturedAt) < maxAgeMs ? catalog : null;
        },
        async get() {
            if (catalog && now() - Date.parse(catalog.capturedAt) < maxAgeMs) return catalog;
            if (!pending)
                pending = Promise.resolve()
                    .then(fetchCatalog)
                    .then((value) => {
                        catalog = parseGrokOfficialCatalog(value, now());
                        return catalog;
                    })
                    .catch(() => {
                        catalog = null;
                        throw fail("grok_official_pricing_unavailable", "Grok 官方实时价格待验证，已阻止付费提交", 503);
                    })
                    .finally(() => {
                        pending = null;
                    });
            return pending;
        },
        maxAgeMs,
    };
}
