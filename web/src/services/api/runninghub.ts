import { ChannelModel } from "@/stores/use-config-store";
import { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { ReferenceImage } from "@/types/image";
import axios from "axios";
import { nanoid } from "nanoid";
import { imageToBlob } from "@/services/platform-image-storage";
import { getMediaBlob } from "@/services/platform-file-storage";
import { boolConfig, normalizeResolutionToken, normalizeSeedanceRatio } from "@/lib/seedance-video";
import { RUNNINGHUB_SEEDANCE_25_MODEL_ID, seedanceCapabilitiesFor, seedanceModeConstraints, type SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";
import { normalizeRunningHubGrokSettings, runningHubGrokCapabilitiesFor, runningHubGrokMediaTypeAllowed } from "@/lib/runninghub-grok-video";
import type { AiConfig } from "@/stores/use-config-store";
import { prepareProviderRequest } from "./provider-request";
import { assertModelBackendSupported } from "@/lib/backend-model-contract";

type RunningHubConfig = AiConfig & { provider?: string; modelProfile?: ChannelModel };
type RequestOptions = { signal?: AbortSignal; localTakeId?: string; projectId?: string };

export const RUNNINGHUB_CREATE_PATH = "/bytedance/seedance-2.5-global-token/multimodal-video";
export const RUNNINGHUB_QUERY_PATH = "/query";
export const RUNNINGHUB_UPLOAD_PATH = "/media/upload/binary";

export type RunningHubRequestInput = {
    prompt: string;
    resolution: string;
    ratio: string;
    duration: number;
    generateAudio: boolean;
    watermark: boolean;
    outputFormat: "mp4" | "mov";
    referenceMode: SeedanceReferenceMode;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    videoDurationsMs: Array<number | undefined>;
    audioDurationsMs: Array<number | undefined>;
};

export type RunningHubGrokRequestInput = {
    model: string;
    prompt: string;
    resolution: string;
    ratio: string;
    duration: number;
    imageUrls: string[];
    videoUrls: string[];
    imageBytes: Array<number | undefined>;
    videoBytes: Array<number | undefined>;
    imageMimeTypes: Array<string | undefined>;
    videoMimeTypes: Array<string | undefined>;
    videoDurationsMs: Array<number | undefined>;
};

export function isRunningHubConfig(config: { provider?: string }) {
    return config.provider === "runninghub";
}

export function validateRunningHubRequest(input: RunningHubRequestInput) {
    const capabilities = seedanceCapabilitiesFor(RUNNINGHUB_SEEDANCE_25_MODEL_ID)!;
    const mode = capabilities.modes[input.referenceMode];
    if (!mode?.enabled) throw new Error(mode?.reason || "RunningHub Seedance 2.5 不支持当前生成模式");
    if (!capabilities.resolutions.includes(input.resolution)) throw new Error(`RunningHub Seedance 2.5 不支持 ${input.resolution}`);
    if (!capabilities.ratios.includes(input.ratio)) throw new Error(`RunningHub Seedance 2.5 不支持比例 ${input.ratio}`);
    const constraints = seedanceModeConstraints(capabilities, input.referenceMode);
    if (constraints.forceAdaptiveRatio && input.ratio !== "adaptive") throw new Error("RunningHub 编辑或延长视频时比例必须使用 adaptive");
    if (constraints.forceSmartDuration ? input.duration !== -1 : !Number.isInteger(input.duration) || input.duration < 4 || input.duration > 30)
        throw new Error(constraints.forceSmartDuration ? "RunningHub 视频编辑时长必须使用 -1" : "RunningHub 时长必须是 4-30 秒整数");
    if (input.imageUrls.length > 30 || input.videoUrls.length > 10 || input.audioUrls.length > 10) throw new Error("RunningHub 参考素材数量超过限制");
    validateDurations("视频", input.videoUrls.length, input.videoDurationsMs);
    validateDurations("音频", input.audioUrls.length, input.audioDurationsMs);
    if (input.referenceMode === "text_to_video" && (input.imageUrls.length || input.videoUrls.length || input.audioUrls.length)) throw new Error("文生视频模式不能同时使用参考素材");
    if ((input.referenceMode === "video_edit" || input.referenceMode === "video_extend") && !input.videoUrls.length)
        throw new Error(`${input.referenceMode === "video_edit" ? "视频编辑" : "视频延长"}模式需要参考视频`);
    if (input.referenceMode === "multi_image" && input.imageUrls.length < 2) throw new Error("多图参考模式至少需要 2 张图片");
    if (input.referenceMode === "motion_transfer" && (!input.imageUrls.length || !input.videoUrls.length)) throw new Error("动作模仿模式需要参考图和参考视频");
    if (!capabilities.outputFormats?.includes(input.outputFormat)) throw new Error(`RunningHub 当前只允许 ${capabilities.outputFormats?.join("/") || "mp4"} 输出`);
}

export function buildRunningHubPayload(input: RunningHubRequestInput) {
    validateRunningHubRequest(input);
    const hasReferences = Boolean(input.imageUrls.length || input.videoUrls.length || input.audioUrls.length);
    const taskType = input.referenceMode === "video_edit" ? "edit" : input.referenceMode === "video_extend" ? "extend" : hasReferences ? "reference" : undefined;
    return {
        prompt: input.prompt,
        resolution: input.resolution,
        ratio: input.ratio,
        duration: input.duration,
        generateAudio: input.generateAudio,
        watermark: input.watermark,
        outputFormat: input.outputFormat,
        imageUrls: input.imageUrls,
        videoUrls: input.videoUrls,
        audioUrls: input.audioUrls,
        ...(taskType ? { omniReferenceTaskType: taskType } : {}),
    };
}

export function validateRunningHubGrokRequest(input: RunningHubGrokRequestInput) {
    const capability = runningHubGrokCapabilitiesFor(input.model);
    if (!capability) throw runningHubGrokError("runninghub_grok_model_invalid", "RunningHub Grok 模型不在已确认清单中");
    const prompt = input.prompt.trim();
    const promptLength = Array.from(prompt).length;
    if (promptLength < capability.prompt.min || (capability.prompt.max !== undefined && promptLength > capability.prompt.max)) {
        const range = capability.prompt.max ? `${capability.prompt.min}-${capability.prompt.max}` : `至少 ${capability.prompt.min}`;
        throw runningHubGrokError("runninghub_grok_prompt_invalid", `当前 Grok 工作流提示词必须为 ${range} 个字符`);
    }
    rejectGrokReferencePrompt(prompt);
    if (capability.resolutions.length && !capability.resolutions.includes(input.resolution)) throw runningHubGrokError("runninghub_grok_resolution_invalid", "当前 Grok 工作流不支持所选分辨率");
    if (!capability.resolutions.length && input.resolution) throw runningHubGrokError("runninghub_grok_resolution_forbidden", "当前 Grok 工作流不接受分辨率参数");
    if (capability.ratios.length && !capability.ratios.includes(input.ratio)) throw runningHubGrokError("runninghub_grok_ratio_invalid", "当前 Grok 工作流不支持所选比例");
    if (!capability.ratios.length && input.ratio) throw runningHubGrokError("runninghub_grok_ratio_forbidden", "当前 Grok 工作流的输出比例由输入素材决定");
    if (capability.duration.values) {
        if (!capability.duration.values.includes(input.duration)) throw runningHubGrokError("runninghub_grok_duration_invalid", "Grok 视频续写时长只能是 6 秒或 10 秒");
    } else if (capability.workflow === "video_edit") {
        if (input.duration !== 0) throw runningHubGrokError("runninghub_grok_duration_forbidden", "Grok 视频编辑不接受输出时长参数");
    } else if (!Number.isSafeInteger(input.duration) || input.duration < (capability.duration.min || 0) || input.duration > (capability.duration.max || 0)) {
        throw runningHubGrokError("runninghub_grok_duration_invalid", "当前 Grok 工作流时长必须是 1-15 秒整数");
    }
    const imageRange = capability.workflow === "multi_image" ? [1, capability.references.images] : [capability.references.images, capability.references.images];
    const videoRange = [capability.references.videos, capability.references.videos];
    validateRunningHubGrokReferences("图片", input.imageUrls, input.imageBytes, imageRange[0], imageRange[1], capability.references.imageMaxBytes);
    validateRunningHubGrokReferences("视频", input.videoUrls, input.videoBytes, videoRange[0], videoRange[1], capability.references.videoMaxBytes);
    validateRunningHubGrokMediaTypes("图片", input.imageUrls, input.imageMimeTypes, capability.references.imageMimeTypes);
    validateRunningHubGrokMediaTypes("视频", input.videoUrls, input.videoMimeTypes, capability.references.videoMimeTypes);
    if (input.videoDurationsMs.length !== input.videoUrls.length) throw runningHubGrokError("runninghub_grok_video_metadata_invalid", "RunningHub Grok 参考视频缺少可验证的时长");
    if (
        capability.references.minVideoDurationMs &&
        input.videoDurationsMs.some((value) => !Number.isFinite(value) || Number(value) < capability.references.minVideoDurationMs! || Number(value) > capability.references.maxVideoDurationMs!)
    ) {
        throw runningHubGrokError("runninghub_grok_edit_video_duration_invalid", "Grok 视频编辑只接受 1-8 秒源视频");
    }
}

export function buildRunningHubGrokPayload(input: RunningHubGrokRequestInput): Record<string, unknown> {
    validateRunningHubGrokRequest(input);
    const capability = runningHubGrokCapabilitiesFor(input.model)!;
    const common = { prompt: input.prompt.trim() };
    if (capability.workflow === "text_to_video") return { ...common, duration: input.duration, aspectRatio: input.ratio, resolution: input.resolution };
    if (capability.workflow === "first_frame") return { ...common, imageUrl: input.imageUrls[0], duration: input.duration, resolution: input.resolution };
    if (capability.workflow === "multi_image") return { ...common, referenceImages: input.imageUrls, duration: input.duration, aspectRatio: input.ratio, resolution: input.resolution };
    if (capability.workflow === "video_edit") return { ...common, videoUrl: input.videoUrls[0], resolution: input.resolution };
    return { videoUrl: input.videoUrls[0], ...common, duration: String(input.duration) };
}

export function runningHubCreatePath(model: string | undefined) {
    return runningHubGrokCapabilitiesFor(model)?.createPath || RUNNINGHUB_CREATE_PATH;
}

export async function createRunningHubVideoTask(config: RunningHubConfig, prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], options?: RequestOptions) {
    assertModelBackendSupported(config.modelProfile?.name || config.model);
    const model = config.modelProfile?.name || config.model;
    const grok = runningHubGrokCapabilitiesFor(model);
    if (grok) return createRunningHubGrokVideoTask(config, model, prompt, images, videos, audios, options);
    const capabilities = config.modelProfile?.videoCapabilities || seedanceCapabilitiesFor(RUNNINGHUB_SEEDANCE_25_MODEL_ID)!;
    const referenceMode = (config.videoReferenceMode || "text_to_video") as SeedanceReferenceMode;
    const constraints = seedanceModeConstraints(capabilities, referenceMode);
    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
        Promise.all(images.map((image) => publishImage(config, image, options))),
        Promise.all(videos.map((video) => publishMedia(config, video, "视频", options))),
        Promise.all(audios.map((audio) => publishMedia(config, audio, "音频", options))),
    ]);
    const outputFormat = capabilities.outputFormats?.includes(config.videoOutputFormat) ? config.videoOutputFormat : capabilities.outputFormats?.[0] || "mp4";
    const input: RunningHubRequestInput = {
        prompt,
        resolution: normalizeResolutionToken(config.vquality),
        ratio: normalizeSeedanceRatio(config.size),
        duration: constraints.forceSmartDuration ? -1 : Number(config.videoSeconds),
        generateAudio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
        outputFormat,
        referenceMode,
        imageUrls,
        videoUrls,
        audioUrls,
        videoDurationsMs: videos.map((item) => item.durationMs),
        audioDurationsMs: audios.map((item) => item.durationMs),
    };
    const payload = buildRunningHubPayload(input);
    const requestUrl = runningHubUrl(config, RUNNINGHUB_CREATE_PATH);
    const reservation = await prepareProviderRequest({
        requestUrl,
        requestPayload: payload,
        taskId: options?.localTakeId,
        projectId: options?.projectId,
    });
    const response = (
        await axios.post(requestUrl, payload, {
            headers: { "Content-Type": "application/json", ...(options?.localTakeId ? { "X-Narralight-Video-Take-Id": options.localTakeId } : {}), ...reservation.headers },
            signal: options?.signal,
        })
    ).data;
    const taskId = runningHubTaskId(response);
    if (!taskId) throw new Error("RunningHub 未返回视频任务 ID");
    return taskId;
}

