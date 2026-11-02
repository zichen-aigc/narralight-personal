import { type RunningHubGrokVideoCapabilities } from "@/lib/runninghub-grok-video";
import { type MiniMaxH3Capabilities } from "@/lib/minimax-h3-capabilities";
import { type SeedanceModelCapabilities, type SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";
import { type ApimartGrokOfficialVideoCapabilities } from "@/lib/apimart-grok-official-video";
import { type GrokApimartVideoCapabilities } from "@/lib/grok-apimart-video";
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { platformStorage } from "@/lib/platform-storage";
import { assertModelBackendSupported, isModelBackendSupported } from "@/lib/backend-model-contract";
import { isApimartGrokOfficialVideoModel } from "@/lib/apimart-grok-official-video";
import { isRunningHubGrokVideoModel } from "@/lib/runninghub-grok-video";
import i18n from "@/i18n";
import { GROK_APIMART_VIDEO_CAPABILITIES, GROK_APIMART_VIDEO_REQUEST_MODEL_ID } from "@/lib/grok-apimart-video";
import {
    APIMART_GROK_OFFICIAL_BASE_MODEL_ID,
    APIMART_GROK_OFFICIAL_15_MODEL_ID,
    APIMART_GROK_OFFICIAL_EDIT_MODEL_ID,
    APIMART_GROK_OFFICIAL_VIDEO_CAPABILITIES,
} from "@/lib/apimart-grok-official-video";
import { RUNNINGHUB_SEEDANCE_25_MODEL_ID, SEEDANCE_MODEL_CAPABILITIES } from "@/lib/seedance-model-capabilities";
import { MINIMAX_H3_CAPABILITIES } from "@/lib/minimax-h3-capabilities";
import {
    RUNNINGHUB_GROK_EDIT_MODEL_ID,
    RUNNINGHUB_GROK_EXTEND_MODEL_ID,
    RUNNINGHUB_GROK_IMAGE_MODEL_ID,
    RUNNINGHUB_GROK_REFERENCE_MODEL_ID,
    RUNNINGHUB_GROK_TEXT_MODEL_ID,
    RUNNINGHUB_GROK_VIDEO_CAPABILITIES,
} from "@/lib/runninghub-grok-video";
import { LOCAL_H3_CHANNEL_ID, LOCAL_H3_MODEL_ID } from "@/services/api/local-h3";

export type ApiCallFormat = "openai" | "gemini" | "ark";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
export type ModelProvider = "custom" | "apimart" | "volcengine-ark" | "runninghub" | "richbest" | "888api" | "local-h3";
export type ModelOperation =
    "image.generate" | "image.edit" | "video.text" | "video.image" | "video.reference" | "video.first_last" | "video.edit" | "video.extend" | "text.generate" | "audio.generate";
export type ModelParameter = "quality" | "size" | "count" | "background" | "references" | "mask" | "resolution" | "duration" | "generateAudio" | "watermark" | "reasoning";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    operations?: ModelOperation[];
    availability?: "pending_verification" | "enabled";
    publicPrice?: { rmb: number; unit: "次" | "秒"; capturedAt: string; sourceUrl: string };
    script?: string;
    aliases?: string[];
    parameters?: ModelParameter[];
    maxReferences?: number;
    price?: { rmb: number; unit: string; usdSource: number; source: string; checkedAt: string; exchangeRate: number };
    videoCapabilities?: SeedanceModelCapabilities;
    h3Capabilities?: MiniMaxH3Capabilities;
    grokVideoCapabilities?: GrokApimartVideoCapabilities;
    apimartGrokOfficialCapabilities?: ApimartGrokOfficialVideoCapabilities;
    runningHubGrokCapabilities?: RunningHubGrokVideoCapabilities;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    provider?: ModelProvider;
    credentialTarget?: string;
    modelsSource?: "document" | "live";
    modelsCheckedAt?: string;
    pricingMode?: "catalog" | "manual_required";
    models: ChannelModel[];
};

export type RichBestRemoteModel = {
    id?: string;
    modality?: string;
    capabilities?: { imageInput?: boolean; vision?: boolean };
    maxInputImages?: number;
    maxN?: number;
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoReferenceMode: SeedanceReferenceMode;
    videoOutputFormat: "mp4" | "mov";
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    proxyEnabled: boolean;
};

