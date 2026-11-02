import { type ApimartNormalizedResult } from "./apimart-results";
import { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { ReferenceImage } from "@/types/image";
import { type ChannelModel } from "@/stores/use-config-store";
import axios from "axios";
import { nanoid } from "nanoid";
import { imageToBlob } from "@/services/platform-image-storage";
import { getMediaBlob, uploadMediaFile } from "@/services/platform-file-storage";
import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import { isGrokApimartVideoModel, normalizeGrokApimartVideoSettings } from "@/lib/grok-apimart-video";
import { apimartGrokOfficialVideoCapabilitiesFor, isApimartGrokOfficialVideoModel, normalizeApimartGrokOfficialVideoSettings } from "@/lib/apimart-grok-official-video";
import { assertModelBackendSupported } from "@/lib/backend-model-contract";
import { isMiniMaxH3Model, normalizeMiniMaxH3Settings, type MiniMaxH3ReferenceMode } from "@/lib/minimax-h3-capabilities";
import { seedanceCapabilitiesFor, type SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";
import { buildMiniMaxH3Payload, miniMaxH3ProviderError, validateMiniMaxH3Request } from "./apimart-minimax-h3";
import { buildGrokApimartVideoPayload, grokApimartVideoProviderError, validateGrokApimartReferenceImages, validateGrokApimartVideoRequest } from "./apimart-grok-video";
import { apimartGrokOfficialVideoProviderError, buildApimartGrokOfficialVideoPayload, validateApimartGrokOfficialVideoRequest, publicHttpsUrl } from "./apimart-grok-official-video";
import { buildSeedanceApimartPayload, validateSeedanceApimartRequest } from "./apimart-video-request";
import { apimartTaskRecord, describeApimartTask, normalizeApimartMediaResults, type ApimartTaskRecord } from "./apimart-results";
import { prepareProviderRequest } from "./provider-request";
import { localApiError } from "@/services/api-error";

type ApimartConfig = AiConfig & { provider?: string; modelProfile?: ChannelModel };
type RequestOptions = { signal?: AbortSignal; localTakeId?: string; projectId?: string };
export type ApimartImageResult = { id: string; dataUrl: string; remoteUrl: string; upstreamTaskId?: string; remoteExpiresAt?: string; resultIndex: number };

const APIMART_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const APIMART_IMAGE_POLL_INTERVAL_MS = 5_000;
const APIMART_IMAGE_POLL_ATTEMPTS = 60;
const APIMART_SUCCESS_STATUSES = new Set(["completed", "success", "succeeded"]);
const APIMART_FAILURE_STATUSES = new Set(["failed", "error", "cancelled", "canceled", "expired"]);
const SEEDREAM_5_PRO_MODELS = new Set(["doubao-seedream-5-0-pro", "seedream-5-0-pro", "seedream-5.0-pro"]);
const SEEDREAM_5_LITE_MODELS = new Set(["doubao-seedream-5-0-lite", "seedream-5-0-lite", "seedream-5.0-lite"]);
const SEEDREAM_5_PRO_SIZES = new Set(["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "2:1", "1:2", "21:9"]);

export function isApimartConfig(config: { provider?: string }) {
    return config.provider === "apimart";
}

export async function requestApimartImages(config: ApimartConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const parameters = new Set(config.modelProfile?.parameters || []);
    const maxReferences = config.modelProfile?.maxReferences ?? 0;
    if (references.length && (!parameters.has("references") || maxReferences === 0)) throw new Error(`${config.model} 不支持参考图`);
    const imageUrls = await Promise.all(references.slice(0, maxReferences || references.length).map((image) => publishApimartReference(config, image, options)));
    const requestModel = normalizeApimartImageModel(config.model);
    const seedream5Pro = SEEDREAM_5_PRO_MODELS.has(config.model);
    const requestSize = normalizeApimartImageSize(config.model, config.size);
    const resolution = apimartResolution(config.model, config.quality);
    const payload: Record<string, unknown> = {
        model: requestModel,
        prompt,
        ...(parameters.has("count") && !seedream5Pro ? { n: Math.max(1, Math.floor(count || 1)) } : {}),
        ...(parameters.has("size") && requestSize ? { size: requestSize } : {}),
        ...(resolution ? { resolution } : {}),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    };
    const requestUrl = buildApiUrl(config.baseUrl, "/images/generations");
    const reservation = await prepareProviderRequest({
        requestUrl,
        requestPayload: payload,
        projectId: options?.projectId,
    });
    const created = (await axios.post(requestUrl, payload, { headers: { "Content-Type": "application/json", ...reservation.headers }, signal: options?.signal })).data;
    const taskId = taskIdFromResponse(created);
    const immediate = normalizeApimartMediaResults(created, "image");
    if (immediate.length) return toImageResults(immediate, taskId);
    if (!taskId) {
        const task = apimartTaskRecord(created);
        const status = String(task.status || "unknown").toLowerCase();
        throw localApiError("apimart_image_task_id_missing", `APIMart 未返回图像任务 ID｜状态 ${status}${providerRequestIdPart(created)}`);
    }
    let lastStatus = "submitted";
    let lastRequestId = "";
    for (let attempt = 0; attempt < APIMART_IMAGE_POLL_ATTEMPTS; attempt += 1) {
        await wait(APIMART_IMAGE_POLL_INTERVAL_MS, options?.signal);
        const response = (await axios.get(buildApiUrl(config.baseUrl, `/tasks/${encodeURIComponent(taskId)}`), { signal: options?.signal })).data;
        const task = apimartTaskRecord(response);
        const status = String(task.status || "").toLowerCase();
        lastStatus = status || "unknown";
        lastRequestId = providerRequestId(response);
        const images = normalizeApimartMediaResults(response, "image");
        if (APIMART_SUCCESS_STATUSES.has(status) && images.length) return toImageResults(images, taskId);
        if (APIMART_FAILURE_STATUSES.has(status)) throw taskFailureError(task, taskId, status, "图像", response);
    }
    throw localApiError("apimart_image_timeout", `APIMart 图像生成等待超时｜状态 ${lastStatus}｜任务 ${taskId}｜已等待 300 秒${lastRequestId ? `｜供应商 Request ID ${lastRequestId}` : ""}`);
}

export async function createApimartVideoTask(
    config: ApimartConfig,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
) {
    const parameters = new Set(config.modelProfile?.parameters || []);
    const maxReferences = config.modelProfile?.maxReferences ?? 0;
    const model = config.modelProfile?.name || config.model;
    assertModelBackendSupported(model);
    if (isApimartGrokOfficialVideoModel(model)) {
        const normalized = normalizeApimartGrokOfficialVideoSettings(model, { resolution: config.vquality, ratio: config.size, duration: Number(config.videoSeconds) })!;
        const requestInput = { model, prompt, resolution: normalized.resolution, ratio: normalized.ratio, duration: normalized.duration, audioCount: audioReferences.length };
        validateApimartGrokOfficialVideoRequest({ ...requestInput, imageCount: references.length, videoCount: videoReferences.length });
        const edit = apimartGrokOfficialVideoCapabilitiesFor(model)!.workflow === "video_edit";
        // Validate incompatible media before any uploads, then keep the finalized array order.
        const prepared = await Promise.all(
            references.map(async (image) => {
                const direct = image.url || image.dataUrl || "";
                if (/^https?:\/\//i.test(direct)) return { url: publicHttpsUrl(direct) };
                const blob = await imageToBlob(image);
                validateApimartReferenceBlob(blob);
                return { blob };
            }),
        );
        const imageUrls = await Promise.all(prepared.map((image) => image.url || publishApimartReferenceBlob(config, image.blob!, options)));
        const videoUrls = edit ? await Promise.all(videoReferences.map((item) => apimartMediaReferenceUrl(item, "视频", true))) : [];
        const completeInput = { ...requestInput, imageUrls, videoUrls };
        return postApimartVideoTask(config, buildApimartGrokOfficialVideoPayload(completeInput), options);
    }
    if (config.modelProfile?.grokVideoCapabilities || isGrokApimartVideoModel(model)) {
        const normalized = normalizeGrokApimartVideoSettings({
            resolution: normalizeSeedanceVideoResolution(config.vquality),
            ratio: normalizeVideoRatio(config.size),
            duration: Number(config.videoSeconds),
        });
        const requestInput = {
            model,
            prompt,
            resolution: normalized.resolution,
            size: normalized.ratio,
            duration: normalized.duration,
            videoCount: videoReferences.length,
            audioCount: audioReferences.length,
        };
        validateGrokApimartVideoRequest({ ...requestInput, imageCount: references.length });
        const preparedReferences = await Promise.all(references.map(hydrateApimartGrokReference));
        validateGrokApimartReferenceImages(preparedReferences);
        const imageUrls = await Promise.all(preparedReferences.map((image) => publishApimartReference(config, image, options)));
        const completeInput = { ...requestInput, imageUrls };
        return postApimartVideoTask(config, buildGrokApimartVideoPayload(completeInput), options);
    }
    if (config.modelProfile?.h3Capabilities || isMiniMaxH3Model(model)) {
        const normalized = normalizeMiniMaxH3Settings({
            referenceMode: (config.videoReferenceMode || "text_to_video") as SeedanceReferenceMode,
            resolution: config.vquality,
            ratio: normalizeVideoRatio(config.size),
            duration: Number(config.videoSeconds),
        });
        const requestInput = {
            model,
            prompt,
            resolution: normalized.resolution,
            aspectRatio: normalized.ratio,
            duration: normalized.duration,
            referenceMode: normalized.referenceMode as MiniMaxH3ReferenceMode,
            videoDurationsMs: videoReferences.map((item) => item.durationMs),
            audioDurationsMs: audioReferences.map((item) => item.durationMs),
        };
        validateMiniMaxH3Request({ ...requestInput, imageCount: references.length, videoCount: videoReferences.length, audioCount: audioReferences.length });
        const imageUrls = await Promise.all(references.map((image) => publishApimartReference(config, image, options)));
        const videoUrls = await Promise.all(videoReferences.map((item) => apimartMediaReferenceUrl(item, "视频")));
        const audioUrls = await Promise.all(audioReferences.map((item) => apimartMediaReferenceUrl(item, "音频")));
        const completeInput = { ...requestInput, imageUrls, videoUrls, audioUrls };
        return postApimartVideoTask(config, buildMiniMaxH3Payload(completeInput), options);
    }
    const seedance = config.modelProfile?.videoCapabilities || seedanceCapabilitiesFor(model);
    if (seedance) {
        const referenceMode = (config.videoReferenceMode || "omni") as SeedanceReferenceMode;
        const requestInput = {
            model,
            prompt,
            resolution: normalizeSeedanceVideoResolution(config.vquality),
            size: normalizeVideoRatio(config.size),
            duration: Number(config.videoSeconds),
            generateAudio: config.videoGenerateAudio !== "false",
            watermark: config.videoWatermark === "true",
            outputFormat: config.videoOutputFormat === "mov" ? ("mov" as const) : ("mp4" as const),
            referenceMode,
            videoDurationsMs: videoReferences.map((item) => item.durationMs),
            audioDurationsMs: audioReferences.map((item) => item.durationMs),
        };
        validateSeedanceApimartRequest({ ...requestInput, imageCount: references.length, videoCount: videoReferences.length, audioCount: audioReferences.length });
        const videoUrls = await Promise.all(videoReferences.map((item) => apimartMediaReferenceUrl(item, "视频")));
        const audioUrls = await Promise.all(audioReferences.map((item) => apimartMediaReferenceUrl(item, "音频")));
        const imageUrls = await Promise.all(references.map((image) => publishApimartReference(config, image, options)));
        const payload = buildSeedanceApimartPayload({ ...requestInput, imageUrls, videoUrls, audioUrls });
        return postApimartVideoTask(config, payload, options);
    }
    if (videoReferences.length || audioReferences.length) throw new Error(`${model} 不支持参考视频或参考音频`);
    if (references.length && (!parameters.has("references") || maxReferences === 0)) throw new Error(`${config.model} 不支持参考图生视频`);
    const imageUrls = await Promise.all(references.slice(0, maxReferences || references.length).map((image) => publishApimartReference(config, image, options)));
    const payload: Record<string, unknown> = {
        model,
        prompt,
        ...(parameters.has("resolution") ? { resolution: normalizeVideoResolution(config.vquality) } : {}),
        ...(parameters.has("size") ? { size: normalizeVideoRatio(config.size) } : {}),
        ...(parameters.has("duration") ? { duration: normalizeVideoDuration(config.videoSeconds) } : {}),
        ...(parameters.has("generateAudio") ? { generate_audio: config.videoGenerateAudio !== "false" } : {}),
        ...(parameters.has("watermark") ? { watermark: config.videoWatermark === "true" } : {}),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    };
    return postApimartVideoTask(config, payload, options);
}

async function hydrateApimartGrokReference(image: ReferenceImage): Promise<ReferenceImage> {
    let blob: Blob | null = null;
    let width = Number(image.width || 0);
    let height = Number(image.height || 0);
    let bytes = Number(image.bytes || 0);
    let mimeType = String(image.mimeType || image.type || "").toLowerCase();
    if (!width || !height || !bytes || !mimeType) {
        blob = await imageToBlob(image);
        if (!blob) throw new Error("无法读取 APIMart Grok 参考图");
        bytes ||= blob.size;
        mimeType ||= blob.type.toLowerCase();
    }
    if (!width || !height) {
        if (typeof createImageBitmap !== "function" || !blob) throw new Error("无法读取 APIMart Grok 参考图宽高");
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
    }
    return { ...image, type: mimeType, mimeType, width, height, bytes };
}

async function postApimartVideoTask(config: ApimartConfig, payload: Record<string, unknown>, options?: RequestOptions) {
    const requestUrl = buildApiUrl(config.baseUrl, "/videos/generations");

    const reservation = await prepareProviderRequest({ requestUrl, requestPayload: payload, taskId: options?.localTakeId, projectId: options?.projectId });
    const response = (
        await axios.post(requestUrl, payload, {
            headers: {
                "Content-Type": "application/json",
                ...(options?.localTakeId ? { "X-Narralight-Video-Take-Id": options.localTakeId } : {}),
                ...(isApimartGrokOfficialVideoModel(String(payload.model)) ? { "Idempotency-Key": options?.localTakeId || reservation.taskId || `grok_${nanoid()}` } : {}),
                ...reservation.headers,
            },
            signal: options?.signal,
        })
    ).data;
    const taskId = taskIdFromResponse(response);
    if (!taskId) throw new Error("APIMart 未返回视频任务 ID");
    return taskId;
}

async function apimartMediaReferenceUrl(item: ReferenceVideo | ReferenceAudio, kind: "视频" | "音频", requireLocal = false) {
    if (!requireLocal && (item.url.startsWith("asset://") || isReusablePublicUrl(item.url))) return item.url;
    let storageKey = item.storageKey || "";
    let mimeType = String(item.type || "").toLowerCase();
    let blob: Blob | null = null;
    if (!/^sha256:[a-f0-9]{64}$/.test(storageKey) && item.storageKey) blob = await getMediaBlob(item.storageKey);
    if (!/^sha256:[a-f0-9]{64}$/.test(storageKey) && !blob && item.url?.startsWith("blob:")) blob = await (await fetch(item.url)).blob();
    if (!/^sha256:[a-f0-9]{64}$/.test(storageKey) && blob) {
        const stored = await uploadMediaFile(blob, `apimart-${kind === "视频" ? "video" : "audio"}-reference`);
        storageKey = stored.storageKey;
        mimeType = stored.mimeType.toLowerCase();
    }
    mimeType = canonicalApimartLocalMediaMime(mimeType, item.name, kind);
    const allowed = kind === "视频" ? ["video/mp4", "video/quicktime"] : ["audio/wav", "audio/x-wav", "audio/mpeg"];
    const match = /^sha256:([a-f0-9]{64})$/.exec(storageKey);
    if (!match || !allowed.includes(mimeType)) throw new Error(`APIMart 本机参考${kind}格式无效`);
    return `narralight-object://sha256/${match[1]}?mime=${encodeURIComponent(mimeType)}`;
}

function canonicalApimartLocalMediaMime(mimeType: string, name: string, kind: "视频" | "音频") {
    const normalized = String(mimeType || "").toLowerCase();
    const unknown = !normalized || normalized === "application/octet-stream";
    if (kind === "音频") {
        if (normalized === "audio/mp3" || (unknown && /\.mp3$/i.test(name))) return "audio/mpeg";
        if (unknown && /\.wav$/i.test(name)) return "audio/wav";
    } else if (unknown) {
        if (/\.mp4$/i.test(name)) return "video/mp4";
        if (/\.mov$/i.test(name)) return "video/quicktime";
    }
    return normalized;
}

export type ApimartVideoTaskState =
    | { status: "pending" }
    | { status: "result_pending"; reason: "completed_without_result"; diagnostic: ReturnType<typeof describeApimartTask> }
    | { status: "completed"; url: string; resultIndex: number; expiresAt?: string }
    | { status: "failed"; error: string };

export async function pollApimartVideoTask(config: ApimartConfig, taskId: string, options?: RequestOptions): Promise<ApimartVideoTaskState> {
    const response = (await axios.get(buildApiUrl(config.baseUrl, `/tasks/${encodeURIComponent(taskId)}`), { signal: options?.signal })).data;
    const task = apimartTaskRecord(response);
    const status = String(task.status || "").toLowerCase();
    const media = normalizeApimartMediaResults(response, "video")[0];
    const official = isApimartGrokOfficialVideoModel(config.model);
    const completed = official ? status === "completed" : APIMART_SUCCESS_STATUSES.has(status);
    const failed = official ? status === "failed" : APIMART_FAILURE_STATUSES.has(status);
    if (completed && media) return { status: "completed", url: media.url, resultIndex: media.resultIndex, ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}) };
    if (completed) return { status: "result_pending", reason: "completed_without_result", diagnostic: describeApimartTask(response, "video") };
    if (failed)
        return {
            status: "failed",
            error: official
                ? `${apimartGrokOfficialVideoProviderError(task)}｜任务 ${taskId}${providerRequestIdPart(response)}`
                : isGrokApimartVideoModel(config.model)
                  ? grokApimartVideoProviderError(task)
                  : isMiniMaxH3Model(config.model)
                    ? miniMaxH3ProviderError(task)
                    : taskFailureError(task, taskId, status, "视频", response).message,
        };
    return { status: "pending" };
}

async function publishApimartReference(config: ApimartConfig, image: ReferenceImage, options?: RequestOptions) {
    const direct = image.url || image.dataUrl || "";
    if (isReusablePublicUrl(direct)) return direct;
    const blob = await imageToBlob(image);
    validateApimartReferenceBlob(blob);
    return publishApimartReferenceBlob(config, blob, options);
}

function validateApimartReferenceBlob(blob: Blob | null): asserts blob is Blob {
    if (!blob) throw new Error("无法读取本地参考图");
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(blob.type)) throw new Error("APIMart 参考图只支持 JPEG、PNG、WebP 或 GIF");
    if (blob.size > APIMART_IMAGE_MAX_BYTES) throw new Error("APIMart 参考图不得超过 20 MB");
}

async function publishApimartReferenceBlob(config: ApimartConfig, blob: Blob, options?: RequestOptions) {
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const body = new FormData();
    body.append("file", new File([blob], `infinite-canvas-${nanoid()}.${extension}`, { type: blob.type }));
    const result = (await axios.post<{ url?: string }>(buildApiUrl(config.baseUrl, "/uploads/images"), body, { signal: options?.signal })).data;
    if (!result.url || !/^https:\/\/(?:upload\.apimart\.ai|getapib\.org)\//i.test(result.url)) throw new Error("APIMart 未返回有效的参考图地址");
    return result.url;
}

function isReusablePublicUrl(value: string) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "::1"].includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function taskIdFromResponse(payload: unknown) {
    const task = apimartTaskRecord(payload);
    return String(task.task_id || task.id || "");
}

function toImageResults(images: ApimartNormalizedResult[], taskId: string): ApimartImageResult[] {
    return images.map(({ url: remoteUrl, resultIndex, expiresAt }) => ({
        id: nanoid(),
        dataUrl: remoteUrl,
        remoteUrl,
        ...(taskId ? { upstreamTaskId: taskId } : {}),
        ...(expiresAt ? { remoteExpiresAt: expiresAt } : {}),
        resultIndex,
    }));
}

function taskError(task: ApimartTaskRecord) {
    const error = task.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as ApimartTaskRecord).message === "string") return String((error as ApimartTaskRecord).message);
    return typeof task.fail_reason === "string" ? task.fail_reason : "";
}