async function createRunningHubGrokVideoTask(
    config: RunningHubConfig,
    model: string,
    prompt: string,
    images: ReferenceImage[],
    videos: ReferenceVideo[],
    audios: ReferenceAudio[],
    options?: RequestOptions,
) {
    const capability = runningHubGrokCapabilitiesFor(model)!;
    if (audios.length) throw runningHubGrokError("runninghub_grok_audio_unsupported", "RunningHub Grok 视频工作流不支持参考音频");
    const minImages = capability.workflow === "multi_image" ? 1 : capability.references.images;
    if (images.length < minImages || images.length > capability.references.images || videos.length !== capability.references.videos)
        throw runningHubGrokError("runninghub_grok_reference_count_invalid", runningHubGrokReferenceHint(capability.workflow));
    const normalized = normalizeRunningHubGrokSettings(model, {
        resolution: normalizeResolutionToken(config.vquality),
        ratio: normalizeSeedanceRatio(config.size),
        duration: Number(config.videoSeconds),
    })!;
    const emptyUrls = {
        model,
        prompt,
        resolution: normalized.resolution,
        ratio: normalized.ratio,
        duration: capability.workflow === "video_edit" ? 0 : normalized.duration,
        imageUrls: images.map(() => "https://pending.invalid/image"),
        videoUrls: videos.map(() => "https://pending.invalid/video"),
        imageBytes: images.map(() => 1),
        videoBytes: videos.map(() => 1),
        imageMimeTypes: images.map((item) => item.mimeType || item.type),
        videoMimeTypes: videos.map((item) => item.type),
        videoDurationsMs: videos.map((item) => item.durationMs),
    };
    validateRunningHubGrokRequest(emptyUrls);
    const [publishedImages, publishedVideos] = await Promise.all([
        Promise.all(images.map((image) => publishGrokImage(config, image, capability.references.imageMaxBytes, options))),
        Promise.all(videos.map((video) => publishGrokVideo(config, video, capability.references.videoMaxBytes, options))),
    ]);
    const input: RunningHubGrokRequestInput = {
        ...emptyUrls,
        imageUrls: publishedImages.map((item) => item.url),
        videoUrls: publishedVideos.map((item) => item.url),
        imageBytes: publishedImages.map((item) => item.bytes),
        videoBytes: publishedVideos.map((item) => item.bytes),
    };
    const payload = buildRunningHubGrokPayload(input);
    const requestUrl = runningHubUrl(config, capability.createPath);
    const reservation = await prepareProviderRequest({ requestUrl, requestPayload: payload, taskId: options?.localTakeId, projectId: options?.projectId });
    const response = (
        await axios.post(requestUrl, payload, {
            headers: { "Content-Type": "application/json", ...(options?.localTakeId ? { "X-Narralight-Video-Take-Id": options.localTakeId } : {}), ...reservation.headers },
            signal: options?.signal,
        })
    ).data;
    const taskId = runningHubTaskId(response);
    if (!taskId) throw new Error("RunningHub 未返回视频任务 ID");
    return taskId;
}