export type LastGenerationSettings = {
    image?: Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count" | "background">;
    video?: Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoOutputFormat">;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "local-proxy" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const APIMART_BASE_URL = "https://api.apimart.ai/v1";
const RUNNINGHUB_BASE_URL = "https://www.runninghub.ai/openapi/v2";
const RICHBEST_BASE_URL = "https://api.richbest.cn";
const API888_BASE_URL = "https://888api.xin";
export const API888_CHANNEL_ID = "888api";
export const RICHBEST_CHANNEL_ID = "richbest";

const RICHBEST_MODEL_ALIASES: Record<string, string> = {
    "seedream-5.0-pro": "doubao-seedream-5.0-pro",
    "seedream-5.0-lite": "doubao-seedream-5.0-lite",
    "seedream-5.0": "doubao-seedream-5.0",
    "seedream-4.5": "doubao-seedream-4.5",
    "seedream-4.0": "doubao-seedream-4.0",
    "seedance-2.5": "doubao-seedance-2.5",
    "seedance-2.0": "doubao-seedance-2.0",
    "seedance-2.0-fast": "doubao-seedance-2.0-fast",
    "seedance-2.0-mini": "doubao-seedance-2.0-mini",
    "seedance-1.5-pro": "doubao-seedance-1.5-pro",
    "seedance-1.0-pro": "doubao-seedance-1.0-pro",
    "seedance-1.0-pro-fast": "doubao-seedance-1.0-pro-fast",
};

export function canonicalRichBestModelId(value: string) {
    const model = String(value || "").trim();
    return RICHBEST_MODEL_ALIASES[model] || model;
}
export const RUNNINGHUB_CHANNEL_ID = "runninghub";
export const RUNNINGHUB_CREDENTIAL_TARGET = "RUNNINGHUB_API_KEY";
export const VOLCENGINE_ARK_GX_CHANNEL_ID = "volcengine-ark-gx";
export const VOLCENGINE_ARK_GX_CREDENTIAL_TARGET = "VOLCENGINE_ARK_GX_API_KEY";
export const VOLCENGINE_ARK_GX_MODEL_IDS = [
    "doubao-seedance-2-5-260628",
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
    "doubao-seedance-1-5-pro-251215",
] as const;

const MODEL_DISPLAY_ORDER = [
    "gpt-image-2",
    "gpt-image-2-official",
    "doubao-seedream-5-0-pro",
    "doubao-seedream-5-0-lite",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-lite-image",
    "midjourney",
    "doubao-seedance-4-5",
    "doubao-seedance-2-5-260628",
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-2.5",
    RUNNINGHUB_SEEDANCE_25_MODEL_ID,
    "doubao-seedance-2.0",
    "doubao-seedance-2.0-fast",
    "doubao-seedance-2.0-mini",
    "doubao-seedance-1-5-pro",
    "kling-v3",
    LOCAL_H3_MODEL_ID,
    "MiniMax-H3",
    "wan2.7",
    "veo3.1-fast",
    "veo3.1-quality",
    "veo3.1-lite",
    "grok-imagine-1.5-video-apimart",
    APIMART_GROK_OFFICIAL_15_MODEL_ID,
    APIMART_GROK_OFFICIAL_BASE_MODEL_ID,
    APIMART_GROK_OFFICIAL_EDIT_MODEL_ID,
    RUNNINGHUB_GROK_TEXT_MODEL_ID,
    RUNNINGHUB_GROK_IMAGE_MODEL_ID,
    RUNNINGHUB_GROK_REFERENCE_MODEL_ID,
    RUNNINGHUB_GROK_EDIT_MODEL_ID,
    RUNNINGHUB_GROK_EXTEND_MODEL_ID,
    "gpt-5",
    "gpt-5.1",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview-thinking",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gpt-4o-mini-tts",
];

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
    "gpt-image-2": "GPT Image 2",
    "gpt-image-2-official": "GPT Image 2 官方版",
    "gemini-3-pro-image-preview": "Gemini 3 Pro Image",
    "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image",
    "gemini-3.1-flash-lite-image": "Gemini 3.1 Flash Lite Image",
    midjourney: "Midjourney",
    "doubao-seedance-4-5": "Seedream 4.5",
    "doubao-seedream-5-0-lite": "Seedream 5.0 Lite",
    "doubao-seedream-5-0-pro": "Seedream 5.0 Pro",
    "doubao-seedream-5.0": "Seedream 5.0",
    "doubao-seedream-5.0-lite": "Seedream 5.0 Lite",
    "doubao-seedream-5.0-pro": "Seedream 5.0 Pro",
    "doubao-seedream-4.5": "Seedream 4.5",
    "doubao-seedream-4.0": "Seedream 4.0",
    "doubao-seedance-2-5-260628": "Seedance 2.5",
    "doubao-seedance-2-0-260128": "Seedance 2.0",
    "doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast",
    "doubao-seedance-2-0-mini-260615": "Seedance 2.0 Mini",
    "doubao-seedance-1-5-pro-251215": "Seedance 1.5 Pro",
    "doubao-seedance-2.5": "Seedance 2.5",
    "doubao-seedance-2.0": "Seedance 2.0",
    "doubao-seedance-2.0-fast": "Seedance 2.0 Fast",
    "doubao-seedance-2.0-mini": "Seedance 2.0 Mini",
    "doubao-seedance-1-5-pro": "Seedance 1.5 Pro",
    "MiniMax-H3": "MiniMax H3",
    [LOCAL_H3_MODEL_ID]: "MiniMax H3 Base · 本机免费",
    "kling-v3": "Kling 3",
    "wan2.7": "Wan 2.7",
    "veo3.1-fast": "Veo 3.1 Fast",
    "veo3.1-quality": "Veo 3.1 Quality",
    "veo3.1-lite": "Veo 3.1 Lite",
    "grok-imagine-1.5-video-apimart": "Grok 1.5 视频",
    [APIMART_GROK_OFFICIAL_15_MODEL_ID]: "Grok 1.5 官方 · 文生/多图参考",
    [APIMART_GROK_OFFICIAL_BASE_MODEL_ID]: "Grok 官方 · 文生/多图参考",
    [APIMART_GROK_OFFICIAL_EDIT_MODEL_ID]: "Grok 官方 · 视频编辑",
    [RUNNINGHUB_SEEDANCE_25_MODEL_ID]: "Seedance 2.5",
    [RUNNINGHUB_GROK_TEXT_MODEL_ID]: "Grok 1.5 文生视频",
    [RUNNINGHUB_GROK_IMAGE_MODEL_ID]: "Grok 1.5 单图生视频",
    [RUNNINGHUB_GROK_REFERENCE_MODEL_ID]: "Grok 1.5 多图参考",
    [RUNNINGHUB_GROK_EDIT_MODEL_ID]: "Grok 视频编辑",
    [RUNNINGHUB_GROK_EXTEND_MODEL_ID]: "Grok 视频续写",
    "gpt-5": "GPT-5",
    "gpt-5.1": "GPT-5.1",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-6": "Claude Opus 4.6",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "gemini-3-pro-preview": "Gemini 3 Pro",
    "gemini-3-pro-preview-thinking": "Gemini 3 Pro Thinking",
    "gemini-3-flash-preview": "Gemini 3 Flash",
    "gpt-4o-mini-tts": "GPT-4o Mini TTS",
};

