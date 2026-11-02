import { ReferenceImage } from "@/types/image";
import { GROK_APIMART_VIDEO_CAPABILITIES, GROK_APIMART_VIDEO_REQUEST_MODEL_ID, isGrokApimartVideoModel } from "@/lib/grok-apimart-video";

const APIMART_GROK_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export type GrokApimartVideoRequestInput = {
    model: string;
    prompt: string;
    resolution: string;
    size: string;
    duration: number;
    imageUrls: string[];
    videoCount: number;
    audioCount: number;
};

export type GrokApimartVideoRequestCounts = Omit<GrokApimartVideoRequestInput, "imageUrls"> & { imageCount: number };

export function validateGrokApimartVideoRequest(input: GrokApimartVideoRequestCounts) {
    const capabilities = GROK_APIMART_VIDEO_CAPABILITIES;
    if (!isGrokApimartVideoModel(input.model)) throw grokError("grok_video_model_invalid", "Grok 1.5 视频请求模型无效");
    if (typeof input.prompt !== "string" || !input.prompt.trim()) throw grokError("grok_video_prompt_invalid", "Grok 1.5 视频提示词不能为空");
    assertPlainGrokVideoPrompt(input.prompt);
    if (!capabilities.resolutions.includes(input.resolution as never)) throw grokError("grok_video_resolution_unsupported", "Grok 1.5 视频分辨率只能是 480p 或 720p");
    if (!capabilities.ratios.includes(input.size as never)) throw grokError("grok_video_ratio_unsupported", "Grok 1.5 视频不支持当前宽高比");
    if (!Number.isSafeInteger(input.duration) || input.duration < capabilities.duration.min || input.duration > capabilities.duration.max)
        throw grokError("grok_video_duration_invalid", "Grok 1.5 视频时长必须是 6-15 秒整数");
    if (!Number.isSafeInteger(input.imageCount) || input.imageCount < 0 || input.imageCount > capabilities.references.images)
        throw grokError("grok_video_image_count_invalid", "Grok 1.5 视频参考图最多 7 张");
    if (input.videoCount) throw grokError("grok_video_reference_video_unsupported", "Grok 1.5 视频不支持参考视频");
    if (input.audioCount) throw grokError("grok_video_reference_audio_unsupported", "Grok 1.5 视频不支持参考音频");
}

export function buildGrokApimartVideoPayload(input: GrokApimartVideoRequestInput) {
    validateGrokApimartVideoRequest({ ...input, imageCount: input.imageUrls.length });
    const imageUrls = input.imageUrls.map((value) => publicHttpsUrl(value));
    return {
        model: GROK_APIMART_VIDEO_REQUEST_MODEL_ID,
        prompt: compileGrokApimartVideoPrompt(input.prompt, imageUrls.length),
        resolution: input.resolution,
        duration: input.duration,
        ...(imageUrls.length ? {} : { size: input.size }),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    };
}

export function compileGrokApimartVideoPrompt(prompt: string, _imageCount: number) {
    const text = prompt.trim();
    assertPlainGrokVideoPrompt(text);
    return text;
}

export function assertPlainGrokVideoPrompt(prompt: string) {
    if (/@\[node:[^\]]+\]|<IMAGE_\d+>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(prompt))
        throw grokError("grok_video_reference_token_unsupported", "Grok 当前渠道不支持在提示词中用 @ 或 <IMAGE_n> 点名图片；请直接描述整体画面要求");
}

export function validateGrokApimartReferenceImages(references: ReferenceImage[]) {
    if (references.length > GROK_APIMART_VIDEO_CAPABILITIES.references.images) throw grokError("grok_video_image_count_invalid", "Grok 1.5 视频参考图最多 7 张");
    const ratios: number[] = [];
    references.forEach((image) => {
        const mimeType = String(image.mimeType || image.type || "").toLowerCase();
        if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) throw grokError("grok_video_reference_format_invalid", "APIMart Grok 参考图只支持 JPEG、PNG、WebP 或 GIF");
        if (!Number.isFinite(image.bytes) || Number(image.bytes) <= 0) throw grokError("grok_video_reference_size_unknown", "APIMart Grok 参考图缺少可验证的文件大小");
        if (Number(image.bytes) > APIMART_GROK_IMAGE_MAX_BYTES) throw grokError("grok_video_reference_too_large", "APIMart Grok 单张参考图不得超过 20 MB");
        if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || Number(image.width) <= 0 || Number(image.height) <= 0)
            throw grokError("grok_video_reference_dimensions_unknown", "APIMart Grok 参考图缺少可验证的宽高");
        ratios.push(Number(image.width) / Number(image.height));
    });
    if (ratios.length > 1 && ratios.some((ratio) => Math.abs(ratio / ratios[0] - 1) > 0.01))
        throw grokError("grok_video_reference_ratio_mismatch", "APIMart Grok 多张参考图必须保持相同比例（允许 1% 像素取整误差）");
}

export function grokApimartVideoProviderError(value: unknown) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const nested = record.error && typeof record.error === "object" && !Array.isArray(record.error) ? (record.error as Record<string, unknown>) : {};
    const code = String(nested.code ?? record.code ?? "").trim();
    const message = String(nested.message ?? record.message ?? record.fail_reason ?? "").trim();
    if (code && message) return `Grok 1.5 视频生成失败 [${code}]：${message}`;
    if (message) return `Grok 1.5 视频生成失败：${message}`;
    if (code) return `Grok 1.5 视频生成失败 [${code}]`;
    return "Grok 1.5 视频生成失败";
}

function publicHttpsUrl(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) throw new Error();
        return url.toString();
    } catch {
        throw grokError("grok_video_reference_url_invalid", "Grok 1.5 视频参考图必须是公网 HTTPS 地址");
    }
}

function grokError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}
