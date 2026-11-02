import axios, { type AxiosRequestConfig } from "axios";

import i18n from "@/i18n";
import { buildApiUrl, withLocalProxy, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

export type PluginHttpOptions = {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    responseType?: "json" | "blob" | "text" | "arraybuffer";
};

export type PluginHttp = {
    url: (path: string) => string;
    post: (path: string, body?: unknown, options?: PluginHttpOptions) => Promise<unknown>;
    get: (path: string, options?: PluginHttpOptions) => Promise<unknown>;
};

export type PluginPollOptions = { intervalMs?: number; timeoutMs?: number };

export type RunPluginArgs = {
    capability: ModelCapability;
    script: string;
    config: AiConfig;
    prompt?: string;
    images?: string[];
    videos?: string[];
    audios?: string[];
    messages?: unknown[];
    params?: Record<string, unknown>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
};

function pluginHeaders(extra?: Record<string, string>, hasJsonBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasJsonBody) headers["Content-Type"] = "application/json";
    return { ...headers, ...extra };
}

function pluginUrl(config: AiConfig, path: string) {
    if (/^https?:/i.test(path)) return withLocalProxy(path);
    return buildApiUrl(config.baseUrl, path.startsWith("/") ? path : `/${path}`);
}

function createPluginHttp(config: AiConfig, options?: RequestOptions): PluginHttp {
    const run = async (method: "get" | "post", path: string, body: unknown, opts?: PluginHttpOptions) => {
        const isForm = typeof FormData !== "undefined" && body instanceof FormData;
        const response = await axios.request({
            method,
            url: pluginUrl(config, path),
            data: method === "post" ? body : undefined,
            params: opts?.params,
            headers: pluginHeaders({ Authorization: `Bearer ${config.apiKey}`, ...opts?.headers }, method === "post" && !isForm && body !== undefined),
            responseType: opts?.responseType || "json",
            signal: options?.signal,
        });
        return response.data;
    };
    return {
        url: (path) => pluginUrl(config, path),
        post: (path, body, opts) => run("post", path, body, opts),
        get: (path, opts) => run("get", path, undefined, opts),
    };
}

/** Raw request with no automatic auth header — the script controls method, url, headers, body entirely. */
function createPluginRequest(config: AiConfig, options?: RequestOptions) {
    return async (requestConfig: AxiosRequestConfig & { url: string }) => {
        const response = await axios.request({ ...requestConfig, url: pluginUrl(config, requestConfig.url), signal: options?.signal });
        return response.data;
    };
}

function sleep(ms: number, signal?: AbortSignal) {
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

function createPoll(signal?: AbortSignal) {
    return async function poll<T, R>(request: () => Promise<T>, extract: (value: T) => R | null | undefined | false, options?: PluginPollOptions): Promise<R> {
        const intervalMs = options?.intervalMs ?? 2500;
        const timeoutMs = options?.timeoutMs ?? 300000;
        const deadline = performance.now() + timeoutMs;
        for (;;) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const result = extract(await request());
            if (result !== null && result !== undefined && result !== false) return result;
            if (performance.now() >= deadline) throw new Error(i18n.t("modelPlugin.pollTimeout"));
            await sleep(intervalMs, signal);
        }
    };
}

/**
 * Run a user-authored model call script as an async function body with flat locals (see PLUGIN_VARIABLES):
 *   prompt / images / videos / audios / messages / params — request input
 *   model / baseUrl / apiKey / systemPrompt / reasoningEffort     — current channel and text settings
 *   http / request / poll / sleep / signal / onDelta    — request helpers
 * The script must `return` the result; each caller normalizes it to its capability's shape.
 */