const imageParameters: ModelParameter[] = ["quality", "size", "count", "references"];
const videoParameters: ModelParameter[] = ["resolution", "size", "duration", "references"];
export const APIMART_MODELS: ChannelModel[] = [
    { name: "gpt-image-2", capability: "image", aliases: ["gpt-image-2-ext"], parameters: imageParameters, maxReferences: 16 },
    { name: "gpt-image-2-official", capability: "image", parameters: imageParameters, maxReferences: 16 },
    { name: "gemini-3-pro-image-preview", capability: "image", parameters: imageParameters, maxReferences: 14 },
    { name: "gemini-3.1-flash-image-preview", capability: "image", parameters: imageParameters, maxReferences: 14 },
    { name: "gemini-3.1-flash-lite-image", capability: "image", parameters: ["size", "count", "references"], maxReferences: 14 },
    { name: "midjourney", capability: "image", parameters: ["size", "count", "references"], maxReferences: 8 },
    { name: "doubao-seedance-4-5", capability: "image", aliases: ["doubao-seedream-4-5", "doubao-seedream-4-5-251128"], parameters: ["size", "count", "references"], maxReferences: 10 },
    { name: "doubao-seedream-5-0-lite", capability: "image", parameters: ["size", "count", "references"], maxReferences: 10 },
    { name: "doubao-seedream-5-0-pro", capability: "image", aliases: ["seedream-5-0-pro", "seedream-5.0-pro"], parameters: ["quality", "size", "references"], maxReferences: 10 },
    {
        name: "doubao-seedance-2.5",
        aliases: ["seedance-2.5"],
        capability: "video",
        parameters: [...videoParameters, "generateAudio", "watermark"],
        maxReferences: 30,
        videoCapabilities: SEEDANCE_MODEL_CAPABILITIES["doubao-seedance-2.5"],
    },
    {
        name: "doubao-seedance-2.0",
        capability: "video",
        parameters: [...videoParameters, "generateAudio", "watermark"],
        maxReferences: 9,
        videoCapabilities: SEEDANCE_MODEL_CAPABILITIES["doubao-seedance-2.0"],
    },
    {
        name: "doubao-seedance-2.0-fast",
        capability: "video",
        parameters: [...videoParameters, "generateAudio", "watermark"],
        maxReferences: 9,
        videoCapabilities: SEEDANCE_MODEL_CAPABILITIES["doubao-seedance-2.0-fast"],
    },
    {
        name: "doubao-seedance-2.0-mini",
        capability: "video",
        parameters: [...videoParameters, "generateAudio", "watermark"],
        maxReferences: 9,
        videoCapabilities: SEEDANCE_MODEL_CAPABILITIES["doubao-seedance-2.0-mini"],
    },
    { name: "doubao-seedance-1-5-pro", capability: "video", parameters: [...videoParameters, "watermark"], maxReferences: 2 },
    { name: "MiniMax-H3", capability: "video", parameters: videoParameters, maxReferences: 9, h3Capabilities: MINIMAX_H3_CAPABILITIES },
    { name: "kling-v3", capability: "video", parameters: [...videoParameters, "generateAudio"], maxReferences: 4 },
    { name: "wan2.7", capability: "video", parameters: videoParameters, maxReferences: 2 },
    { name: "veo3.1-fast", capability: "video", parameters: [...videoParameters, "generateAudio"], maxReferences: 3 },
    { name: "veo3.1-quality", capability: "video", parameters: ["resolution", "size", "duration", "generateAudio"], maxReferences: 0 },
    { name: "veo3.1-lite", capability: "video", parameters: ["resolution", "size", "duration"], maxReferences: 0 },
    {
        name: "grok-imagine-1.5-video-apimart",
        capability: "video",
        aliases: [GROK_APIMART_VIDEO_REQUEST_MODEL_ID],
        parameters: ["resolution", "size", "duration", "references"],
        maxReferences: 7,
        grokVideoCapabilities: GROK_APIMART_VIDEO_CAPABILITIES,
    },
    ...[APIMART_GROK_OFFICIAL_BASE_MODEL_ID, APIMART_GROK_OFFICIAL_15_MODEL_ID, APIMART_GROK_OFFICIAL_EDIT_MODEL_ID].map((name): ChannelModel => {
        const capability = APIMART_GROK_OFFICIAL_VIDEO_CAPABILITIES[name];
        return {
            name,
            capability: "video",
            aliases: capability.workflow === "generate" ? [capability.requestModel] : undefined,
            parameters: capability.workflow === "generate" ? ["resolution", "size", "duration", "references"] : ["references"],
            maxReferences: Math.max(capability.references.images, capability.references.videos),
            apimartGrokOfficialCapabilities: capability,
        };
    }),
    { name: "gpt-5", capability: "text", parameters: ["reasoning"] },
    { name: "gpt-5.1", capability: "text", parameters: ["reasoning"] },
    { name: "claude-opus-4-8", capability: "text", parameters: ["reasoning"] },
    { name: "claude-opus-4-7", capability: "text", parameters: ["reasoning"] },
    { name: "claude-opus-4-6", capability: "text", parameters: ["reasoning"] },
    { name: "gemini-3.5-flash", capability: "text", parameters: ["reasoning"] },
    { name: "gemini-3.1-pro-preview", capability: "text", parameters: ["reasoning"] },
    { name: "gemini-3-pro-preview", capability: "text", parameters: ["reasoning"] },
    { name: "gemini-3-pro-preview-thinking", capability: "text", parameters: ["reasoning"] },
    { name: "gemini-3-flash-preview", capability: "text", parameters: ["reasoning"] },
    { name: "gpt-4o-mini-tts", capability: "audio" },
];

