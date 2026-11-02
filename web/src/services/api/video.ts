import { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { ReferenceImage } from "@/types/image";
import { type SeedanceModelCapabilities } from "@/lib/seedance-model-capabilities";
import { type UploadedFile } from "@/services/platform-file-storage";
import axios from "axios";
import { apiErrorMessageFromUnknownResponse } from "@/services/api-error";
import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, importRemoteMediaResult, uploadMediaFile } from "@/services/platform-file-storage";
import { readGenerationTask } from "@/services/generation-task";
import { imageToDataUrl, uploadImage } from "@/services/platform-image-storage";
import {
    boolConfig,
    buildSeedancePromptText,
    isSeedanceVideoConfig,
    normalizeResolutionToken,
    normalizeSeedanceRatio,
    seedanceVideoReferenceError,
    SEEDANCE_VIDEO_MIME_TYPES,
} from "@/lib/seedance-video";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { seedanceCapabilitiesFor, seedanceSettingIssues, type SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";
import { isGrokApimartVideoModel } from "@/lib/grok-apimart-video";
import { isApimartGrokOfficialVideoModel } from "@/lib/apimart-grok-official-video";
import { assertModelBackendSupported } from "@/lib/backend-model-contract";
import { isRunningHubGrokVideoModel } from "@/lib/runninghub-grok-video";
import { normalize888ApiVideoSettings } from "@/lib/api888-video-settings";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { createApimartVideoTask, isApimartConfig, pollApimartVideoTask } from "./apimart";
import { createRunningHubVideoTask, isRunningHubConfig, queryRunningHubVideoTask } from "./runninghub";
import { createRichBestVideoTask, isRichBestConfig, pollRichBestVideoTask } from "./richbest";
import { prepareProviderRequest } from "./provider-request";
import { createLocalH3Job, isLocalH3Model, normalizeLocalH3Parameters, type LocalH3Reference } from "./local-h3";

type VideoResponse = {
    id: string;
    status?: string;
    error?: { message?: string };
    url?: string;
    result_url?: string;
    video_url?: string;
    content?: { video_url?: string; url?: string; file_url?: string } | null;
};
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; file_url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal; localTakeId?: string; primaryEditVideoId?: string; projectId?: string; nodeId?: string; seed?: number | null };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = {
    blob?: Blob;
    url?: string;
    mimeType?: string;
    remoteUrl?: string;
    remoteProvider?: "apimart" | "volcengine-ark" | "runninghub" | "richbest";
    upstreamTaskId?: string;
    resultIndex?: number;
    remoteExpiresAt?: string;
};
export type VideoGenerationTask = {
    id: string;
    provider: "openai" | "gemini" | "seedance" | "volcengine-ark" | "apimart" | "runninghub" | "richbest" | "888api" | "local-h3" | "plugin";
    model: string;
    finalizingAttempts?: number;
};
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = { name?: string; done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } };
export type VideoGenerationTaskState =
    | { status: "pending" }
    | { status: "result_pending"; attempts: number; exhausted: boolean; diagnostic?: { status: string; taskKeys: string[]; resultKeys: string[]; collectionCount: number } }
    | { status: "completed"; result: VideoGenerationResult }
    | { status: "failed"; error: string };
export const APIMART_RESULT_GRACE_POLLS = 8;
export const VIDEO_INITIAL_POLL_DELAY_MS = 30_000;

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string, options?: RequestOptions) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(options?.localTakeId ? { "X-Narralight-Video-Take-Id": options.localTakeId } : {}),
    };
}

export async function requestVideoGeneration(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    return waitForVideoGenerationTask(config, task, options);
}