export async function runModelPlugin<T = unknown>(args: RunPluginArgs): Promise<T> {
    if (import.meta.env.VITE_UNSAFE_MODEL_SCRIPTS !== "true") {
        throw new Error("本地安全模式已禁用任意模型调用脚本；请使用内置调用方式。若确需二次开发，需单独审计后显式启用不安全开发者模式。");
    }
    const { config } = args;
    const http = createPluginHttp(config, { signal: args.signal });
    const request = createPluginRequest(config, { signal: args.signal });
    const poll = createPoll(args.signal);
    const runner = new Function(
        "prompt",
        "images",
        "videos",
        "audios",
        "messages",
        "params",
        "model",
        "baseUrl",
        "apiKey",
        "systemPrompt",
        "reasoningEffort",
        "http",
        "request",
        "poll",
        "sleep",
        "signal",
        "onDelta",
        `"use strict"; return (async () => {\n${args.script}\n})();`,
    ) as (...fnArgs: unknown[]) => Promise<T>;
    try {
        return await runner(
            args.prompt || "",
            args.images || [],
            args.videos || [],
            args.audios || [],
            args.messages || [],
            args.params || {},
            config.model,
            config.baseUrl,
            config.apiKey,
            config.systemPrompt || "",
            config.reasoningEffort,
            http,
            request,
            poll,
            (ms: number) => sleep(ms, args.signal),
            args.signal,
            args.onDelta,
        );
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (axios.isCancel(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(i18n.t("modelPlugin.executionFailed", { message }));
    }
}

export type PluginVariable = { name: string; type: string; desc: string; capabilities?: ModelCapability[] };

/** Documentation surface shown in the script editor. */
export function getPluginVariables(): PluginVariable[] {
    return [
        { name: "prompt", type: "string", desc: i18n.t("modelPlugin.variables.prompt"), capabilities: ["image", "video", "audio"] },
        { name: "images", type: "string[]", desc: i18n.t("modelPlugin.variables.images"), capabilities: ["image", "video"] },
        { name: "videos", type: "string[]", desc: i18n.t("modelPlugin.variables.videos"), capabilities: ["video"] },
        { name: "audios", type: "string[]", desc: i18n.t("modelPlugin.variables.audios"), capabilities: ["video"] },
        { name: "messages", type: "{ role, content }[]", desc: i18n.t("modelPlugin.variables.messages"), capabilities: ["text"] },
        { name: "params", type: "object", desc: i18n.t("modelPlugin.variables.params") },
        { name: "model", type: "string", desc: i18n.t("modelPlugin.variables.model") },
        { name: "baseUrl", type: "string", desc: i18n.t("modelPlugin.variables.baseUrl") },
        { name: "apiKey", type: "string", desc: i18n.t("modelPlugin.variables.apiKey") },
        { name: "systemPrompt", type: "string", desc: i18n.t("modelPlugin.variables.systemPrompt") },
        { name: "reasoningEffort", type: '"auto" | "low" | "medium" | "high" | "xhigh"', desc: i18n.t("modelPlugin.variables.reasoningEffort"), capabilities: ["text"] },
        { name: "http", type: "object", desc: i18n.t("modelPlugin.variables.http") },
        { name: "request", type: "function", desc: i18n.t("modelPlugin.variables.request") },
        { name: "poll", type: "function", desc: i18n.t("modelPlugin.variables.poll") },
        { name: "sleep", type: "function", desc: i18n.t("modelPlugin.variables.sleep") },
        { name: "signal", type: "AbortSignal", desc: i18n.t("modelPlugin.variables.signal") },
        { name: "onDelta", type: "function", desc: i18n.t("modelPlugin.variables.onDelta"), capabilities: ["text"] },
    ];
}

export function getPluginReturn(capability: ModelCapability) {
    return i18n.t(`modelPlugin.returns.${capability}`);
}

export function getPluginAuthoringPrompt(capability: ModelCapability, modelName: string) {
    const variables = getPluginVariables().filter((variable) => !variable.capabilities || variable.capabilities.includes(capability));
    const lines = [
        i18n.t("modelPlugin.authoring.intro", {
            capability: i18n.t(`config.channelEditor.capabilities.${capability}`),
            model: modelName || i18n.t("modelPlugin.authoring.anyModel"),
        }),
        "",
        i18n.t("modelPlugin.authoring.shape"),
        "",
        i18n.t("modelPlugin.authoring.returnTitle"),
        getPluginReturn(capability),
        "",
        i18n.t("modelPlugin.authoring.variablesTitle"),
        ...variables.map((variable) => `- ${variable.name} (${variable.type}): ${variable.desc}`),
        "",
        i18n.t("modelPlugin.authoring.rulesTitle"),
        i18n.t("modelPlugin.authoring.rules"),
    ];
    return lines.join("\n");
}

export type PluginTemplate = { label: string; script: string };

export function getPluginTemplates(): Record<ModelCapability, PluginTemplate[]> {
    return {
    image: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.imageOpenai")}
// ${i18n.t("modelPlugin.templates.availableImage")}
if (images.length === 0) {
  // ${i18n.t("modelPlugin.templates.textToImage")}
  const data = await request({
    method: "post",
    url: \`\${baseUrl}/v1/images/generations\`,
    headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
    data: { model, prompt, n: params.count, size: params.size, response_format: "b64_json" },
  });
  return (data.data || []).map((item) => item.b64_json ? \`data:image/png;base64,\${item.b64_json}\` : item.url);
}

// ${i18n.t("modelPlugin.templates.imageToImage")}
const form = new FormData();
form.set("model", model);
form.set("prompt", prompt);
form.set("n", String(params.count));
form.set("response_format", "b64_json");
const imageField = images.length > 1 ? "image[]" : "image";
for (const dataUrl of images) {
  form.append(imageField, await (await fetch(dataUrl)).blob(), "ref.png");
}
const edited = await request({
  method: "post",
  url: \`\${baseUrl}/v1/images/edits\`,
  headers: { Authorization: \`Bearer \${apiKey}\` }, // ${i18n.t("modelPlugin.templates.formDataHeader")}
  data: form,
});
return (edited.data || []).map((item) => item.b64_json ? \`data:image/png;base64,\${item.b64_json}\` : item.url);`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.imageGemini")}
// ${i18n.t("modelPlugin.templates.availableImageGemini")}
const parts = [{ text: prompt }];
for (const dataUrl of images) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
}
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"] } },
});
return (data.candidates || [])
  .flatMap((c) => c.content?.parts || [])
  .map((p) => p.inlineData || p.inline_data)
  .filter(Boolean)
  .map((img) => \`data:\${img.mimeType || img.mime_type || "image/png"};base64,\${img.data}\`);`,
        },
    ],
    video: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `/**
 * OpenAI-compatible video. images/videos/audios are data URLs.
 * params: mode ("frames" | "reference"), seconds, size, resolution, ratio,
 * generateAudio and watermark. Do not set Content-Type on FormData.
 */
const form = new FormData();
form.set("model", model);
form.set("prompt", prompt);
form.set("seconds", String(params.seconds || 8));
form.set("size", String(params.size || "1280x720"));
form.set("resolution_name", String(params.resolution || "720p"));
form.set("generate_audio", String(params.generateAudio !== false));
form.set("watermark", String(params.watermark === true));
form.set("mode", params.mode || "frames");
if (params.mode === "reference") {
  for (const source of images) form.append("image[]", await (await fetch(source)).blob(), "ref.png");
} else {
  if (images[0]) form.append("first_frame", await (await fetch(images[0])).blob(), "first.png");
  if (images[1]) form.append("last_frame", await (await fetch(images[1])).blob(), "last.png");
}
for (const source of videos) form.append("video[]", await (await fetch(source)).blob(), "ref.mp4");
for (const source of audios) form.append("audio[]", await (await fetch(source)).blob(), "ref.mp3");
const headers = { Authorization: \`Bearer \${apiKey}\` };
const task = await request({
  method: "post",
  url: \`\${baseUrl}/v1/videos\`,
  headers,
  data: form,
});
return await poll(
  () => request({ method: "get", url: \`\${baseUrl}/v1/videos/\${task.id}\`, headers }),
  (state) => {
    if (state.status === "failed" || state.status === "cancelled") throw new Error(state.error?.message || "video generation failed");
    return state.status === "completed" || state.video_url || state.url ? { url: state.video_url || state.url } : null;
  },
  { intervalMs: 2500, timeoutMs: 300000 },
);`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `/**
 * Gemini Veo video. images/videos/audios are data URLs.
 * params: mode ("frames" | "reference"), seconds, size, resolution, ratio,
 * generateAudio and watermark.
 */
const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
const inline = (source, fallback = "application/octet-stream") => {
  const match = String(source || "").match(/^data:([^;]+);base64,(.*)$/);
  return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallback };
};
const instance = { prompt };
if (params.mode === "reference") {
  instance.referenceImages = images.map((source) => ({ image: inline(source, "image/png"), referenceType: "asset" }));
} else {
  if (images[0]) instance.image = inline(images[0], "image/png");
  if (images[1]) instance.lastFrame = inline(images[1], "image/png");
}
if (videos[0]) instance.video = inline(videos[0], "video/mp4");
if (audios[0]) instance.audio = inline(audios[0], "audio/mpeg");
const op = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:predictLongRunning\`,
  headers,
  data: { instances: [instance], parameters: {
    aspectRatio: params.ratio || "16:9",
    durationSeconds: Number(params.seconds) || 8,
    resolution: params.resolution || "720p",
    generateAudio: params.generateAudio !== false,
    addWatermark: params.watermark === true,
  } },
});
return await poll(
  () => request({ method: "get", url: \`\${baseUrl}/v1beta/\${op.name}\`, headers }),
  (state) => {
    if (state.error) throw new Error(state.error.message || "video generation failed");
    if (!state.done) return null;
    const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error(${JSON.stringify(i18n.t("modelPlugin.templates.geminiNoVideoUri"))});
    return { url: uri.includes("key=") ? uri : \`\${uri}\${uri.includes("?") ? "&" : "?"}key=\${apiKey}\` };
  },
  { intervalMs: 5000, timeoutMs: 300000 },
);`,
        },
    ],
    audio: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.audioOpenai")}
return await request({
  method: "post",
  url: \`\${baseUrl}/v1/audio/speech\`,
  headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
  responseType: "blob",
  data: { model, input: prompt, voice: params.voice, response_format: params.format, speed: Number(params.speed) },
});`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.audioGemini")}
// ${i18n.t("modelPlugin.templates.availableAudioGemini")}
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } } },
    },
  },
});
const audio = data.candidates?.[0]?.content?.parts?.map((p) => p.inlineData || p.inline_data).find(Boolean);
if (!audio?.data) throw new Error(${JSON.stringify(i18n.t("modelPlugin.templates.geminiNoAudio"))});
return { data: audio.data };`,
        },
    ],
    text: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.textOpenai")}
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1/responses\`,
  headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
  data: {
    model,
    input: messages,
    ...(reasoningEffort === "auto" ? {} : { reasoning: { effort: reasoningEffort } }),
  },
});
const text = data.output_text
  || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("")
  || "";
onDelta(text);
return text;`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.textGemini")}
// ${i18n.t("modelPlugin.templates.availableTextGemini")}
const contents = messages
  .filter((m) => m.role !== "system")
  .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents, ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}) },
});
const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
onDelta(text);
return text;`,
        },
    ],
    };
}

/** Normalize whatever an image script returns into the app's generated-image shape. */
export function normalizePluginImages(result: unknown): string[] {
    const items = Array.isArray(result) ? result : [result];
    const urls = items
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                if (typeof record.dataUrl === "string") return record.dataUrl;
                if (typeof record.url === "string") return record.url;
                if (typeof record.b64_json === "string") return `data:image/png;base64,${record.b64_json}`;
            }
            return "";
        })
        .filter(Boolean);
    if (!urls.length) throw new Error(i18n.t("modelPlugin.noImages"));
    return urls;
}