export const VOLCENGINE_ARK_GX_MODELS: ChannelModel[] = VOLCENGINE_ARK_GX_MODEL_IDS.map((name) => {
    const videoCapabilities = SEEDANCE_MODEL_CAPABILITIES[name];
    return { name, capability: "video", parameters: [...videoParameters, "generateAudio", "watermark"], maxReferences: videoCapabilities.references.images, videoCapabilities };
});
export const RUNNINGHUB_MODELS: ChannelModel[] = [
    {
        name: RUNNINGHUB_SEEDANCE_25_MODEL_ID,
        capability: "video",
        parameters: [...videoParameters, "generateAudio", "watermark"],
        maxReferences: 30,
        videoCapabilities: SEEDANCE_MODEL_CAPABILITIES[RUNNINGHUB_SEEDANCE_25_MODEL_ID],
    },
    ...[RUNNINGHUB_GROK_TEXT_MODEL_ID, RUNNINGHUB_GROK_IMAGE_MODEL_ID, RUNNINGHUB_GROK_REFERENCE_MODEL_ID, RUNNINGHUB_GROK_EDIT_MODEL_ID, RUNNINGHUB_GROK_EXTEND_MODEL_ID].map((name): ChannelModel => {
        const capability = RUNNINGHUB_GROK_VIDEO_CAPABILITIES[name];
        const parameters: ModelParameter[] = [
            ...(capability.resolutions.length ? ["resolution" as const] : []),
            ...(capability.ratios.length ? ["size" as const] : []),
            ...(capability.workflow === "video_edit" ? [] : ["duration" as const]),
            ...(capability.references.images || capability.references.videos ? ["references" as const] : []),
        ];

        return { name, capability: "video", parameters, maxReferences: Math.max(capability.references.images, capability.references.videos), runningHubGrokCapabilities: capability };
    }),
];

export const RICHBEST_MODELS: ChannelModel[] = [
    ...["deepseek-v4-flash", "glm-5.2", "doubao-seed-2.1-pro", "doubao-seed-2.0-pro", "doubao-seed-2.0-lite", "doubao-seed-2.0-mini"].map((name): ChannelModel => ({ name, capability: "text" })),
    { name: "doubao-seedream-5.0-pro", capability: "image", parameters: ["size", "references"], maxReferences: 10 },
    { name: "doubao-seedream-5.0-lite", capability: "image", parameters: ["size", "count", "references"], maxReferences: 10 },
    { name: "doubao-seedream-4.5", capability: "image", parameters: ["size", "count", "references"], maxReferences: 10 },
    { name: "doubao-seedream-4.0", capability: "image", parameters: ["size", "count", "references"], maxReferences: 10 },
    { name: "image2.0", capability: "image", parameters: ["size"] },
    ...[
        "doubao-seedance-2.5",
        "doubao-seedance-2.0",
        "doubao-seedance-2.0-fast",
        "doubao-seedance-2.0-mini",
        "doubao-seedance-1.5-pro",
        "doubao-seedance-1.0-pro",
        "doubao-seedance-1.0-pro-fast",
        "wan3.0-video",
        "minimax-h3",
    ].map((name): ChannelModel => ({ name, capability: "video", parameters: ["resolution", "size", "duration", "references"], maxReferences: 10 })),
];

const RICHBEST_LIVE_MODEL_PRESETS: ChannelModel[] = [{ name: "doubao-seedream-5.0", capability: "image", parameters: ["size", "count", "references"], maxReferences: 10 }];

