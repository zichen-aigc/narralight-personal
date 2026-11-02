import { isIP } from "node:net";

const MB = 1024 * 1024;
const RATIOS = new Set(["16:9", "1:1", "9:16", "3:2", "2:3"]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const KNOWN_MEDIA_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "avif", "mp4", "mov", "webm", "mkv", "avi"]);
const RESOLUTION_RATES_MICRORMB = new Map([
    ["text_to_video:480p", 560_000],
    ["text_to_video:720p", 980_000],
    ["text_to_video:1080p", 1_750_000],
    ["first_frame:480p", 560_000],
    ["first_frame:720p", 950_000],
    ["multi_image:480p", 560_000],
    ["multi_image:720p", 980_000],
]);

const RUNNINGHUB_GROK_TEXT_MODEL_ID = "xai/grok-imagine-video-v1.5/text-to-video/stable";
const RUNNINGHUB_GROK_IMAGE_MODEL_ID = "xai/grok-imagine-video-v1.5/image-to-video/stable";
const RUNNINGHUB_GROK_REFERENCE_MODEL_ID = "xai/grok-imagine-video-v1.5/reference-to-video/stable";
const RUNNINGHUB_GROK_EDIT_MODEL_ID = "xai/grok-imagine-video/edit-video/stable";
const RUNNINGHUB_GROK_EXTEND_MODEL_ID = "xai/grok-imagine-video/video-extend/stable";

const contracts = new Map([
    [
        RUNNINGHUB_GROK_TEXT_MODEL_ID,
        {
            detailId: "2133100000000700029",
            path: "/openapi/v2/rhart-video-g-official/text-to-video-v1.5",
            workflow: "text_to_video",
            fields: ["prompt", "duration", "aspectRatio", "resolution"],
            prompt: [5, 2048],
            resolutions: ["480p", "720p", "1080p"],
            ratios: true,
            duration: [1, 15],
            images: [0, 0],
            videos: 0,
            imageMaxBytes: 0,
            videoMaxBytes: 0,
            videoExtensions: new Set(),
        },
    ],
    [
        RUNNINGHUB_GROK_IMAGE_MODEL_ID,
        {
            detailId: "2132764885651525688",
            path: "/openapi/v2/rhart-video-g-official/image-to-video-v1.5",
            workflow: "first_frame",
            fields: ["prompt", "imageUrl", "duration", "resolution"],
            prompt: [5, 2048],
            resolutions: ["480p", "720p"],
            ratios: false,
            duration: [1, 15],
            images: [1, 1],
            videos: 0,
            imageMaxBytes: 100 * MB,
            videoMaxBytes: 0,
            videoExtensions: new Set(),
        },
    ],
    [
        RUNNINGHUB_GROK_REFERENCE_MODEL_ID,
        {
            detailId: "2133100000000700028",
            path: "/openapi/v2/rhart-video-g-official/reference-to-video-v1.5",
            workflow: "multi_image",
            fields: ["prompt", "referenceImages", "duration", "aspectRatio", "resolution"],
            prompt: [5, 2048],
            resolutions: ["480p", "720p"],
            ratios: true,
            duration: [1, 15],
            images: [1, 7],
            videos: 0,
            imageMaxBytes: 100 * MB,
            videoMaxBytes: 0,
            videoExtensions: new Set(),
        },
    ],
    [
        RUNNINGHUB_GROK_EDIT_MODEL_ID,
        {
            detailId: "2028310887460519937",
            path: "/openapi/v2/rhart-video-g-official/edit-video",
            workflow: "video_edit",
            fields: ["prompt", "videoUrl", "resolution"],
            prompt: [5, 800],
            resolutions: ["480p", "720p"],
            ratios: false,
            duration: null,
            images: [0, 0],
            videos: 1,
            imageMaxBytes: 0,
            videoMaxBytes: 50 * MB,
            videoExtensions: new Set(["mp4"]),
            videoDurationMs: [1_000, 8_000],
        },
    ],
    [
        RUNNINGHUB_GROK_EXTEND_MODEL_ID,
        {
            detailId: "2043991611295436803",
            path: "/openapi/v2/rhart-video-g-official/video-extend",
            workflow: "video_extend",
            fields: ["videoUrl", "prompt", "duration"],
            prompt: [1, 2048],
            resolutions: [],
            ratios: false,
            duration: [6, 10],
            durationValues: [6, 10],
            images: [0, 0],
            videos: 1,
            imageMaxBytes: 0,
            videoMaxBytes: 100 * MB,
            videoExtensions: new Set(["mp4", "mov"]),
        },
    ],
]);

const paths = new Map([...contracts].map(([model, contract]) => [contract.path, model]));
const fail = (code, message) => Object.assign(new Error(message), { status: 400, code });

const RUNNINGHUB_GROK_MODEL_IDS = Object.freeze([...contracts.keys()]);

export function runningHubGrokContractFor(value) {
    return contracts.get(
        String(value || "")
            .split("::")
            .pop()
            ?.toLowerCase(),
    );
}

export function runningHubGrokModelForPath(pathname) {
    const value = String(pathname || "");
    const exact = paths.get(value);
    if (exact) return exact;
    for (const [path, model] of paths) if (value.endsWith(path.slice("/openapi/v2".length))) return model;
    return "";
}

