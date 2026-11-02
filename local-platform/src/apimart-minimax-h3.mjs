const MICROUSD_PER_SECOND = new Map([
    ["768P", 71_400],
    ["2K", 114_300],
]);

const RATIOS = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]);

export const APIMART_MINIMAX_H3_MODEL_ID = "MiniMax-H3";

const fail = (code, message) => Object.assign(new Error(message), { status: 400, code });

function isApimartMiniMaxH3(model) {
    return String(model || "") === APIMART_MINIMAX_H3_MODEL_ID;
}

function apimartMiniMaxH3InputCounts(payload) {
    const count = (value) => (Array.isArray(value) ? value.length : value === undefined || value === null || value === "" ? 0 : 1);
    return {
        inputImageCount: count(payload?.image_urls) + count(payload?.first_frame_image) + count(payload?.last_frame_image),
        inputVideoCount: count(payload?.video_urls),
        inputAudioCount: count(payload?.audio_urls),
    };
}

export function validateApimartMiniMaxH3Payload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("h3_payload_invalid", "MiniMax H3 请求必须是 JSON 对象");
    if (!isApimartMiniMaxH3(payload.model)) throw fail("h3_model_invalid", "MiniMax H3 请求必须使用 MiniMax-H3 模型 ID");
    const resolution = String(payload.resolution || "");
    if (!MICROUSD_PER_SECOND.has(resolution)) throw fail("h3_resolution_unsupported", "MiniMax H3 分辨率只能是 2K 或 768P");
    const duration = Number(payload.duration);
    if (!Number.isSafeInteger(duration) || duration < 4 || duration > 15) throw fail("h3_duration_invalid", "MiniMax H3 时长必须是 4-15 秒整数");
    const ratio = String(payload.aspect_ratio || "");
    if (!RATIOS.has(ratio)) throw fail("h3_ratio_unsupported", "MiniMax H3 不支持当前宽高比");
    const first = validateUrlField(payload.first_frame_image, "first_frame_image");
    const last = validateUrlField(payload.last_frame_image, "last_frame_image");
    const images = validateUrlArray(payload.image_urls, "image_urls", 9);
    const videos = validateUrlArray(payload.video_urls, "video_urls", 3);
    const audios = validateUrlArray(payload.audio_urls, "audio_urls", 3);
    const frameMode = Boolean(first || last);
    const multimodal = images.length + videos.length + audios.length > 0;
    if (frameMode && multimodal) throw fail("h3_reference_modes_conflict", "MiniMax H3 首尾帧字段不能与多模态参考字段同时使用");
    if (frameMode && ratio !== "adaptive") throw fail("h3_frame_ratio_invalid", "MiniMax H3 首帧、尾帧和首尾帧模式必须使用 adaptive");
    if (!frameMode && !multimodal && ratio === "adaptive") throw fail("h3_text_ratio_required", "MiniMax H3 文生视频必须选择具体宽高比");
    if (audios.length && images.length + videos.length === 0) throw fail("h3_audio_requires_visual", "MiniMax H3 参考音频必须搭配参考图或参考视频");
    return { model: APIMART_MINIMAX_H3_MODEL_ID, resolution, duration, ratio, frameMode, ...apimartMiniMaxH3InputCounts(payload) };
}

function validateUrlField(value, field) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || !value.trim() || value.length > 4096) throw fail("h3_reference_url_invalid", `MiniMax H3 ${field} 无效`);
    return value;
}

function validateUrlArray(value, field, max) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 4096))
        throw fail("h3_reference_array_invalid", `MiniMax H3 ${field} 无效或超过 ${max} 个`);
    return value;
}