export function createApimartChannel(): ModelChannel {
    return {
        id: "apimart",
        name: "APIMart",
        baseUrl: APIMART_BASE_URL,
        apiKey: "server-managed",
        apiFormat: "openai",
        provider: "apimart",
        credentialTarget: "MG_API_KEY",
        models: APIMART_MODELS.filter((model) => !isApimartGrokOfficialVideoModel(model.name)).map(cloneChannelModel),
    };
}

export function createVolcengineArkGxChannel(): ModelChannel {
    return {
        id: VOLCENGINE_ARK_GX_CHANNEL_ID,
        name: "火山在线推理（广西）",
        baseUrl: ARK_BASE_URL,
        apiKey: "server-managed",
        apiFormat: "ark",
        provider: "volcengine-ark",
        credentialTarget: VOLCENGINE_ARK_GX_CREDENTIAL_TARGET,
        models: VOLCENGINE_ARK_GX_MODELS.map(cloneChannelModel),
    };
}

export function createRunningHubChannel(): ModelChannel {
    return {
        id: RUNNINGHUB_CHANNEL_ID,
        name: "RunningHub",
        baseUrl: RUNNINGHUB_BASE_URL,
        apiKey: "server-managed",
        apiFormat: "openai",
        provider: "runninghub",
        credentialTarget: RUNNINGHUB_CREDENTIAL_TARGET,
        models: RUNNINGHUB_MODELS.map(cloneChannelModel),
    };
}

export function createRichBestChannel(): ModelChannel {
    return {
        id: RICHBEST_CHANNEL_ID,
        name: "火山瑞池",
        baseUrl: RICHBEST_BASE_URL,
        apiKey: "",
        apiFormat: "openai",
        provider: "richbest",
        modelsSource: "document",
        pricingMode: "catalog",
        models: RICHBEST_MODELS.map(cloneChannelModel),
    };
}

export function create888ApiChannel(): ModelChannel {
    const price = (rmb: number, unit: "次" | "秒") => ({ rmb, unit, capturedAt: "2026-10-24", sourceUrl: "https://888api.xin/api/pricing" });
    return {
        id: API888_CHANNEL_ID,
        name: "888API · 待验证",
        baseUrl: API888_BASE_URL,
        apiKey: "server-managed",
        apiFormat: "openai",
        provider: "888api",
        credentialTarget: "888API_API_KEY",
        modelsSource: "document",
        pricingMode: "manual_required",
        models: [
            { name: "gpt-image-2", capability: "image", operations: ["image.generate"], availability: "pending_verification", publicPrice: price(0.05, "次"), parameters: ["size", "count"] },
            {
                name: "wan3.0-video",
                capability: "video",
                operations: ["video.text", "video.image", "video.reference"],
                availability: "pending_verification",
                publicPrice: price(0.22, "秒"),
                parameters: ["size", "duration"],
            },
            {
                name: "seedance2.0-933-economy",
                capability: "video",
                operations: ["video.text", "video.image", "video.reference"],
                availability: "pending_verification",
                publicPrice: price(5, "次"),
                parameters: ["size", "duration"],
            },
        ],
    };
}

export function createLocalH3Channel(): ModelChannel {
    return {
        id: LOCAL_H3_CHANNEL_ID,
        name: "本机 H3 Worker",
        baseUrl: "/api/local/h3",
        apiKey: "server-managed",
        apiFormat: "openai",
        provider: "local-h3",
        models: [{ name: LOCAL_H3_MODEL_ID, capability: "video", parameters: [], maxReferences: 0 }],
    };
}

export function applyRichBestAuthorizedModels(channel: ModelChannel, remoteModels: RichBestRemoteModel[], checkedAt = new Date().toISOString()): ModelChannel {
    const documented = new Map([...RICHBEST_MODELS, ...RICHBEST_LIVE_MODEL_PRESETS].map((model) => [model.name, model]));
    const seen = new Set<string>();
    const models = remoteModels.flatMap((remote) => {
        const name = canonicalRichBestModelId(String(remote.id || "").trim());
        if (!name || seen.has(name)) return [];
        seen.add(name);
        const preset = documented.get(name) || documented.get(name.replace(/^doubao-/, ""));
        if (preset) return [{ ...cloneChannelModel(preset), name }];
        const modality = String(remote.modality || "").toLowerCase();
        if (!(["video", "image", "audio", "text"] as string[]).includes(modality)) return [];
        const capability = modality as ModelCapability;
        return [{ name, capability }];
    });
    return {
        ...channel,
        id: RICHBEST_CHANNEL_ID,
        baseUrl: RICHBEST_BASE_URL,
        apiFormat: "openai",
        provider: "richbest",
        credentialTarget: undefined,
        modelsSource: "live",
        modelsCheckedAt: checkedAt,
        pricingMode: "catalog",
        models,
    };
}