export async function waitForVideoGenerationTask(
    config: AiConfig,
    task: VideoGenerationTask,
    options?: RequestOptions & { onState?: (state: VideoGenerationTaskState, task: VideoGenerationTask) => void | Promise<void>; maxPolls?: number; pollDelayMs?: number },
): Promise<VideoGenerationResult> {
    const delayMs =
        options?.pollDelayMs ??
        (task.provider === "seedance" || task.provider === "volcengine-ark" || task.provider === "runninghub" ? 5000 : task.provider === "apimart" || task.provider === "richbest" ? 3000 : 2500);
    const initialDelayMs = options?.pollDelayMs ?? VIDEO_INITIAL_POLL_DELAY_MS;
    const maxPolls = options?.maxPolls ?? 120;
    if (task.provider !== "plugin" && initialDelayMs > 0) await delay(initialDelayMs, options?.signal);
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        await options?.onState?.(state, task);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "result_pending" && state.exhausted) throw new Error(`APIMart 任务 ${task.id} 已完成，结果仍在整理中；请稍后恢复原任务，不要重新生成。`);
        if (attempt === maxPolls - 1)
            throw new Error(apiText("videoTimeout", { provider: task.provider === "seedance" || task.provider === "volcengine-ark" || task.provider === "runninghub" ? "Seedance " : "" }));
        await delay(delayMs, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export async function createVideoGenerationTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (isLocalH3Model(selectedModel)) {
        if (script) throw Object.assign(new Error("本机 H3 固定工作流不允许自定义脚本"), { code: "local_h3_script_forbidden" });
        if (videoReferences.length || audioReferences.length)
            throw Object.assign(new Error("本机 H3 当前只支持图片参考，请移除视频或音频参考"), { code: "local_h3_multimodal_references_unsupported" });
        if (references.length > 2) throw Object.assign(new Error("本机 H3 最多支持 2 张图片：第 1 张为首帧，第 2 张为尾帧"), { code: "local_h3_image_reference_limit" });
        if (!options?.localTakeId || !options.projectId || !options.nodeId) {
            throw Object.assign(new Error("本机 H3 任务必须先建立 Take 并绑定项目与画布节点"), { code: "local_h3_owner_required" });
        }
        const localReferences = await Promise.all(
            references.map(async (image, index): Promise<LocalH3Reference> => {
                let storageKey = String(image.storageKey || "");
                let mimeType = String(image.mimeType || image.type || image.dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png").toLowerCase();
                if (mimeType === "image/jpg") mimeType = "image/jpeg";
                if (!/^sha256:[a-f0-9]{64}$/.test(storageKey)) {
                    const stored = await uploadImage(await imageToDataUrl(image));
                    storageKey = stored.storageKey;
                    mimeType = stored.mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : stored.mimeType.toLowerCase();
                }
                if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType))
                    throw Object.assign(new Error("本机 H3 参考图只支持 PNG、JPEG 或 WebP"), { code: "local_h3_reference_mime_invalid" });
                return { storageKey, mimeType: mimeType as LocalH3Reference["mimeType"], role: index === 0 ? "first_frame" : "last_frame" };
            }),
        );
        const referenceMode = localReferences.length === 2 ? "first_last_frame" : localReferences.length === 1 ? "first_frame" : "text_to_video";
        const parameters = normalizeLocalH3Parameters({
            duration: Number(requestConfig.videoSeconds) as 5 | 10,
            resolution: requestConfig.vquality as "864x480" | "480x864" | "640x640",
            aspectRatio: requestConfig.size as "16:9" | "9:16" | "1:1",
            referenceMode,
        });
        const job = await createLocalH3Job(
            {
                takeId: options.localTakeId,
                projectId: options.projectId,
                nodeId: options.nodeId,
                promptOriginalZh: prompt,
                seed: options.seed,
                parameters,
                references: localReferences,
            },
            options.signal,
        );
        return { id: job.jobId, provider: "local-h3", model: selectedModel };
    }
    if (script && (isGrokApimartVideoModel(selectedModel) || isRunningHubGrokVideoModel(selectedModel) || isApimartGrokOfficialVideoModel(selectedModel))) {
        throw Object.assign(new Error("Grok 内置视频模型不能使用自定义脚本，请选择对应供应商工作流"), { code: "grok_video_script_forbidden" });
    }
    assertModelBackendSupported(selectedModel);

    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, videoReferences, audioReferences, options);
    assertVideoConfig(requestConfig, requestConfig.model);

    if (requestConfig.provider === "888api") return create888ApiVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    if (isRunningHubConfig(requestConfig)) {
        const id = await createRunningHubVideoTask(requestConfig, prompt, references, videoReferences, audioReferences, options);
        return { id, provider: "runninghub", model: selectedModel };
    }
    if (isApimartConfig(requestConfig)) {
        try {
            const id = await createApimartVideoTask(requestConfig, prompt, references, videoReferences, audioReferences, options);
            return { id, provider: "apimart", model: selectedModel };
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
        }
    }
    if (isRichBestConfig(requestConfig)) {
        try {
            const id = await createRichBestVideoTask(requestConfig, prompt, references, videoReferences, audioReferences, options);
            return { id, provider: "richbest", model: selectedModel };
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
        }
    }
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    if (task.provider === "local-h3") throw new Error("本机 H3 任务由叙光后台托管，请从本机任务记录恢复，系统不会改走云端轮询");
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "apimart") {
        const result = await pollApimartVideoTask(requestConfig, task.id, options);
        if (result.status === "completed") {
            task.finalizingAttempts = 0;
            return {
                status: "completed",
                result: { url: result.url, remoteUrl: result.url, mimeType: "video/mp4", upstreamTaskId: task.id, resultIndex: result.resultIndex, remoteExpiresAt: result.expiresAt },
            };
        }
        if (result.status === "result_pending") {
            task.finalizingAttempts = (task.finalizingAttempts || 0) + 1;
            return { status: "result_pending", attempts: task.finalizingAttempts, exhausted: task.finalizingAttempts >= APIMART_RESULT_GRACE_POLLS, diagnostic: result.diagnostic };
        }
        return result;
    }
    if (task.provider === "runninghub") {
        const result = await queryRunningHubVideoTask(requestConfig, task.id, options);
        if (result.status === "completed")
            return {
                status: "completed",
                result: {
                    url: result.url,
                    remoteUrl: result.url,
                    remoteProvider: "runninghub",
                    mimeType: "video/mp4",
                    upstreamTaskId: task.id,
                    resultIndex: result.resultIndex,
                    remoteExpiresAt: result.expiresAt,
                },
            };
        if (result.status === "result_pending") return { status: "result_pending", attempts: 1, exhausted: false };
        return result;
    }
    if (task.provider === "richbest") {
        const result = await pollRichBestVideoTask(requestConfig, task.id, options);
        if (result.status === "completed")
            return { status: "completed", result: { url: result.url, remoteUrl: result.url, remoteProvider: "richbest", mimeType: result.mimeType, upstreamTaskId: task.id, resultIndex: 0 } };
        return result;
    }
    if (task.provider === "888api") {
        const record = await readGenerationTask("888api", task.id);
        if (record?.status === "completed" && record.archivedResult)
            return { status: "completed", result: { url: record.archivedResult.url, mimeType: record.archivedResult.mimeType, upstreamTaskId: task.id, resultIndex: record.resultIndex || 0 } };
        if (record?.status === "failed" || record?.status === "cancelled") return { status: "failed", error: record.providerError?.message || record.errorCode || "888API 任务失败" };
        return { status: "pending" };
    }
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return task.provider === "seedance" || task.provider === "volcengine-ark" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