export function isRunningHubGrokCreatePath(pathname) {
    return Boolean(runningHubGrokModelForPath(pathname));
}

export function runningHubTaskStatus(value) {
    const status = String(value ?? "")
        .trim()
        .toUpperCase();
    if (!["QUEUED", "RUNNING", "SUCCESS", "FAILED"].includes(status)) throw fail("runninghub_task_status_invalid", "RunningHub 返回了无法识别的任务状态，已停止自动轮询");
    return status;
}

export function validateRunningHubGrokPayload(model, payload) {
    const contract = runningHubGrokContractFor(model);
    if (!contract) throw fail("runninghub_grok_model_invalid", "RunningHub Grok 模型不在已确认清单中");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("runninghub_grok_payload_invalid", "RunningHub Grok 视频请求必须是 JSON 对象");
    const allowed = new Set(contract.fields);
    const unexpected = Object.keys(payload).find((field) => !allowed.has(field));
    if (unexpected) throw fail("runninghub_grok_field_unsupported", `RunningHub Grok 当前工作流不支持字段 ${unexpected}`);
    const missing = contract.fields.find((field) => !Object.prototype.hasOwnProperty.call(payload, field));
    if (missing) throw fail("runninghub_grok_field_required", `RunningHub Grok 当前工作流缺少字段 ${missing}`);
    const prompt = String(payload.prompt || "").trim();
    const length = Array.from(prompt).length;
    if (typeof payload.prompt !== "string" || length < contract.prompt[0] || (contract.prompt[1] !== undefined && length > contract.prompt[1]))
        throw fail("runninghub_grok_prompt_invalid", "RunningHub Grok 提示词长度不符合当前工作流要求");
    if (/@\[node:[^\]]+\]|<IMAGE_\d+>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(prompt))
        throw fail("runninghub_grok_reference_token_unsupported", "RunningHub Grok 不支持在提示词中用 @ 或 <IMAGE_n> 点名素材");
    if (contract.resolutions.length && !contract.resolutions.includes(String(payload.resolution || "").toLowerCase()))
        throw fail("runninghub_grok_resolution_invalid", "RunningHub Grok 当前工作流不支持所选分辨率");
    if (contract.ratios && !RATIOS.has(String(payload.aspectRatio || ""))) throw fail("runninghub_grok_ratio_invalid", "RunningHub Grok 当前工作流不支持所选比例");
    if (contract.durationValues) {
        if (typeof payload.duration !== "string" || !contract.durationValues.includes(Number(payload.duration)))
            throw fail("runninghub_grok_duration_invalid", "RunningHub Grok 视频续写时长只能是字符串 6 或 10");
    } else if (contract.duration) {
        const duration = Number(payload.duration);
        if (!Number.isSafeInteger(duration) || duration < contract.duration[0] || duration > contract.duration[1])
            throw fail("runninghub_grok_duration_invalid", "RunningHub Grok 当前工作流时长必须是 1-15 秒整数");
    }
    let inputImageCount = 0;
    let inputVideoCount = 0;
    if (contract.workflow === "first_frame") {
        publicHttpUrl(payload.imageUrl, "图片");
        assertKnownRemoteFormat(payload.imageUrl, "图片", IMAGE_EXTENSIONS);
        inputImageCount = 1;
    } else if (contract.workflow === "multi_image") {
        if (!Array.isArray(payload.referenceImages) || payload.referenceImages.length < 1 || payload.referenceImages.length > 7)
            throw fail("runninghub_grok_reference_count_invalid", "RunningHub Grok 多图参考必须包含 1-7 张图片");
        payload.referenceImages.forEach((url) => {
            publicHttpUrl(url, "图片");
            assertKnownRemoteFormat(url, "图片", IMAGE_EXTENSIONS);
        });
        inputImageCount = payload.referenceImages.length;
    } else if (contract.videos) {
        publicHttpUrl(payload.videoUrl, "视频");
        assertKnownRemoteFormat(payload.videoUrl, "视频", contract.videoExtensions);
        inputVideoCount = 1;
    }
    return {
        model,
        workflow: contract.workflow,
        resolution: contract.resolutions.length ? String(payload.resolution).toLowerCase() : "",
        ratio: contract.ratios ? String(payload.aspectRatio) : "",
        duration: contract.durationValues ? Number(payload.duration) : contract.duration ? Number(payload.duration) : null,
        inputImageCount,
        inputVideoCount,
        inputAudioCount: 0,
    };
}

function publicHttpUrl(value, kind) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || isPrivateHostname(url.hostname)) throw new Error();
        return url.toString();
    } catch {
        throw fail("runninghub_grok_reference_url_invalid", `RunningHub Grok ${kind}必须使用公网 HTTP(S) 地址`);
    }
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

function assertKnownRemoteFormat(value, kind, allowed) {
    const extension = /\.([a-z0-9]+)$/.exec(new URL(value).pathname.toLowerCase())?.[1] || "";
    if (KNOWN_MEDIA_EXTENSIONS.has(extension) && !allowed.has(extension)) throw fail("runninghub_grok_reference_format_invalid", `RunningHub Grok ${kind}格式不受当前工作流支持`);
}