const DEFAULT_CHANNELS = [createApimartChannel(), createVolcengineArkGxChannel(), createRunningHubChannel(), createRichBestChannel(), create888ApiChannel(), createLocalH3Channel()];

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: APIMART_BASE_URL,
    apiKey: "server-managed",
    apiFormat: "openai",
    channels: DEFAULT_CHANNELS,
    model: "apimart::gpt-image-2",
    imageModel: "apimart::gpt-image-2",
    videoModel: "apimart::doubao-seedance-2.0",
    textModel: "apimart::gpt-5",
    audioModel: "apimart::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoReferenceMode: "omni",
    videoOutputFormat: "mp4",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: modelOptionsFromChannels(DEFAULT_CHANNELS),
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    proxyEnabled: false,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    lastGenerationSettings: LastGenerationSettings;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    rememberGenerationSettings: (capability: "image" | "video", config: AiConfig) => void;
    applyLastGenerationSettings: (capability: "image" | "video") => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelProfileOf(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel =
        capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    // Preserve a historical official identity; the creation gate explains unavailability.
    // Falling back here would silently submit the same prompt to a different model.
    if (capability === "video" && (isApimartGrokOfficialVideoModel(currentModel) || isRunningHubGrokVideoModel(currentModel))) return currentModel!;
    if (capability === "video" && !currentModel && (isApimartGrokOfficialVideoModel(defaultModel) || isRunningHubGrokVideoModel(defaultModel))) return defaultModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;

    return fallbackModel;
}

export function resolveCanvasNodeModelForPresentation(config: AiConfig, persistedModel: string | undefined, capability: ModelCapability) {
    return persistedModel || resolveModelForCapability(config, persistedModel, capability);
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    const options = capability
        ? config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)))
        : config.models;
    return [...options].filter(isModelBackendSupported).sort((a, b) => modelSortRank(a) - modelSortRank(b));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (!isModelBackendSupported(model)) return false;
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (channel.apiKey.trim() || channel.credentialTarget?.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            lastGenerationSettings: {},
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) => {
                if (["model", "videoModel", "imageModel", "audioModel", "textModel"].includes(key) && value !== get().config[key]) assertModelBackendSupported(String(value));
                if (key === "channels") {
                    const previous = new Set(get().config.channels.flatMap((channel) => channel.models.map((model) => `${channel.id}::${model.name}`)));
                    for (const channel of value as ModelChannel[])
                        for (const model of normalizeChannelModels(channel.models)) if (!previous.has(`${channel.id}::${model.name}`)) assertModelBackendSupported(model.name);
                }
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                }));
            },
            rememberGenerationSettings: (capability, source) =>
                set((state) => ({
                    lastGenerationSettings: {
                        ...state.lastGenerationSettings,
                        [capability]:
                            capability === "image"
                                ? {
                                      model: source.imageModel || source.model,
                                      imageModel: source.imageModel || source.model,
                                      quality: source.quality,
                                      size: source.size,
                                      count: source.count,
                                      background: source.background,
                                  }
                                : {
                                      model: source.videoModel || source.model,
                                      videoModel: source.videoModel || source.model,
                                      size: source.size,
                                      vquality: source.vquality,
                                      videoSeconds: source.videoSeconds,
                                      videoGenerateAudio: source.videoGenerateAudio,
                                      videoWatermark: source.videoWatermark,
                                      videoOutputFormat: source.videoOutputFormat,
                                  },
                    },
                })),
            applyLastGenerationSettings: (capability) => set((state) => ({ config: applyLastGenerationSettings(state.config, state.lastGenerationSettings, capability) })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            storage: createJSONStorage(() => platformStorage),
            skipHydration: true,
            partialize: (state) => ({ config: state.config, webdav: state.webdav, lastGenerationSettings: state.lastGenerationSettings }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const lastGenerationSettings = persistedState.lastGenerationSettings || {};
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const normalizedChannels = normalizeChannels(config);
                const channels = normalizedChannels;
                const models = modelOptionsFromChannels(channels);
                const pick = (value: string | undefined, capability: ModelCapability) => {
                    if (capability === "video" && isApimartGrokOfficialVideoModel(value)) return value!;
                    const normalized = normalizeModelOptionValue(value, channels);
                    const decoded = decodeChannelModel(normalized);
                    const channel = decoded ? channels.find((item) => item.id === decoded.channelId) : undefined;
                    if (normalized && channel && (channel.apiKey || channel.credentialTarget) && modelCapabilityOf({ ...config, channels } as AiConfig, normalized) === capability) return normalized;
                    return (
                        channels
                            .flatMap((item) => item.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(item.id, model.name)))
                            .find((option) => {
                                const selected = decodeChannelModel(option);
                                const selectedChannel = channels.find((item) => item.id === selected?.channelId);
                                return Boolean(selectedChannel?.apiKey || selectedChannel?.credentialTarget);
                            }) || ""
                    );
                };
                const imageModel = pick(config.imageModel || config.model, "image");
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    lastGenerationSettings,
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        model: imageModel,
                        imageModel,
                        videoModel: pick(config.videoModel, "video"),
                        textModel: pick(config.textModel || config.model, "text"),
                        audioModel: pick(config.audioModel || defaultConfig.audioModel, "audio"),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoReferenceMode: config.videoReferenceMode || "omni",
                        videoOutputFormat: config.videoOutputFormat === "mov" ? "mov" : "mp4",
                        canvasImageCount: config.canvasImageCount || "3",
                        proxyEnabled: Boolean(config.proxyEnabled),
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);

    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config, false]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const aliases = typeof item === "string" ? undefined : Array.from(new Set((item.aliases || []).map((value) => value.trim()).filter(Boolean)));
        const parameters = typeof item === "string" ? undefined : item.parameters ? Array.from(new Set(item.parameters)) : undefined;
        const maxReferences = typeof item === "string" ? undefined : Number.isFinite(item.maxReferences) ? Math.max(0, Math.floor(item.maxReferences || 0)) : undefined;
        const price = typeof item === "string" ? undefined : item.price;
        const videoCapabilities = typeof item === "string" ? undefined : item.videoCapabilities;
        const h3Capabilities = typeof item === "string" ? undefined : item.h3Capabilities;
        const grokVideoCapabilities = typeof item === "string" ? undefined : item.grokVideoCapabilities;
        const apimartGrokOfficialCapabilities = typeof item === "string" ? undefined : item.apimartGrokOfficialCapabilities;
        const runningHubGrokCapabilities = typeof item === "string" ? undefined : item.runningHubGrokCapabilities;
        result.push({
            name,
            capability,
            script,
            aliases: aliases?.length ? aliases : undefined,
            parameters,
            maxReferences,
            price,
            videoCapabilities,
            h3Capabilities,
            grokVideoCapabilities,
            apimartGrokOfficialCapabilities,
            runningHubGrokCapabilities,
        });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        provider: channel?.provider || "custom",
        credentialTarget: channel?.credentialTarget?.trim() || undefined,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return friendlyModelName(value);
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const model = channel?.models.find((item) => item.name === decoded.model);
    const price =
        model?.price && Number.isFinite(model.price.rmb)
            ? ` · ${model.price.rmb}`
            : model?.videoCapabilities?.pricing.status === "pending_sync"
              ? ` · ${i18n.t("settingsPanels.video.pricePending")}`
              : "";
    return `${friendlyModelName(decoded.model)}${price}`;
}

