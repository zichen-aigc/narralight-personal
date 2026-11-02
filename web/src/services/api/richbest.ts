import { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { ReferenceImage } from "@/types/image";
import { type RichBestRemoteModel } from "@/stores/use-config-store";
import axios from "axios";
import { imageToDataUrl } from "@/services/platform-image-storage";
import { buildApiUrl, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { prepareProviderRequest } from "./provider-request";
import { resolveRichBestMediaAssets } from "./richbest-assets";

type RoutedRichBestConfig = AiConfig & { provider?: string };
type RequestOptions = { signal?: AbortSignal; localTakeId?: string; projectId?: string };
type RichBestVideo = { id?: string; status?: string; url?: string; format?: string; error?: { code?: string; message?: string } };

export function isRichBestConfig(config: { provider?: string }) {
    return config.provider === "richbest";
}

function url(channelId: string, path: string) {
    const root = `/api/local/ai/${encodeURIComponent(channelId)}`;
    return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

function headers(options?: RequestOptions, extra?: Record<string, string>) {
    return {
        Authorization: "Bearer server-managed",
        "Content-Type": "application/json",
        ...(options?.localTakeId ? { "X-Narralight-Video-Take-Id": options.localTakeId, "Idempotency-Key": options.localTakeId } : {}),
        ...extra,
    };
}

function channelId(config: RoutedRichBestConfig) {
    const marker = "/api/local/ai/";
    const start = config.baseUrl.indexOf(marker);
    return start >= 0 ? decodeURIComponent(config.baseUrl.slice(start + marker.length).split("/")[0]) : "richbest";
}

export async function createRichBestVideoTask(config: RoutedRichBestConfig, prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], options?: RequestOptions) {
    const model = modelOptionName(config.model || config.videoModel);
    if ((videos.length || audios.length) && !/^doubao-seedance-2\.(?:5|0(?:-fast|-mini)?)$/.test(model)) throw new Error("当前瑞池模型不支持视频或音频参考，未提交供应商");
    if (videos.some((video) => !Number.isFinite(video.durationMs) || Number(video.durationMs) <= 0)) throw new Error("瑞池参考视频缺少可计价时长，未提交供应商");
    const image = await Promise.all(images.map((item) => imageToDataUrl(item)));
    const media = await resolveRichBestMediaAssets(channelId(config), videos, audios, options);
    const resolutionToken = String(config.vquality || "720p")
        .replace(/^native/i, "")
        .toLowerCase();
    const resolution = /^\d+$/.test(resolutionToken) ? `${resolutionToken}p` : resolutionToken;
    const ratio = /^\d+(?::\d+)$/.test(config.size) ? config.size : undefined;
    const duration = Math.max(1, Math.min(30, Math.round(Number(config.videoSeconds) || 6)));
    const body = {
        model,
        prompt,
        ...(!media.videoUrls.length && !media.audioUrls.length && image.length ? { image: image.length === 1 ? image[0] : image } : {}),
        duration,
        response_format: "url",
        metadata: {
            resolution,
            ...(ratio ? { ratio } : {}),
            generate_audio: config.videoGenerateAudio !== "false",
            watermark: config.videoWatermark === "true",
            ...(media.videoUrls.length || media.audioUrls.length
                ? {
                      content: [
                          { type: "text", text: prompt },
                          ...image.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
                          ...media.videoUrls.map((url) => ({ type: "video_url", video_url: { url }, role: "reference_video" })),
                          ...media.audioUrls.map((url) => ({ type: "audio_url", audio_url: { url }, role: "reference_audio" })),
                      ],
                  }
                : {}),
        },
    };
    const requestUrl = buildApiUrl(config.baseUrl, "/videos");
    const reservation = await prepareProviderRequest({ requestUrl, requestPayload: body, taskId: options?.localTakeId, projectId: options?.projectId });
    const response = await axios.post<RichBestVideo>(requestUrl, body, { headers: { ...headers(options), ...reservation.headers }, signal: options?.signal });
    if (!response.data?.id) throw new Error("火山瑞池没有返回视频任务 ID");
    return response.data.id;
}

export async function pollRichBestVideoTask(config: RoutedRichBestConfig, taskId: string, options?: RequestOptions) {
    const response = await axios.get<RichBestVideo>(buildApiUrl(config.baseUrl, `/videos/${encodeURIComponent(taskId)}`), { headers: headers(options), signal: options?.signal });
    const task = response.data || {};
    const status = String(task.status || "").toLowerCase();
    if (status === "succeeded") return task.url ? { status: "completed" as const, url: task.url, mimeType: task.format === "mov" ? "video/quicktime" : "video/mp4" } : { status: "pending" as const };
    if (["failed", "canceled", "cancelled"].includes(status)) return { status: "failed" as const, error: task.error?.message || `火山瑞池视频任务${status}` };
    return { status: "pending" as const };
}

export async function verifyRichBest(channelIdValue = "richbest") {
    return (await axios.get(url(channelIdValue, "/api/auth/me"), { headers: headers() })).data;
}

export async function fetchRichBestModels(channelIdValue = "richbest") {
    return (await axios.get<{ data?: RichBestRemoteModel[] }>(url(channelIdValue, "/v1/models"), { headers: headers() })).data.data || [];
}

export async function queryRichBestUsage(input: { channelId?: string; arkApiKey: string; start: string; end: string; interval: "Hour" | "Day" }) {
    const params = new URLSearchParams({ start: input.start, end: input.end, interval: input.interval });
    return (await axios.get(`${url(input.channelId || "richbest", "/api/video/ark-usage")}?${params}`, { headers: headers(undefined, { "X-Ark-Api-Key": input.arkApiKey }) })).data;
}

export async function createRichBestAssetGroup(input: { channelId?: string; name: string; description?: string }) {
    return (await axios.post(url(input.channelId || "richbest", "/api/asset-group/create"), { name: input.name, description: input.description || "叙光素材审核" }, { headers: headers() })).data;
}

export async function uploadAndRegisterRichBestAsset(input: { channelId?: string; groupId: string; file: File; name?: string }) {
    const channel = input.channelId || "richbest";
    const form = new FormData();
    form.append("file", input.file);
    const uploaded = (await axios.post<Record<string, unknown>>(url(channel, "/api/asset/upload-file"), form, { headers: { Authorization: "Bearer server-managed" } })).data;
    const data = (uploaded.data && typeof uploaded.data === "object" ? uploaded.data : uploaded) as Record<string, unknown>;
    const body = { groupId: input.groupId, url: data.url, uploadId: data.uploadId, assetType: data.assetType, name: input.name || input.file.name };
    return (await axios.post(url(channel, "/api/asset/create"), body, { headers: headers() })).data;
}

export async function listRichBestAssets(input: { channelId?: string; groupId: string }) {
    const params = new URLSearchParams({ groupId: input.groupId, pageNumber: "1", pageSize: "50" });
    return (await axios.get(`${url(input.channelId || "richbest", "/api/asset/list")}?${params}`, { headers: headers() })).data;
}