function taskErrorCode(task: ApimartTaskRecord) {
    const error = task.error && typeof task.error === "object" ? (task.error as ApimartTaskRecord) : {};
    const value = error.code ?? error.type ?? task.error_code ?? task.errorCode ?? task.code;
    return value === undefined || value === null || value === "" ? "provider_task_failed" : String(value).slice(0, 100);
}

function taskFailureError(task: ApimartTaskRecord, taskId: string, status: string, kind: string, payload?: unknown) {
    const media = kind === "视频" ? "video" : "image";
    return localApiError(
        `apimart_${media}_task_failed`,
        `APIMart ${kind}生成失败｜状态 ${status || "unknown"}｜供应商错误码 ${taskErrorCode(task)}｜${taskError(task) || "供应商未返回具体错误内容"}｜任务 ${taskId}${providerRequestIdPart(payload || task)}`,
    );
}

function providerRequestId(payload: unknown) {
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as ApimartTaskRecord) : {};
    const task = apimartTaskRecord(payload);
    const error = task.error && typeof task.error === "object" && !Array.isArray(task.error) ? (task.error as ApimartTaskRecord) : {};
    const value = task.request_id ?? task.requestId ?? error.request_id ?? error.requestId ?? root.request_id ?? root.requestId;
    const text = value === undefined || value === null ? "" : String(value);
    return /^[a-zA-Z0-9_.:-]{1,200}$/.test(text) ? text : "";
}