async function api888ReferenceUrl(value: { storageKey?: string; url?: string; dataUrl?: string; type?: string }, kind: "image" | "video" | "audio") {
    const accepted = kind === "image" ? ["image/png", "image/jpeg", "image/webp"] : kind === "video" ? ["video/mp4", "video/quicktime"] : ["audio/wav", "audio/mpeg"];
    const blob = value.storageKey ? await getMediaBlob(value.storageKey) : null;
    const source = blob || (await (await fetch(value.url || value.dataUrl || "")).blob());
    const stored = await uploadMediaFile(source, `${kind}-888api-reference`);
    const mimeType = kind === "audio" && stored.mimeType === "audio/x-wav" ? "audio/wav" : kind === "audio" && stored.mimeType === "audio/mp3" ? "audio/mpeg" : stored.mimeType;
    if (!accepted.includes(mimeType)) throw new Error(`888API 不支持该${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}素材格式`);
    const hash = /^sha256:([a-f0-9]{64})$/.exec(stored.storageKey)?.[1];
    if (!hash) throw new Error("888API 参考素材未保存为叙光对象");
    return `narralight-object://sha256/${hash}?mime=${encodeURIComponent(mimeType)}`;
}

async function create888ApiVideoTask(
    config: AiConfig,
    selectedModel: string,
    prompt: string,
    images: ReferenceImage[],
    videos: ReferenceVideo[],
    audios: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    if (!options?.localTakeId) throw new Error("888API 视频必须先创建叙光 Take");
    const model = modelOptionName(selectedModel);
    const { seconds, ratio } = normalize888ApiVideoSettings(selectedModel, config.size, config.videoSeconds);
    const references = {
        images: await Promise.all(images.map((image) => api888ReferenceUrl(image, "image"))),
        videos: await Promise.all(videos.map((video) => api888ReferenceUrl(video, "video"))),
        audios: await Promise.all(audios.map((audio) => api888ReferenceUrl(audio, "audio"))),
    };
    const payload = { model, prompt, ...(model === "wan3.0-video" ? { seconds } : { duration: seconds }), ratio, ...references };
    const requestUrl = aiApiUrl(config, "/videos");
    const reservation = await prepareProviderRequest({ requestUrl, requestPayload: payload, taskId: options.localTakeId, projectId: options.projectId });
    const response = await axios.post<{ id?: string; task_id?: string }>(requestUrl, payload, {
        headers: { ...aiHeaders(config, "application/json", options), ...reservation.headers },
        signal: options.signal,
    });
    const id = response.data.id || response.data.task_id;
    if (!id) throw new Error("888API 已提交但未返回任务 ID，请从原 Take 恢复，避免重复付费");
    return { id, provider: "888api", model: selectedModel };
}