export function modelOptionDetails(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : undefined;
    const rawName = decoded?.model || value;
    return { name: friendlyModelName(rawName), rawName, channelName: channel?.name || "" };
}

export function generationConfigWithLastSettings(config: AiConfig, last: LastGenerationSettings, capability: "image" | "video") {
    return applyLastGenerationSettings(config, last, capability);
}

export function imageGenerationCountWithLastSettings(config: AiConfig, last: LastGenerationSettings) {
    return last.image?.count || config.canvasImageCount || config.count || defaultConfig.count;
}

function friendlyModelName(name: string) {
    return FRIENDLY_MODEL_NAMES[name] || name;
}

function modelSortRank(value: string) {
    const rank = MODEL_DISPLAY_ORDER.indexOf(modelOptionName(value));
    return rank < 0 ? MODEL_DISPLAY_ORDER.length : rank;
}

function applyLastGenerationSettings(config: AiConfig, last: LastGenerationSettings, capability: "image" | "video"): AiConfig {
    const snapshot = last[capability];
    if (capability === "image") {
        const image = snapshot as LastGenerationSettings["image"];
        const model = image?.imageModel || config.imageModel;
        return { ...config, ...image, model, imageModel: model };
    }
    const video = snapshot as LastGenerationSettings["video"];
    const model = video?.videoModel || config.videoModel;
    return { ...config, ...video, model, videoModel: model, videoReferenceMode: "omni" };
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        const normalizedModel = channel?.provider === RICHBEST_CHANNEL_ID ? canonicalRichBestModelId(decoded.model) : decoded.model;
        return channel && channel.models.some((item) => item.name === normalizedModel) ? encodeChannelModel(channel.id, normalizedModel) : "";
    }
    const channel =
        channels.find((item) => item.models.some((entry) => entry.name === model || (item.provider === RICHBEST_CHANNEL_ID && entry.name === canonicalRichBestModelId(model)))) || channels[0];
    const normalizedModel = channel?.provider === RICHBEST_CHANNEL_ID ? canonicalRichBestModelId(model) : model;
    return channel && channel.models.some((item) => item.name === normalizedModel) ? encodeChannelModel(channel.id, normalizedModel) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return (
        matched ||
        config.channels[0] ||
        createModelChannel({
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            apiFormat: config.apiFormat,
            models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })),
        })
    );
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const model = channel.provider === RICHBEST_CHANNEL_ID ? canonicalRichBestModelId(modelOptionName(value || config.model)) : modelOptionName(value || config.model);
    const profile = channel.models.find((entry) => entry.name === model);
    return {
        ...config,
        model,
        baseUrl: `/api/local/ai/${encodeURIComponent(channel.id)}`,
        apiKey: "server-managed",
        apiFormat: channel.apiFormat,
        provider: channel.provider || "custom",
        modelProfile: profile,
    };
}