function providerRequestIdPart(payload: unknown) {
    const requestId = providerRequestId(payload);
    return requestId ? `｜供应商 Request ID ${requestId}` : "";
}

export function normalizeApimartImageModel(value: string) {
    if (SEEDREAM_5_PRO_MODELS.has(value)) return "seedream-5-0-pro";
    if (SEEDREAM_5_LITE_MODELS.has(value)) return "seedream-5-0-lite";
    return value;
}

export function normalizeApimartImageSize(model: string, value: string) {
    if (!SEEDREAM_5_PRO_MODELS.has(model)) return value && value !== "auto" ? value : "";
    if (!value || value === "auto") return "auto";
    if (SEEDREAM_5_PRO_SIZES.has(value)) return value;
    const normalized = value.replace(/[×X]/g, "x");
    const match = /^(\d+)x(\d+)$/.exec(normalized);
    if (!match) return "auto";
    const width = Number(match[1]);
    const height = Number(match[2]);
    const pixels = width * height;
    const ratio = width / height;
    return pixels >= 921_600 && pixels <= 4_624_220 && ratio >= 1 / 16 && ratio <= 16 ? normalized : "auto";
}

export function apimartResolution(model: string, value: string) {
    if (SEEDREAM_5_PRO_MODELS.has(model)) {
        if (["high", "2k"].includes(value.toLowerCase())) return "2K";
        if (["medium", "1.5k", "1_5k"].includes(value.toLowerCase())) return "1.5K";
        if (["low", "1k"].includes(value.toLowerCase())) return "1K";
        return "";
    }
    if (value === "high") return "4k";
    if (value === "medium") return "2k";
    if (value === "low") return "1k";
    return "";
}

function normalizeVideoResolution(value: string) {
    const number = Number(String(value || "720").replace(/p$/i, ""));
    return `${[480, 720, 1080].includes(number) ? number : 720}p`;
}

function normalizeSeedanceVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    if (/^4k$/i.test(value)) return "4k";
    const number = Number(String(value || "720").replace(/p$/i, ""));
    return Number.isFinite(number) ? `${number}p` : String(value || "").toLowerCase();
}

function normalizeVideoRatio(value: string) {
    if (["16:9", "9:16", "1:1", "3:2", "2:3", "4:3", "3:4", "21:9", "adaptive"].includes(value)) return value;
    return /^\d+x\d+$/.test(value) && Number(value.split("x")[0]) < Number(value.split("x")[1]) ? "9:16" : "16:9";
}

function normalizeVideoDuration(value: string) {
    return Math.max(4, Math.min(15, Math.floor(Number(value) || 5)));
}

function wait(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
