import { isIP } from "node:net";

const MICROUSD_PER_SECOND = new Map([
    ["480p", 10_200],
    ["720p", 19_120],
]);
const RATIOS = new Set(["16:9", "9:16", "1:1", "3:2", "2:3"]);
const FIELDS = new Set(["model", "prompt", "resolution", "duration", "size", "image_urls"]);

const APIMART_GROK_VIDEO_LOCAL_MODEL_ID = "grok-imagine-1.5-video-apimart";
const APIMART_GROK_VIDEO_REQUEST_MODEL_ID = "grok-imagine-1.5-video-ext";

const fail = (code, message) => Object.assign(new Error(message), { status: 400, code });

export function isApimartGrokVideo(model) {
    const value = String(model || "")
        .split("::")
        .pop()
        ?.toLowerCase();
    return value === APIMART_GROK_VIDEO_LOCAL_MODEL_ID || value === APIMART_GROK_VIDEO_REQUEST_MODEL_ID;
}

export function apimartGrokVideoModelsMatch(storedModel, requestModel) {
    return isApimartGrokVideo(storedModel) && String(requestModel || "").toLowerCase() === APIMART_GROK_VIDEO_REQUEST_MODEL_ID;
}

function apimartGrokVideoInputCounts(payload) {
    return { inputImageCount: Array.isArray(payload?.image_urls) ? payload.image_urls.length : 0, inputVideoCount: 0, inputAudioCount: 0 };
}

export function validateApimartGrokVideoPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("grok_video_payload_invalid", "Grok 1.5 视频请求必须是 JSON 对象");
    const unexpected = Object.keys(payload).find((key) => !FIELDS.has(key));
    if (unexpected) throw fail("grok_video_field_unsupported", `Grok 1.5 视频请求不支持字段 ${unexpected}`);
    if (payload.model !== APIMART_GROK_VIDEO_REQUEST_MODEL_ID) throw fail("grok_video_model_invalid", "Grok 1.5 视频请求必须使用 grok-imagine-1.5-video-ext");
    if (typeof payload.prompt !== "string" || !payload.prompt.trim()) throw fail("grok_video_prompt_invalid", "Grok 1.5 视频提示词不能为空");
    if (/@\[node:[^\]]+\]|<IMAGE_\d+>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(payload.prompt))
        throw fail("grok_video_reference_token_unsupported", "Grok 当前渠道不支持在提示词中用 @ 或 <IMAGE_n> 点名图片");
    const resolution = String(payload.resolution || "");
    if (!MICROUSD_PER_SECOND.has(resolution)) throw fail("grok_video_resolution_unsupported", "Grok 1.5 视频分辨率只能是 480p 或 720p");
    const duration = Number(payload.duration);
    if (!Number.isSafeInteger(duration) || duration < 6 || duration > 15) throw fail("grok_video_duration_invalid", "Grok 1.5 视频时长必须是 6-15 秒整数");
    const images = validateImageUrls(payload.image_urls);
    const size = payload.size === undefined || payload.size === null ? "" : String(payload.size);
    if (images.length && size) throw fail("grok_video_reference_size_forbidden", "Grok 1.5 视频使用参考图时不能发送 size，输出比例跟随参考图");
    if (!images.length && !RATIOS.has(size)) throw fail("grok_video_ratio_unsupported", "Grok 1.5 文生视频必须选择受支持的宽高比");
    return { model: APIMART_GROK_VIDEO_REQUEST_MODEL_ID, resolution, duration, ratio: images.length ? "" : size, ...apimartGrokVideoInputCounts(payload) };
}

function validateImageUrls(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length < 1 || value.length > 7) throw fail("grok_video_reference_array_invalid", "Grok 1.5 视频 image_urls 必须包含 1-7 个地址");
    return value.map((item) => {
        try {
            const url = new URL(item);
            if (url.protocol !== "https:" || url.username || url.password || !url.hostname || isPrivateHostname(url.hostname)) throw new Error();
            return url.toString();
        } catch {
            throw fail("grok_video_reference_url_invalid", "Grok 1.5 视频参考图必须是公网 HTTPS 地址");
        }
    });
}

function isPrivateHostname(hostname) {
    const host = String(hostname || "")
        .toLowerCase()
        .replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (isIP(host) === 4) {
        const [a, b] = host.split(".").map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return (
        isIP(host) === 6 &&
        (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb"))
    );
}