async function createPluginVideoTask(
    config: AiConfig,
    model: string,
    script: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all(videoReferences.map(referenceMediaToDataUrl));
    const audios = await Promise.all(audioReferences.map(referenceMediaToDataUrl));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: genericVideoMode(config.videoReferenceMode, refs.length, Boolean(videos.length || audios.length)),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.remoteUrl && result.upstreamTaskId) {
        return importRemoteMediaResult({
            url: result.remoteUrl,
            provider: result.remoteProvider || "apimart",
            taskId: result.upstreamTaskId,
            resultIndex: result.resultIndex || 0,
            mediaKind: "video",
            expiresAt: result.remoteExpiresAt,
        });
    }
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createOpenAIVideoTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size, config.vquality)) body.append("size", normalizeVideoSize(config.size, config.vquality)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all(videoReferences.map((item) => referenceMediaToFile(item, "ref.mp4")));
    const audios = await Promise.all(audioReferences.map((item) => referenceMediaToFile(item, "ref.mp3")));
    const mode = genericVideoMode(config.videoReferenceMode, files.length, Boolean(videos.length || audios.length));
    body.append("mode", mode);
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    if (mode === "frames") {
        if (files[0]) body.append("first_frame", files[0], "first.png");
        if (files[1]) body.append("last_frame", files[1], "last.png");
    } else {
        files.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config, undefined, options), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function createGeminiVideoTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all(videoReferences.map(referenceMediaToDataUrl));
    const audios = await Promise.all(audioReferences.map(referenceMediaToDataUrl));
    const mode = genericVideoMode(config.videoReferenceMode, images.length, Boolean(videos.length || audios.length));
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseGeminiInlineData(images[0]);
        if (images[1]) instance.lastFrame = parseGeminiInlineData(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseGeminiInlineData(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = parseGeminiInlineData(videos[0], "video/mp4");
    if (audios[0]) instance.audio = parseGeminiInlineData(audios[0], "audio/mpeg");
    try {
        const created = unwrapEnvelope(
            (
                await axios.post<ApiEnvelope<GeminiVideoOperation>>(
                    geminiVideoUrl(config, model, "predictLongRunning"),
                    {
                        instances: [instance],
                        parameters: {
                            aspectRatio: videoAspectRatio(config.size),
                            durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                            resolution: normalizeVideoResolution(config.vquality),
                            generateAudio: boolConfig(config.videoGenerateAudio, true),
                            addWatermark: boolConfig(config.videoWatermark, false),
                        },
                    },
                    { headers: geminiVideoHeaders(config), signal: options?.signal },
                )
            ).data,
            apiText("noVideoTask"),
        );
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope(
            (await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data,
            apiText("videoTaskQueryFailed"),
        );
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function createSeedanceTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const capabilities = seedanceCapabilitiesFor(modelName);
    if (!capabilities) throw new Error(apiText("videoModelRequired"));
    const referenceMode = (config.videoReferenceMode || "omni") as SeedanceReferenceMode;
    assertSeedanceModeInputs(capabilities, referenceMode, references.length, videoReferences.length, audioReferences.length);
    if (audioReferences.length && capabilities.references.audioRequiresVisual && !references.length && !videoReferences.length) {
        throw new Error(apiText("seedanceAudioRequiresVisual"));
    }
    assertSeedanceVideoReferences(videoReferences, capabilities, referenceMode);
    assertSeedanceAudioReferences(audioReferences, capabilities);
    if (videoReferences.some((video) => !Number.isFinite(video.durationMs) || Number(video.durationMs) <= 0)) throw new Error("参考视频缺少可计价时长，请重新选择或读取素材信息");
    const inputVideoDurationMs = videoReferences.reduce((total, video) => total + Number(video.durationMs || 0), 0);
    const ratio = normalizeSeedanceRatio(config.size);
    const resolution = normalizeResolutionToken(config.vquality);
    const duration = Number(config.videoSeconds);
    const issues = seedanceSettingIssues(modelName, { resolution, ratio, duration, referenceMode });
    if (issues.length) throw new Error(issues[0]);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences, referenceMode, capabilities, options?.primaryEditVideoId);
    if (!content.length) throw new Error(apiText("videoPromptRequired"));
    const hasReferenceInput = Boolean(references.length || videoReferences.length || audioReferences.length);
    const payload = {
        model: modelName,
        content,
        ratio,
        resolution,
        duration,
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
        ...(capabilities.family === "seedance-2.5" ? { output_format: config.videoOutputFormat === "mov" ? "mov" : "mp4" } : {}),
        ...(capabilities.family === "seedance-2.5" && referenceMode === "video_edit"
            ? { omni_reference_task_type: "edit" }
            : capabilities.family === "seedance-2.5" && referenceMode === "video_extend"
              ? { omni_reference_task_type: "extend" }
              : capabilities.family === "seedance-2.5" && (referenceMode === "multi_image" || referenceMode === "motion_transfer" || (referenceMode === "omni" && hasReferenceInput))
                ? { omni_reference_task_type: "reference" }
                : {}),
        ...(referenceMode === "draft" ? { draft: true } : {}),
    };

    try {
        const requestUrl = seedanceApiUrl(config);
        const reservation = await prepareProviderRequest({
            requestUrl,
            requestPayload: payload,
            taskId: options?.localTakeId,
            projectId: options?.projectId,
        });
        const created = unwrapSeedanceTask(
            (await axios.post<ApiEnvelope<SeedanceTask>>(requestUrl, payload, { headers: { ...aiHeaders(config, "application/json", options), ...reservation.headers }, signal: options?.signal }))
                .data,
        );
        if (!created.id) throw new Error(apiText("seedanceNoTaskId"));
        return { id: created.id, provider: (config as AiConfig & { provider?: string }).provider === "volcengine-ark" ? "volcengine-ark" : "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("seedanceTaskCreateFailed")));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(state);
        if (url)
            return {
                status: "completed",
                result:
                    task.provider === "volcengine-ark"
                        ? {
                              url,
                              remoteUrl: url,
                              remoteProvider: "volcengine-ark",
                              mimeType: config.videoOutputFormat === "mov" ? "video/quicktime" : "video/mp4",
                              upstreamTaskId: task.id,
                              resultIndex: 0,
                              remoteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                          }
                        : await videoResultFromUrl(url, options),
            };
        if (state.status === "succeeded" || state.status === "completed") return { status: "failed", error: apiText("seedanceNoVideoUrl") };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired")
            return { status: "failed", error: readApiErrorMessage(state.error?.message) || apiText(state.status === "expired" ? "seedanceVideoTimeout" : "seedanceVideoFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("seedanceTaskQueryFailed")));
    }
}

function assertSeedanceModeInputs(capabilities: SeedanceModelCapabilities, mode: SeedanceReferenceMode, imageCount: number, videoCount: number, audioCount: number) {
    const supported = capabilities.modes[mode];
    if (!supported?.enabled) throw new Error(supported?.reason || "当前模型不支持所选生成模式");
    if (imageCount > capabilities.references.images || videoCount > capabilities.references.videos || audioCount > capabilities.references.audios) throw new Error("参考素材数量超过当前模型限制");
    if (mode === "text_to_video" && (imageCount || videoCount || audioCount)) throw new Error("文生视频模式不能同时使用参考素材");
    if (mode === "first_frame" && (imageCount !== 1 || videoCount || audioCount)) throw new Error("首帧模式需要恰好 1 张图片，且不能同时使用视频或音频参考");
    if (mode === "first_last_frame" && (imageCount !== 2 || videoCount || audioCount)) throw new Error("首尾帧模式需要恰好 2 张图片，且不能同时使用视频或音频参考");
    if (mode === "multi_image" && (imageCount < 2 || videoCount || audioCount)) throw new Error("多图参考模式需要至少 2 张图片，且不能同时使用视频或音频参考");
    if ((mode === "video_edit" || mode === "video_extend") && !videoCount) throw new Error(`${mode === "video_edit" ? "视频编辑" : "视频延长"}模式需要参考视频`);
    if (mode === "motion_transfer" && (!imageCount || !videoCount || audioCount)) throw new Error("动作模仿模式需要至少 1 张参考图和 1 个参考视频，且不能同时使用音频参考");
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[], capabilities: SeedanceModelCapabilities, referenceMode: SeedanceReferenceMode) {
    const error = seedanceVideoReferenceError(videoReferences, capabilities);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        const minDurationMs = capabilities.family === "seedance-2.5" && referenceMode === "video_edit" ? 4000 : 2000;
        if (video.durationMs < minDurationMs || video.durationMs > capabilities.references.maxVideoDurationMs)
            throw new Error(apiText("seedanceVideoDuration", { min: minDurationMs / 1000, max: capabilities.references.maxVideoDurationMs / 1000 }));
        total += video.durationMs;
    }
    if (total > capabilities.references.totalVideoDurationMs) throw new Error(apiText("seedanceVideoTotalDuration", { max: capabilities.references.totalVideoDurationMs / 1000 }));
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[], capabilities: SeedanceModelCapabilities) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > capabilities.references.maxAudioDurationMs)
            throw new Error(apiText("seedanceAudioDuration", { min: 2, max: capabilities.references.maxAudioDurationMs / 1000 }));
        total += audio.durationMs;
    }
    if (total > capabilities.references.totalAudioDurationMs) throw new Error(apiText("seedanceAudioTotalDuration", { max: capabilities.references.totalAudioDurationMs / 1000 }));
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    referenceMode: SeedanceReferenceMode,
    capabilities: SeedanceModelCapabilities,
    primaryEditVideoId?: string,
) {
    const content: Array<Record<string, unknown>> = [];
    let text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (capabilities.family === "seedance-2.5" && referenceMode === "video_edit") {
        const primaryIndex = resolvePrimaryEditVideoIndex(videoReferences, primaryEditVideoId);
        text = `编辑视频：以 @视频${primaryIndex + 1} 为待编辑原片。\n${text}`;
    }
    if (text) content.push({ type: "text", text });
    for (const [index, image] of references.slice(0, capabilities.references.images).entries()) {
        const role = referenceMode === "first_frame" ? "first_frame" : referenceMode === "first_last_frame" ? (index === 0 ? "first_frame" : "last_frame") : "reference_image";
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role });
    }
    for (const video of videoReferences.slice(0, capabilities.references.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, capabilities.references.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(apiText("referenceImageReadFailed"));
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let storageKey = video.storageKey || "";
    let mimeType = String(video.type || "").toLowerCase();
    let blob: Blob | null = null;
    if (!/^sha256:[a-f0-9]{64}$/.test(storageKey) && video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!/^sha256:[a-f0-9]{64}$/.test(storageKey) && !blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!/^sha256:[a-f0-9]{64}$/.test(storageKey) && blob) {
        const stored = await uploadMediaFile(blob, "video-reference");
        storageKey = stored.storageKey;
        mimeType = stored.mimeType;
    }
    const match = /^sha256:([a-f0-9]{64})$/.exec(storageKey);
    if (!match || !SEEDANCE_VIDEO_MIME_TYPES.includes(mimeType)) throw new Error(apiText("invalidReferenceVideo"));
    return `narralight-object://sha256/${match[1]}?mime=${encodeURIComponent(mimeType)}`;
}

function resolvePrimaryEditVideoIndex(videoReferences: ReferenceVideo[], primaryEditVideoId?: string) {
    if (videoReferences.length === 1) return 0;
    const index = videoReferences.findIndex((video) => video.id === primaryEditVideoId);
    if (index < 0) throw new Error("多份视频参考时，请先选择哪一份是待编辑原片");
    return index;
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error(apiText("invalidReferenceAudio"));
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function genericVideoMode(referenceMode: string | undefined, imageCount: number, hasMedia: boolean) {
    return referenceMode === "omni" || imageCount > 2 || hasMedia ? "reference" : "frames";
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalized = config.baseUrl.trim().replace(/\/+$/, "");
    return /\/(?:v1|v1beta)$/i.test(normalized) ? normalized : `${normalized}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, operation: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${operation.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function parseGeminiInlineData(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string, resolution = "720") {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    return ratio === "auto" ? null : computeVideoSize(resolution, ratio);
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

async function referenceMediaToDataUrl(item: { url?: string; storageKey?: string; type?: string }) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob && item.url) {
        const response = await fetch(item.url);
        if (response.ok) blob = await response.blob();
    }
    if (!blob) throw new Error(apiText(item.type?.startsWith("audio/") ? "invalidReferenceAudio" : "invalidReferenceVideo"));
    return blobToDataUrl(blob);
}

async function referenceMediaToFile(item: { name?: string; url?: string; storageKey?: string; type?: string }, fallbackName: string) {
    const dataUrl = await referenceMediaToDataUrl(item);
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, apiText("seedanceNoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse | SeedanceTask) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.file_url, payload.content?.url].find(
        (url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)),
    );
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        return apiErrorMessageFromUnknownResponse(error, statusMessage(error.response?.status, fallback));
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(apiText("localAssetReadFailed")));
        reader.readAsDataURL(blob);
    });
}
