import { defaultConfig, generationConfigWithLastSettings, imageGenerationCountWithLastSettings, resolveModelForCapability, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { effectiveImageGenerationCount } from "@/lib/image-generation-settings";
import i18n from "@/i18n";
import { apimartGrokOfficialVideoCapabilitiesFor, normalizeApimartGrokOfficialVideoSettings } from "@/lib/apimart-grok-official-video";
import { resolveImageUrl, uploadImage } from "@/services/platform-image-storage";
import { resolveMediaUrl } from "@/services/platform-file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata } from "@/types/canvas";
import { isLocalH3Model, normalizeLocalH3Parameters } from "@/services/api/local-h3";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)), ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)), ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url))];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const metadata = node.metadata;
            const content = metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, content, metadata.mimeType) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            const images = await Promise.all((metadata.images || []).map(async (image) => (image.content ? { ...image, content: await resolveImageUrl(image.storageKey, image.content, image.mimeType) } : image)));
            if (metadata.storageKey) return { ...node, metadata: { ...metadata, content: await resolveImageUrl(metadata.storageKey, content, metadata.mimeType), images } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

const nodeMediaHydrationKeys: Array<keyof CanvasNodeMetadata> = ["content", "storageKey", "status", "naturalWidth", "naturalHeight", "bytes", "mimeType"];
const imageHydrationKeys: Array<keyof CanvasNodeImage> = ["content", "storageKey", "status", "errorDetails", "naturalWidth", "naturalHeight", "bytes", "mimeType"];

function mergeHydratedRecord<T extends object>(source: T | undefined, hydrated: T | undefined, current: T, identityKeys: Array<keyof T>, keys: Array<keyof T>) {
    if (!source || !hydrated || identityKeys.some((key) => !Object.is(current[key], source[key]))) return current;
    let next = current;
    for (const key of keys) {
        if (!Object.is(current[key], source[key]) || Object.is(hydrated[key], source[key])) continue;
        if (next === current) next = { ...current };
        next[key] = hydrated[key];
    }
    return next;
}

export function mergeHydratedCanvasNodes(sourceNodes: CanvasNodeData[], hydratedNodes: CanvasNodeData[], currentNodes: CanvasNodeData[]) {
    const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
    const hydratedById = new Map(hydratedNodes.map((node) => [node.id, node]));
    return currentNodes.map((current) => {
        const source = sourceById.get(current.id);
        const hydrated = hydratedById.get(current.id);
        if (!source || !hydrated || current.type !== source.type || !current.metadata) return current;
        let metadata = mergeHydratedRecord(source.metadata, hydrated.metadata, current.metadata, ["content", "storageKey"], nodeMediaHydrationKeys);
        if (current.metadata.images?.length) {
            const sourceImages = new Map((source.metadata?.images || []).map((image) => [image.id, image]));
            const hydratedImages = new Map((hydrated.metadata?.images || []).map((image) => [image.id, image]));
            let imagesChanged = false;
            const images = current.metadata.images.map((image) => {
                const merged = mergeHydratedRecord(sourceImages.get(image.id), hydratedImages.get(image.id), image, ["content", "storageKey"], imageHydrationKeys);
                if (merged !== image) imagesChanged = true;
                return merged;
            });
            if (imagesChanged) metadata = { ...metadata, images };
        }
        return metadata === current.metadata ? current : { ...current, metadata };
    });
}

export function mergeHydratedAssistantSessions(sourceSessions: CanvasAssistantSession[], hydratedSessions: CanvasAssistantSession[], currentSessions: CanvasAssistantSession[]) {
    const sourceById = new Map(sourceSessions.map((session) => [session.id, session]));
    const hydratedById = new Map(hydratedSessions.map((session) => [session.id, session]));
    return currentSessions.map((currentSession) => {
        const sourceSession = sourceById.get(currentSession.id);
        const hydratedSession = hydratedById.get(currentSession.id);
        if (!sourceSession || !hydratedSession) return currentSession;
        const sourceMessages = new Map(sourceSession.messages.map((message) => [message.id, message]));
        const hydratedMessages = new Map(hydratedSession.messages.map((message) => [message.id, message]));
        let sessionChanged = false;
        const messages = currentSession.messages.map((currentMessage) => {
            const sourceMessage = sourceMessages.get(currentMessage.id);
            const hydratedMessage = hydratedMessages.get(currentMessage.id);
            if (!sourceMessage || !hydratedMessage || !currentMessage.references?.length) return currentMessage;
            const sourceReferences = new Map((sourceMessage.references || []).map((reference) => [reference.id, reference]));
            const hydratedReferences = new Map((hydratedMessage.references || []).map((reference) => [reference.id, reference]));
            let messageChanged = false;
            const references = currentMessage.references.map((reference) => {
                const merged = mergeHydratedRecord(sourceReferences.get(reference.id), hydratedReferences.get(reference.id), reference, ["dataUrl", "storageKey"], ["dataUrl", "storageKey"]);
                if (merged !== reference) messageChanged = true;
                return merged;
            });
            if (!messageChanged) return currentMessage;
            sessionChanged = true;
            return { ...currentMessage, references };
        });
        return sessionChanged ? { ...currentSession, messages } : currentSession;
    });
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getTextGenerationCount(node?: Pick<CanvasNodeData, "metadata">) {
    return getGenerationCount(String(node?.metadata?.textCount ?? 1));
}

export function getImagePreviewContent(node: Pick<CanvasNodeData, "metadata"> | null | undefined, imageId?: string | null) {
    return (imageId ? node?.metadata?.images?.find((image) => image.id === imageId)?.content : undefined) || node?.metadata?.content;
}

export function toggleExpandedImageNode(ids: ReadonlySet<string>, nodeId: string) {
    const next = new Set(ids);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
}

export function removeExpandedImageNodes(ids: ReadonlySet<string>, nodeIds: ReadonlySet<string>) {
    return new Set([...ids].filter((nodeId) => !nodeIds.has(nodeId)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const lastGenerationSettings = useConfigStore.getState().lastGenerationSettings;
    const defaults = mode === "image" || mode === "video" ? generationConfigWithLastSettings(config, lastGenerationSettings, mode) : config;
    const model = resolveModelForCapability(defaults, node?.metadata?.model, mode);
    const localH3 = mode === "video" && isLocalH3Model(model);
    const localH3Parameters = localH3 ? normalizeLocalH3Parameters({ duration: Number(node?.metadata?.seconds || defaults.videoSeconds) as 5 | 10, resolution: (node?.metadata?.vquality || defaults.vquality) as "864x480" | "480x864" | "640x640", aspectRatio: (node?.metadata?.size || defaults.size) as "16:9" | "9:16" | "1:1", referenceMode: (node?.metadata?.videoReferenceMode || defaults.videoReferenceMode) as "text_to_video" | "first_frame" | "first_last_frame" }) : null;
    const official = mode === "video" ? apimartGrokOfficialVideoCapabilitiesFor(model) : undefined;
    const normalized = official ? normalizeApimartGrokOfficialVideoSettings(model, { resolution: node?.metadata?.vquality || defaults.vquality, ratio: node?.metadata?.size || defaults.size, duration: Number(node?.metadata?.seconds || defaults.videoSeconds) }) : undefined;
    const generationConfig: AiConfig = {
        ...defaults,
        model,
        ...(mode === "image" ? { imageModel: model } : mode === "video" ? { videoModel: model } : mode === "audio" ? { audioModel: model } : { textModel: model }),
        reasoningEffort: node?.metadata?.reasoningEffort || defaults.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || defaults.quality || defaultConfig.quality,
        size: node?.metadata?.size || defaults.size || defaultConfig.size,
        background: node?.metadata?.background ?? defaults.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || defaults.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || defaults.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || defaults.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || defaults.videoWatermark || defaultConfig.videoWatermark,
        videoReferenceMode: node?.metadata?.videoReferenceMode || defaults.videoReferenceMode || defaultConfig.videoReferenceMode,
        videoOutputFormat: node?.metadata?.videoOutputFormat || defaults.videoOutputFormat || defaultConfig.videoOutputFormat,
        audioVoice: node?.metadata?.audioVoice || defaults.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || defaults.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || defaults.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || defaults.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? imageGenerationCountWithLastSettings(config, lastGenerationSettings) : defaults.count) || defaultConfig.count),
        ...(normalized
            ? {
                  size: official?.workflow === "video_edit" ? node?.metadata?.size || defaults.size : normalized.ratio,
                  vquality: official?.workflow === "video_edit" ? node?.metadata?.vquality || defaults.vquality : normalized.resolution,
                  videoSeconds: official?.workflow === "video_edit" ? node?.metadata?.seconds || defaults.videoSeconds || "6" : String(normalized.duration),
                  videoReferenceMode: official?.workflow === "video_edit" ? "video_edit" : "omni",
                  videoGenerateAudio: "false",
                  videoWatermark: "false",
                  videoOutputFormat: "mp4",
              }
            : {}),
        ...(localH3
            ? {
                  size: localH3Parameters!.aspectRatio,
                  vquality: localH3Parameters!.resolution,
                  videoSeconds: String(localH3Parameters!.duration),
                  videoReferenceMode: localH3Parameters!.referenceMode as AiConfig["videoReferenceMode"],
                  videoGenerateAudio: "true",
                  videoWatermark: "false",
                  videoOutputFormat: localH3Parameters!.outputFormat,
              }
            : {}),
    };
    return mode === "image" ? { ...generationConfig, count: String(effectiveImageGenerationCount(generationConfig, model)) } : generationConfig;
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.metadata?.status !== "loading") return node;
        const videoRecovery = node.type === CanvasNodeType.Video && Boolean(node.metadata.videoTakeId || node.metadata.generationTask);
        const errorDetails = videoRecovery ? (node.metadata.videoTakeStatus === "submission_unknown" ? i18n.t("canvas.generation.videoSubmissionUnknown") : i18n.t("canvas.generation.videoRecovery")) : i18n.t("canvas.generation.interrupted");
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "error" as const,
                errorDetails,
                images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : image)),
            },
        };
    });
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
            width: node.metadata.naturalWidth,
            height: node.metadata.naturalHeight,
            bytes: node.metadata.bytes,
            mimeType: node.metadata.mimeType,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