export type RunningHubTaskState =
    { status: "pending" } | { status: "result_pending" } | { status: "completed"; url: string; resultIndex: number; expiresAt: string } | { status: "failed"; error: string };

export async function queryRunningHubVideoTask(config: RunningHubConfig, taskId: string, options?: RequestOptions): Promise<RunningHubTaskState> {
    const response = (await axios.post(runningHubUrl(config, RUNNINGHUB_QUERY_PATH), { taskId }, { headers: { "Content-Type": "application/json" }, signal: options?.signal })).data;
    return runningHubTaskState(response);
}

export function runningHubTaskState(payload: unknown): RunningHubTaskState {
    const task = runningHubRecord(payload);
    const status = String(task.status || "").toUpperCase();
    if (!["QUEUED", "RUNNING", "SUCCESS", "FAILED"].includes(status)) throw runningHubGrokError("runninghub_task_status_invalid", "RunningHub 返回了无法识别的任务状态，已停止自动轮询");
    const results = Array.isArray(task.results) ? task.results : [];
    const video = results.find((item) => {
        if (!item || typeof item !== "object") return false;
        const outputType = String((item as Record<string, unknown>).outputType || "").toLowerCase();
        const url = String((item as Record<string, unknown>).url || "");
        return outputType.startsWith("video") || ["mp4", "mov", "webm"].includes(outputType) || /\.(?:mp4|mov|webm)(?:[?#]|$)/i.test(url);
    }) as Record<string, unknown> | undefined;
    if (status === "SUCCESS" && typeof video?.url === "string")
        return { status: "completed", url: video.url, resultIndex: Math.max(0, results.indexOf(video)), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    if (status === "SUCCESS") return { status: "result_pending" };
    if (status === "FAILED") return { status: "failed", error: String(task.errorMessage || task.errorCode || "RunningHub 视频生成失败") };
    return { status: "pending" };
}

function runningHubRecord(payload: unknown) {
    if (!payload || typeof payload !== "object") return {} as Record<string, unknown>;
    const root = payload as Record<string, unknown>;
    return root.data && typeof root.data === "object" && !Array.isArray(root.data) ? (root.data as Record<string, unknown>) : root;
}

function runningHubTaskId(payload: unknown) {
    const record = runningHubRecord(payload);
    const value = record.taskId;
    return /^\d{10,30}$/.test(String(value ?? "")) ? String(value) : "";
}

async function publishImage(config: RunningHubConfig, image: ReferenceImage, options?: RequestOptions) {
    const direct = image.url || image.dataUrl || "";
    if (isReusablePublicUrl(direct)) return direct;
    const blob = await imageToBlob(image);
    if (!blob) throw new Error("无法读取 RunningHub 参考图");
    return uploadRunningHubMedia(config, blob, image.name || `reference-${nanoid()}.png`, options);
}

async function publishMedia(config: RunningHubConfig, media: ReferenceVideo | ReferenceAudio, kind: string, options?: RequestOptions) {
    if (isReusablePublicUrl(media.url)) return media.url;
    let blob = media.storageKey ? await getMediaBlob(media.storageKey) : null;
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error(`无法读取 RunningHub 参考${kind}`);
    return uploadRunningHubMedia(config, blob, media.name || `reference-${nanoid()}`, options);
}

async function publishGrokImage(config: RunningHubConfig, image: ReferenceImage, maxBytes: number, options?: RequestOptions) {
    const direct = image.url || image.dataUrl || "";
    let blob: Blob | null = null;
    let bytes = image.bytes;
    if (!Number.isFinite(bytes) || Number(bytes) <= 0) {
        blob = await imageToBlob(image);
        bytes = blob?.size;
    }
    assertRunningHubGrokBytes("参考图", bytes, maxBytes);
    if (isReusablePublicUrl(direct)) return { url: direct, bytes: Number(bytes) };
    blob ||= await imageToBlob(image);
    if (!blob) throw new Error("无法读取 RunningHub Grok 参考图");
    return { url: await uploadRunningHubMedia(config, blob, image.name || `reference-${nanoid()}.png`, options), bytes: Number(bytes) };
}

async function publishGrokVideo(config: RunningHubConfig, video: ReferenceVideo, maxBytes: number, options?: RequestOptions) {
    let blob = video.storageKey ? await getMediaBlob(video.storageKey) : null;
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    const bytes = Number.isFinite(video.bytes) && Number(video.bytes) > 0 ? Number(video.bytes) : blob?.size;
    assertRunningHubGrokBytes("源视频", bytes, maxBytes);
    if (isReusablePublicUrl(video.url)) return { url: video.url, bytes: Number(bytes) };
    if (!blob) throw new Error("无法读取 RunningHub Grok 源视频");
    return { url: await uploadRunningHubMedia(config, blob, video.name || `reference-${nanoid()}.mp4`, options), bytes: Number(bytes) };
}

export function parseRunningHubUploadReceipt(payload: unknown, expected?: { type?: string; size?: number }) {
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    if (root.code !== 0) throw runningHubGrokError("runninghub_upload_failed", "RunningHub 素材上传未成功");
    const record = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? (root.data as Record<string, unknown>) : {};
    const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
    const url = typeof record.download_url === "string" ? record.download_url.trim() : "";
    const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
    const sizeText = typeof record.size === "number" ? String(record.size) : typeof record.size === "string" ? record.size.trim() : "";
    const size = /^\d+$/.test(sizeText) ? Number(sizeText) : NaN;
    if (!["image", "video", "audio"].includes(type) || !isReusablePublicUrl(url) || !fileName || !Number.isSafeInteger(size) || size <= 0) {
        throw runningHubGrokError("runninghub_upload_receipt_invalid", "RunningHub 素材上传回执缺少有效的 type、download_url、fileName 或 size");
    }
    if (expected?.type && type !== expected.type) throw runningHubGrokError("runninghub_upload_type_mismatch", "RunningHub 素材上传回执类型与原文件不一致");
    if (expected?.size !== undefined && size !== expected.size) throw runningHubGrokError("runninghub_upload_size_mismatch", "RunningHub 素材上传回执大小与原文件不一致");
    return { type, url, fileName, size };
}

async function uploadRunningHubMedia(config: RunningHubConfig, blob: Blob, name: string, options?: RequestOptions) {
    const body = new FormData();
    body.append("file", new File([blob], name, { type: blob.type || "application/octet-stream" }));
    const response = (await axios.post(runningHubUrl(config, RUNNINGHUB_UPLOAD_PATH), body, { signal: options?.signal })).data;
    const mimeKind = blob.type.split("/", 1)[0].toLowerCase();
    const extensionKind = /\.(?:jpe?g|png|webp)$/i.test(name) ? "image" : /\.(?:mp4|mov|webm)$/i.test(name) ? "video" : /\.(?:mp3|wav)$/i.test(name) ? "audio" : "";
    return parseRunningHubUploadReceipt(response, { type: ["image", "video", "audio"].includes(mimeKind) ? mimeKind : extensionKind || undefined, size: blob.size }).url;
}

function runningHubUrl(config: RunningHubConfig, path: string) {
    return `${config.baseUrl.replace(/\/+$/, "")}${path}`;
}

function isReusablePublicUrl(value: string) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "::1"].includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function validateDurations(kind: string, referenceCount: number, values: Array<number | undefined>) {
    if (values.length !== referenceCount || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 2_000 || value > 30_000))
        throw new Error(`RunningHub 参考${kind}单个时长必须是 2-30 秒`);
    if (values.reduce<number>((total, value) => total + Number(value || 0), 0) > 30_000) throw new Error(`RunningHub 参考${kind}总时长不能超过 30 秒`);
}

function validateRunningHubGrokReferences(kind: string, urls: string[], bytes: Array<number | undefined>, min: number, max: number, maxBytes: number) {
    if (urls.length < min || urls.length > max || bytes.length !== urls.length)
        throw runningHubGrokError("runninghub_grok_reference_count_invalid", `当前 Grok 工作流${kind}数量必须为 ${min === max ? min : `${min}-${max}`}`);
    if (urls.some((value) => !isReusablePublicUrl(value))) throw runningHubGrokError("runninghub_grok_reference_url_invalid", `RunningHub Grok ${kind}必须使用公网素材地址`);
    bytes.forEach((value) => assertRunningHubGrokBytes(kind, value, maxBytes));
}

function validateRunningHubGrokMediaTypes(kind: string, urls: string[], mimeTypes: Array<string | undefined>, allowed: readonly string[]) {
    if (mimeTypes.length !== urls.length) throw runningHubGrokError("runninghub_grok_reference_metadata_invalid", `RunningHub Grok ${kind}缺少可验证的文件格式`);
    if (urls.some((url, index) => !runningHubGrokMediaTypeAllowed(url, mimeTypes[index], allowed)))
        throw runningHubGrokError("runninghub_grok_reference_format_invalid", `RunningHub Grok ${kind}格式不受当前工作流支持`);
}

function assertRunningHubGrokBytes(kind: string, bytes: number | undefined, maxBytes: number) {
    if (!Number.isFinite(bytes) || Number(bytes) <= 0) throw runningHubGrokError("runninghub_grok_reference_size_unknown", `RunningHub Grok ${kind}缺少可验证的文件大小`);
    if (Number(bytes) > maxBytes) throw runningHubGrokError("runninghub_grok_reference_too_large", `RunningHub Grok ${kind}超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);
}

function rejectGrokReferencePrompt(prompt: string) {
    if (/@\[node:[^\]]+\]|<IMAGE_\d+>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(prompt))
        throw runningHubGrokError("runninghub_grok_reference_token_unsupported", "RunningHub Grok 不支持在提示词中用 @ 或 <IMAGE_n> 点名素材；请直接描述画面要求");
}

function runningHubGrokReferenceHint(workflow: string) {
    if (workflow === "text_to_video") return "Grok 1.5 文生视频不接受参考素材";
    if (workflow === "first_frame") return "Grok 1.5 单图生视频必须正好使用 1 张图片";
    if (workflow === "multi_image") return "Grok 1.5 多图参考必须使用 1-7 张图片";
    if (workflow === "video_edit") return "Grok 视频编辑必须正好使用 1 个源视频";
    return "Grok 视频续写必须正好使用 1 个源视频";
}

function runningHubGrokError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}