export function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) => {
        const provider =
            channel.provider ||
            (channel.id === "apimart"
                ? "apimart"
                : channel.id === API888_CHANNEL_ID
                  ? "888api"
                  : channel.id === LOCAL_H3_CHANNEL_ID
                    ? "local-h3"
                    : channel.id === VOLCENGINE_ARK_GX_CHANNEL_ID
                      ? "volcengine-ark"
                      : channel.id === RUNNINGHUB_CHANNEL_ID
                        ? "runninghub"
                        : "custom");
        if (provider === "volcengine-ark") return mergeVolcengineArkGxChannel(channel);
        if (provider === "runninghub") return mergeRunningHubChannel(channel);
        if (provider === "richbest") return mergeRichBestChannel(channel);
        if (provider === "888api") return create888ApiChannel();
        if (provider === "local-h3") return createLocalH3Channel();
        return createModelChannel({
            ...channel,
            provider,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: provider === "apimart" ? mergeApimartModels(channel.models) : normalizeChannelModels(channel.models),
        });
    });
    if (!channels.some((channel) => channel.id === "apimart" || channel.provider === "apimart")) channels.push(createApimartChannel());
    if (!channels.some((channel) => channel.id === VOLCENGINE_ARK_GX_CHANNEL_ID || channel.provider === "volcengine-ark")) channels.push(createVolcengineArkGxChannel());
    if (!channels.some((channel) => channel.id === RUNNINGHUB_CHANNEL_ID || channel.provider === "runninghub")) channels.push(createRunningHubChannel());
    if (!channels.some((channel) => channel.id === RICHBEST_CHANNEL_ID || channel.provider === "richbest")) channels.push(createRichBestChannel());
    if (!channels.some((channel) => channel.id === API888_CHANNEL_ID || channel.provider === "888api")) channels.push(create888ApiChannel());
    // Preserve every persisted channel's existing index: legacy callers and migrations
    // may still carry index-based references. The built-in local channel is additive.
    if (!channels.some((channel) => channel.id === LOCAL_H3_CHANNEL_ID || channel.provider === "local-h3")) channels.push(createLocalH3Channel());
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

function mergeVolcengineArkGxChannel(channel: ModelChannel) {
    const preset = createVolcengineArkGxChannel();
    return { ...preset, name: channel.name?.trim() || preset.name };
}

function mergeApimartModels(models: Array<string | ChannelModel> | undefined) {
    const persisted = normalizeChannelModels(models);
    const builtins = new Map(APIMART_MODELS.map((model) => [model.name, model]));
    const merged = persisted.map((model) => {
        const builtin = builtins.get(model.name);
        if (!builtin) return model;
        builtins.delete(model.name);
        return {
            ...cloneChannelModel(builtin),
            ...model,
            aliases: builtin.aliases ? [...builtin.aliases] : model.aliases,
            parameters: builtin.parameters ? [...builtin.parameters] : model.parameters,
            maxReferences: builtin.maxReferences,
            videoCapabilities: builtin.videoCapabilities,
            h3Capabilities: builtin.h3Capabilities,
            grokVideoCapabilities: builtin.grokVideoCapabilities,
            apimartGrokOfficialCapabilities: builtin.apimartGrokOfficialCapabilities,
            runningHubGrokCapabilities: builtin.runningHubGrokCapabilities,
            ...(builtin.apimartGrokOfficialCapabilities ? { price: undefined } : {}),
        };
    });
    return [
        ...merged,
        ...Array.from(builtins.values())
            .filter((model) => !isApimartGrokOfficialVideoModel(model.name))
            .map(cloneChannelModel),
    ];
}

function cloneChannelModel(model: ChannelModel): ChannelModel {
    return { ...model, aliases: model.aliases ? [...model.aliases] : undefined, parameters: model.parameters ? [...model.parameters] : undefined };
}

function mergeRunningHubChannel(channel: ModelChannel) {
    const preset = createRunningHubChannel();
    return { ...preset, name: channel.name?.trim() || preset.name };
}

function mergeRichBestChannel(channel: ModelChannel): ModelChannel {
    const preset = createRichBestChannel();
    const existing = new Map(normalizeChannelModels(channel.models).map((model) => [canonicalRichBestModelId(model.name), { ...model, name: canonicalRichBestModelId(model.name) }]));
    const models =
        channel.modelsSource === "live"
            ? Array.from(existing.values()).map((model) => {
                  const documented = RICHBEST_MODELS.find((item) => item.name === model.name);
                  return documented ? { ...model, ...cloneChannelModel(documented) } : model;
              })
            : preset.models.map((model) => ({ ...model, ...existing.get(model.name), capability: model.capability, parameters: model.parameters, maxReferences: model.maxReferences }));
    return {
        ...preset,
        ...channel,
        id: RICHBEST_CHANNEL_ID,
        name: channel.name?.trim() || preset.name,
        baseUrl: RICHBEST_BASE_URL,
        apiFormat: "openai",
        provider: "richbest",
        credentialTarget: undefined,
        pricingMode: "catalog",
        models,
    };
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "ark") return ARK_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "ark" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl =
        lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") || lowerBaseUrl.endsWith("/openapi/v2")
            ? normalizedBaseUrl
            : `${normalizedBaseUrl}/v1`;
    return withLocalProxy(`${apiBaseUrl}${path}`);
}

/** Route absolute external requests through the existing Local Platform when local proxying is enabled. */
export function withLocalProxy(url: string) {
    if (!useConfigStore.getState().config.proxyEnabled || !/^https?:\/\//i.test(url)) return url;
    return `/api/local/network-proxy?url=${encodeURIComponent(url)}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
