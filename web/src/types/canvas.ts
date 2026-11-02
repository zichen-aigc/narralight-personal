import type { SeedanceReferenceMode } from "@/lib/seedance-model-capabilities";
import type { LocalH3TaskOverlay } from "@/services/api/local-h3";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
    remoteUrl?: string;
    upstreamTaskId?: string;
    remoteExpiresAt?: string;
    resultIndex?: number;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoReferenceMode?: SeedanceReferenceMode;
    videoOutputFormat?: "mp4" | "mov";
    referenceOrder?: string[];
    primaryEditVideoId?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    sourceAssetId?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    upstreamTaskId?: string;
    resultIndex?: number;
    activeVideoTakeId?: string;
    videoTakeId?: string;
    videoTakeStatus?: "created" | "submitting" | "submission_unknown" | "pending" | "result_pending" | "completed" | "failed";
    videoSubmissionState?: "not_submitted" | "submitted" | "unknown";
    generationTask?: {
        provider: "apimart" | "openai" | "gemini" | "seedance" | "volcengine-ark" | "runninghub" | "richbest" | "888api" | "local-h3" | "plugin";
        taskId: string;
        mediaKind: "video";
        model: string;
        status: "created" | "pending" | "result_pending" | "submission_unknown" | "completed" | "failed" | "cancelled";
        resultIndex?: number;
        errorCode?: string;
        providerError?: { httpStatus?: number; code?: string; message?: string; requestId?: string };
        localH3?: LocalH3TaskOverlay;
        createdAt?: string;
        updatedAt?: string;
    };
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    sourceAssetId?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    batchNodeIds?: string[];
    origin?: Position;
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
