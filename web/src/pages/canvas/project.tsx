import { ConnectionCreateMenu, NodeCreateMenu } from "@/components/canvas/canvas-create-menus";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasOverviewSummary, CanvasThumbnailNode } from "@/components/canvas/canvas-lod-nodes";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasAmbientConnections } from "@/components/canvas/canvas-ambient-connections";
import { CanvasWebglInteractionLayer } from "@/components/canvas/canvas-webgl-interaction-layer";
import { CanvasInteractionPreview } from "@/components/canvas/canvas-interaction-preview";
import { CanvasInteractionAtlas } from "@/components/canvas/canvas-interaction-atlas";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { CanvasVideoFrameCaptureModal } from "@/components/canvas/canvas-video-frame-capture-modal";
import { CanvasVideoGenerationHistoryModal } from "@/components/canvas/canvas-video-generation-history-modal";
import { AssetValidationDialog } from "@/components/asset-validation-control";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasNodeUpscaleDialog } from "@/components/canvas/canvas-node-upscale-dialog";
import { CanvasNodeSplitDialog } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeMaskEditDialog } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeCropDialog } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeAngleDialog } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { ActiveConnectionPath, ConnectionCutButton, ConnectionDirectionMarker, ConnectionPath } from "@/components/canvas/canvas-connections";
import { Button, Input, Modal } from "antd";
import { type VolcAssetBinding } from "@/services/volc-asset-validation";
import { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { ReferenceImage } from "@/types/image";
import { type CanvasAssistantImage, type CanvasNodeImage, type CanvasNodeMetadata, type CanvasNodeTypeId } from "@/types/canvas";
import { type CanvasClipboardPayload, type CanvasSelectionLayout } from "@/lib/canvas/canvas-interaction-commands";
import { type CanvasOverviewCluster } from "@/lib/canvas/canvas-performance";
import { type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { type VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { type VideoGenerationTake } from "@/services/video-generation-take";
import { type PersistedGenerationTask } from "@/services/generation-task";
import { VideoGenerationTask } from "@/services/api/video";
import { Group, Video } from "lucide-react";
import { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { assertPlainGrokVideoPrompt, validateGrokApimartVideoRequest } from "@/services/api/apimart-grok-video";
import { validateRunningHubGrokRequest } from "@/services/api/runninghub";
import { createPersistedVideoTask, recoverAndStoreVideoTask, videoTaskMetadata } from "@/services/video-task-recovery";
import {
    describeVideoSubmissionFailure,
    resolveVideoSubmissionFailure,
    videoSubmissionRetryDecision,
    videoSubmissionStateForTake,
    waitForVideoSubmissionRelease,
} from "@/services/video-submission-feedback";
import { listGenerationTasks } from "@/services/generation-task";
import { defaultConfig, generationConfigWithLastSettings, imageGenerationCountWithLastSettings, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { uploadGeneratedImage, uploadImage } from "@/services/platform-image-storage";
import { uploadMediaFile } from "@/services/platform-file-storage";
import { prepareLocalVideoPlayback } from "@/services/video-playback";
import {
    adoptVideoGenerationTake,
    bootstrapLegacyVideoGenerationTake,
    completeVideoGenerationTake,
    createVideoGenerationTake,
    failVideoGenerationTakeIfSafe,
    legacyVideoTakeBootstrapInput,
    listVideoGenerationTakes,
    readVideoGenerationTake,
    updateVideoTakeFromTask,
    videoTakeParameters,
} from "@/services/video-generation-take";
import { nanoid } from "nanoid";
import { bindCanvasBrowserZoomGuard, bindCanvasDuplicateShortcut } from "@/lib/canvas/canvas-browser-events";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { isGrokApimartVideoModel, normalizeGrokApimartVideoSettings } from "@/lib/grok-apimart-video";
import { assertModelBackendSupported, isModelBackendSupported } from "@/lib/backend-model-contract";
import { isApimartGrokOfficialVideoModel, normalizeApimartGrokOfficialVideoSettings } from "@/lib/apimart-grok-official-video";
import { validateApimartGrokOfficialVideoRequest } from "@/services/api/apimart-grok-official-video";
import { isRunningHubGrokVideoModel, normalizeRunningHubGrokSettings, runningHubGrokCapabilitiesFor } from "@/lib/runninghub-grok-video";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { captureVideoFrame } from "@/lib/canvas/canvas-video-frame";
import { App } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { removeConnectionById } from "@/components/canvas/canvas-connections";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { type CanvasAmbientConnectionsHandle } from "@/components/canvas/canvas-ambient-connections";
import { reportCanvasPanDiagnostic } from "@/components/canvas/canvas-pan-diagnostics";
import { canvasWebglPanV1Requested } from "@/lib/canvas/canvas-base-proxy-atlas";
import type { CanvasWebglPanSessionHandle } from "@/lib/canvas/canvas-webgl-pan-engine";
import { useAgentStore } from "@/stores/use-agent-store";
import { createPersistedCanvasProject, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { useCanvasWriteAccess } from "@/pages/canvas/hooks/use-canvas-write-access";
import { buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import {
    buildCanvasGraphIndex,
    buildCanvasLineage,
    buildCanvasLodPosterMap,
    buildCanvasOverviewClusters,
    buildCanvasSpatialIndex,
    CANVAS_LINEAGE_CONNECTION_LIMIT,
    CANVAS_OVERVIEW_MEDIA_CLUSTER_LIMIT,
    CANVAS_THUMBNAIL_MEDIA_NODE_LIMIT,
    canvasAmbientConnections,
    canvasClusterViewport,
    canvasDetailRestorePlan,
    canvasFocusConnections,
    canvasInteractionDetail,
    canvasPrioritizedMediaNodeIds,
    canvasPrioritizedOverviewClusterIds,
    canvasRenderMode,
    canvasStableRenderMode,
    canvasViewportPadding,
    canvasVisibleConnectionSubset,
    queryCanvasSpatialIndex,
    type CanvasRenderMode,
} from "@/lib/canvas/canvas-performance";
import { syncCanvasLatestStateRefs } from "@/lib/canvas/canvas-state-safety";
import { exportCanvasNodes, exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { findContainingGroupId, findGroupDropTarget, getConnectionTargetAnchor, normalizeConnection, snapNodesIntoGroup } from "@/lib/canvas/canvas-node-geometry";
import {
    buildCanvasConnectionBatch,
    canvasSelectionBounds,
    duplicateCanvasVariant,
    groupCanvasSelection,
    isCanvasMediaNode,
    layoutCanvasSelection,
    parseCanvasClipboardData,
    parseCanvasClipboardItems,
} from "@/lib/canvas/canvas-interaction-commands";
import {
    audioExtension,
    buildAngleLabel,
    buildAnglePrompt,
    buildGenerationConfig,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    getImagePreviewContent,
    getInputSummary,
    getTextGenerationCount,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isAudioFile,
    isGenerationCanceled,
    mergeHydratedAssistantSessions,
    mergeHydratedCanvasNodes,
    resetInterruptedGeneration,
    removeExpandedImageNodes,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
    toggleExpandedImageNode,
} from "@/lib/canvas/canvas-generation-helpers";
import { effectiveImageGenerationCount } from "@/lib/image-generation-settings";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import { assetValidationRef, resolveVolcAssetReferenceUrl, volcAssetStatusTone, type VolcAssetValidationReference } from "@/services/volc-asset-validation";
import { startAssetValidationSync, useAssetValidationStore } from "@/stores/use-asset-validation-store";
import { isVideoFileByMimeOrExtension, normalizeResolutionToken, normalizeSeedanceRatio, normalizeSeedanceVideoFile } from "@/lib/seedance-video";
import { cancelLocalH3Job, isLocalH3Model } from "@/services/api/local-h3";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

type CanvasIdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const INTERNAL_CANVAS_CLIPBOARD_TYPE = "application/x-narralight-canvas-nodes";

function isCanvasTextInputTarget(target: EventTarget | null) {
    const element = target instanceof Element ? target : null;
    return isEditableTextTarget(target) || Boolean(element?.closest("[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]"));
}

function isEditableTextTarget(target: EventTarget | null) {
    const element = target instanceof Element ? target : null;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || Boolean(element?.closest("[contenteditable='true']"));
}

function nodeVolcValidationReference(projectId: string, node: CanvasNodeData): VolcAssetValidationReference | null {
    if (![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type as CanvasNodeType) || !node.metadata?.content) return null;
    return {
        localRef: assetValidationRef({ storageKey: node.metadata.storageKey, assetId: node.metadata.sourceAssetId, projectId, nodeId: node.id }),
        projectId,
        mediaKind: node.type as "image" | "video" | "audio",
        title: node.title,
        previewUrl: node.metadata.content,
    };
}

function generationVolcValidationReferences(
    projectId: string,
    context: { referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[]; referenceAudios: ReferenceAudio[] },
): VolcAssetValidationReference[] {
    return [
        ...context.referenceImages.map((reference) => ({
            localRef: assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }),
            projectId,
            mediaKind: "image" as const,
            title: reference.name,
        })),
        ...context.referenceVideos.map((reference) => ({
            localRef: assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }),
            projectId,
            mediaKind: "video" as const,
            title: reference.name,
        })),
        ...context.referenceAudios.map((reference) => ({
            localRef: assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }),
            projectId,
            mediaKind: "audio" as const,
            title: reference.name,
        })),
    ];
}

function generationVolcRequestReferences(
    projectId: string,
    context: { referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[]; referenceAudios: ReferenceAudio[] },
    bindings: VolcAssetBinding[],
) {
    return {
        referenceImages: context.referenceImages.map((reference) => {
            const url = resolveVolcAssetReferenceUrl(reference.url || reference.dataUrl, assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }), bindings);
            return url.startsWith("asset://") ? { ...reference, url, dataUrl: url } : reference;
        }),
        referenceVideos: context.referenceVideos.map((reference) => ({
            ...reference,
            url: resolveVolcAssetReferenceUrl(reference.url, assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }), bindings),
        })),
        referenceAudios: context.referenceAudios.map((reference) => ({
            ...reference,
            url: resolveVolcAssetReferenceUrl(reference.url, assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }), bindings),
        })),
    };
}

function isGrokVideoModel(model: string) {
    return isApimartGrokOfficialVideoModel(model) || isGrokApimartVideoModel(model) || isRunningHubGrokVideoModel(model);
}

function validateCanvasGrokVideoRequest(
    config: ReturnType<typeof buildGenerationConfig>,
    prompt: string,
    context: { referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[]; referenceAudios: ReferenceAudio[] },
) {
    assertModelBackendSupported(config.model);
    if (isApimartGrokOfficialVideoModel(config.model)) {
        const normalized = normalizeApimartGrokOfficialVideoSettings(config.model, { resolution: config.vquality, ratio: config.size, duration: Number(config.videoSeconds) })!;
        validateApimartGrokOfficialVideoRequest({
            model: config.model,
            prompt,
            ...normalized,
            imageCount: context.referenceImages.length,
            videoCount: context.referenceVideos.length,
            audioCount: context.referenceAudios.length,
        });
        return;
    }
    if (isGrokApimartVideoModel(config.model)) {
        const normalized = normalizeGrokApimartVideoSettings({ resolution: normalizeResolutionToken(config.vquality), ratio: config.size, duration: Number(config.videoSeconds) });
        assertPlainGrokVideoPrompt(prompt);
        validateGrokApimartVideoRequest({
            model: config.model,
            prompt,
            resolution: normalized.resolution,
            size: normalized.ratio,
            duration: normalized.duration,
            imageCount: context.referenceImages.length,
            videoCount: context.referenceVideos.length,
            audioCount: context.referenceAudios.length,
        });
        return;
    }
    const capability = runningHubGrokCapabilitiesFor(config.model);
    if (!capability) return;
    const normalized = normalizeRunningHubGrokSettings(config.model, {
        resolution: normalizeResolutionToken(config.vquality),
        ratio: normalizeSeedanceRatio(config.size),
        duration: Number(config.videoSeconds),
    })!;
    validateRunningHubGrokRequest({
        model: config.model,
        prompt,
        resolution: normalized.resolution,
        ratio: normalized.ratio,
        duration: capability.workflow === "video_edit" ? 0 : normalized.duration,
        imageUrls: context.referenceImages.map(() => "https://pending.invalid/image"),
        videoUrls: context.referenceVideos.map(() => "https://pending.invalid/video"),
        imageBytes: context.referenceImages.map((item) => item.bytes),
        videoBytes: context.referenceVideos.map((item) => item.bytes),
        imageMimeTypes: context.referenceImages.map((item) => item.mimeType || item.type),
        videoMimeTypes: context.referenceVideos.map((item) => item.type),
        videoDurationsMs: context.referenceVideos.map((item) => item.durationMs),
    });
    if (context.referenceAudios.length) throw new Error("RunningHub Grok 视频工作流不支持参考音频");
}

function videoTakeTaskMetadata(take: VideoGenerationTake): CanvasNodeMetadata["generationTask"] | undefined {
    if (!take.provider || !take.taskId) return undefined;
    const status = ["pending", "result_pending", "completed", "failed"].includes(take.status) ? (take.status as "pending" | "result_pending" | "completed" | "failed") : "pending";
    return {
        provider: take.provider,
        taskId: take.taskId,
        mediaKind: "video",
        model: take.model || "unknown",
        status,
        resultIndex: take.resultIndex,
        errorCode: take.errorCode,
        providerError: take.providerError,
        createdAt: take.createdAt,
        updatedAt: take.updatedAt,
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    // Subscribe to the registry version so plugin registration changes rerender the canvas.
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const canvasWebglPanEnabled = canvasWebglPanV1Requested(searchParams);
    const projectId = params.id || "";

    const { status: writeAccessStatus, isEditor } = useCanvasWriteAccess(projectId);
    const canvasReadOnly = !isEditor;
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const clipboardTokenRef = useRef(nanoid());
    const clipboardPasteRequestRef = useRef(0);
    const pendingClipboardPasteRef = useRef<number | null>(null);
    const clipboardFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCanvasPointerRef = useRef<Position | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const creatingProjectRef = useRef(false);
    const contentSaveReadyRef = useRef(false);
    const viewportSaveReadyRef = useRef(false);
    const structuralSaveWarningShownRef = useRef(false);
    const lastAppliedProjectUpdateRef = useRef("");
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [renderViewport, setRenderViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("select");
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const sizeRef = useRef(size);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [focusLineageRootId, setFocusLineageRootId] = useState<string | null>(null);
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [connectionCutTarget, setConnectionCutTarget] = useState<{ connectionId: string; position: Position } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);

    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [expandedImageNodeIds, setExpandedImageNodeIds] = useState<Set<string>>(() => new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [isViewportInteracting, setIsViewportInteracting] = useState(false);
    const [canvasDetailMode, setCanvasDetailMode] = useState<"minimal" | "full">("full");
    const [isCanvasDetailPending, setIsCanvasDetailPending] = useState(false);
    const [canvasDetailRestoreRevision, setCanvasDetailRestoreRevision] = useState(0);
    const [canvasViewportCommitToken, setCanvasViewportCommitToken] = useState(0);
    const [lastCanvasDetailRestoreMs, setLastCanvasDetailRestoreMs] = useState(0);
    const [interactionPreviewMode, setInteractionPreviewMode] = useState<Exclude<CanvasRenderMode, "overview"> | null>(null);
    const [isViewportAnimating, setIsViewportAnimating] = useState(false);
    const [connectionsReady, setConnectionsReady] = useState(true);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [manualRecoveryNodeId, setManualRecoveryNodeId] = useState<string | null>(null);
    const [manualRecoveryTaskId, setManualRecoveryTaskId] = useState("");
    const [videoFrameCaptureNodeId, setVideoFrameCaptureNodeId] = useState<string | null>(null);
    const [videoFrameCaptureSource, setVideoFrameCaptureSource] = useState<string | null>(null);
    const [videoHistoryNodeId, setVideoHistoryNodeId] = useState<string | null>(null);
    const [assetValidationTarget, setAssetValidationTarget] = useState<VolcAssetValidationReference | null>(null);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const chatSessionsRef = useRef(chatSessions);
    const activeChatIdRef = useRef(activeChatId);
    const backgroundModeRef = useRef(backgroundMode);
    const showImageInfoRef = useRef(showImageInfo);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const viewportInteractionRef = useRef(false);
    const pendingDetailViewportRef = useRef(viewport);
    const canvasDetailPendingRef = useRef(false);
    const canvasDetailGenerationRef = useRef(0);
    const canvasDetailQuietTimerRef = useRef<number | null>(null);
    const canvasDetailIdleRef = useRef<number | null>(null);
    const canvasDetailRestoreStartedAtRef = useRef(0);
    const previousCanvasDetailRestoreMsRef = useRef(0);
    const ambientConnectionsRef = useRef<CanvasAmbientConnectionsHandle>(null);
    const webglPanSessionRef = useRef<CanvasWebglPanSessionHandle>(null);
    const stableRenderModeRef = useRef<CanvasRenderMode>(canvasRenderMode(viewport.k));
    const lastVisibleBackgroundModeRef = useRef<Exclude<CanvasBackgroundMode, "blank">>("lines");
    const focusAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const resumedTaskIdsRef = useRef(new Set<string>());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const stopGenerationByRunningId = useCallback(
        (runningId: string) => {
            const affectedNodeIds = new Set<string>();
            generationRequestsRef.current.forEach((request) => {
                if (request.runningNodeId !== runningId) return;
                request.controller.abort();
                generationRequestsRef.current.delete(request.targetNodeId);
                affectedNodeIds.add(request.targetNodeId);
                affectedNodeIds.add(request.originNodeId);
            });
            const localH3JobIds = nodesRef.current
                .filter((node) => affectedNodeIds.has(node.id) && node.metadata?.generationTask?.provider === "local-h3")
                .map((node) => node.metadata!.generationTask!.taskId);
            if (localH3JobIds.length) {
                void Promise.allSettled([...new Set(localH3JobIds)].map((jobId) => cancelLocalH3Job(jobId))).then((results) => {
                    if (results.some((result) => result.status === "rejected")) message.warning("本机 H3 取消请求未确认；请从视频历史继续核对原任务，系统不会重新提交。");
                });
            }
            setRunningNodeId((current) => (current === runningId ? null : current));
            if (!affectedNodeIds.size) return;
            setNodes((prev) =>
                prev.map((node) =>
                    affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  status: NODE_STATUS_IDLE,
                                  errorDetails: undefined,
                                  images: node.metadata.images?.map((image) =>
                                      image.status === NODE_STATUS_LOADING ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : image,
                                  ),
                              },
                          }
                        : node,
                ),
            );
        },
        [message, t],
    );

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: t("canvas.projectPage.stopTitle"),
                content: t("canvas.projectPage.stopDescription"),
                okText: t("canvas.projectPage.stop"),
                cancelText: t("canvas.projectPage.continue"),
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId, t],
    );

    const bootstrapCurrentVideoTake = useCallback(
        async (node: CanvasNodeData) => {
            const input = legacyVideoTakeBootstrapInput(projectId, node);
            return input ? (await bootstrapLegacyVideoGenerationTake(input)).take : null;
        },
        [projectId],
    );

    const syncVideoTakeToNode = useCallback((take: VideoGenerationTake, errorDetails?: string) => {
        const generationTask = videoTakeTaskMetadata(take);
        setNodes((current) =>
            current.map((node) =>
                node.id === take.nodeId
                    ? {
                          ...node,
                          metadata: {
                              ...node.metadata,
                              videoTakeId: take.takeId,
                              videoTakeStatus: take.status,
                              videoSubmissionState: videoSubmissionStateForTake(take),
                              generationTask,
                              ...(errorDetails ? { status: NODE_STATUS_ERROR, errorDetails } : {}),
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const adoptVideoTakeToNode = useCallback((take: VideoGenerationTake) => {
        const media = take.media;
        if (!media) return;
        setNodes((current) =>
            current.map((node) => {
                if (node.id !== take.nodeId) return node;
                const size = fitNodeSize(
                    media.width || node.metadata?.naturalWidth || node.width,
                    media.height || node.metadata?.naturalHeight || node.height,
                    VIDEO_NODE_MAX_WIDTH,
                    VIDEO_NODE_MAX_HEIGHT,
                );
                const generationTask =
                    take.provider && take.taskId
                        ? {
                              provider: take.provider,
                              taskId: take.taskId,
                              mediaKind: "video" as const,
                              model: take.model || node.metadata?.model || "unknown",
                              status: "completed" as const,
                              resultIndex: take.resultIndex,
                              createdAt: take.createdAt,
                              updatedAt: take.updatedAt,
                          }
                        : node.metadata?.generationTask;
                const parameter = (key: keyof VideoGenerationTake["parameters"]) => {
                    const value = take.parameters[key];
                    return value === undefined ? undefined : String(value);
                };
                return {
                    ...node,
                    width: size.width,
                    height: size.height,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    metadata: {
                        ...node.metadata,
                        ...videoMetadata(media),
                        prompt: take.prompt,
                        model: take.model || node.metadata?.model,
                        size: parameter("aspectRatio") || node.metadata?.size,
                        seconds: parameter("duration") || node.metadata?.seconds,
                        vquality: parameter("resolution") || node.metadata?.vquality,
                        generateAudio: parameter("generateAudio") || node.metadata?.generateAudio,
                        watermark: parameter("watermark") || node.metadata?.watermark,
                        generationTask,
                        activeVideoTakeId: take.takeId,
                        videoTakeId: take.takeId,
                        videoTakeStatus: "completed",
                        videoSubmissionState: "submitted",
                        status: NODE_STATUS_SUCCESS,
                        errorDetails: undefined,
                    },
                };
            }),
        );
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        setFocusLineageRootId(null);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const initialNodes = resetInterruptedGeneration(project.nodes);
        const initialSessions = project.chatSessions || [];
        const initialActiveChatId = project.activeChatId || null;
        const initialShowImageInfo = project.showImageInfo || false;
        didInitialCenterRef.current = initialNodes.length > 0 || project.viewport.x !== 0 || project.viewport.y !== 0 || project.viewport.k !== 1;
        syncCanvasLatestStateRefs(
            {
                nodes: nodesRef,
                connections: connectionsRef,
                chatSessions: chatSessionsRef,
                activeChatId: activeChatIdRef,
                backgroundMode: backgroundModeRef,
                showImageInfo: showImageInfoRef,
                viewport: viewportRef,
            },
            {
                nodes: initialNodes,
                connections: project.connections,
                chatSessions: initialSessions,
                activeChatId: initialActiveChatId,
                backgroundMode: project.backgroundMode,
                showImageInfo: initialShowImageInfo,
                viewport: project.viewport,
            },
        );
        contentSaveReadyRef.current = false;
        viewportSaveReadyRef.current = false;
        structuralSaveWarningShownRef.current = false;
        setNodes(initialNodes);
        setConnections(project.connections);
        setChatSessions(initialSessions);
        setActiveChatId(initialActiveChatId);
        setBackgroundMode(project.backgroundMode);
        setShowImageInfo(initialShowImageInfo);
        setViewport(project.viewport);
        setRenderViewport(project.viewport);
        pendingDetailViewportRef.current = project.viewport;
        viewportInteractionRef.current = false;
        canvasDetailPendingRef.current = false;
        setIsViewportInteracting(false);
        setIsCanvasDetailPending(false);
        setCanvasDetailMode("full");
        lastAppliedProjectUpdateRef.current = project.updatedAt;
        historyRef.current = { past: [], future: [] };
        lastHistoryRef.current = {
            nodes: initialNodes,
            connections: project.connections,
            chatSessions: initialSessions,
            activeChatId: initialActiveChatId,
            backgroundMode: project.backgroundMode,
            showImageInfo: initialShowImageInfo,
        };
        setHistoryState({ canUndo: false, canRedo: false });
        setProjectLoaded(true);

        let active = true;
        const restoreMedia = async () => {
            const restoredNodes = await hydrateCanvasImages(initialNodes);
            const restoredSessions = await hydrateAssistantImages(initialSessions);
            if (!active) return;
            const hasConcurrentEdits =
                nodesRef.current !== initialNodes ||
                connectionsRef.current !== project.connections ||
                chatSessionsRef.current !== initialSessions ||
                activeChatIdRef.current !== initialActiveChatId ||
                backgroundModeRef.current !== project.backgroundMode ||
                showImageInfoRef.current !== initialShowImageInfo;
            const mergedNodes = mergeHydratedCanvasNodes(initialNodes, restoredNodes, nodesRef.current);
            const mergedSessions = mergeHydratedAssistantSessions(initialSessions, restoredSessions, chatSessionsRef.current);
            if (!hasConcurrentEdits) {
                historyPausedRef.current = true;
                lastHistoryRef.current = lastHistoryRef.current ? { ...lastHistoryRef.current, nodes: mergedNodes, chatSessions: mergedSessions } : null;
            }
            setNodes(mergedNodes);
            setChatSessions(mergedSessions);
            if (!hasConcurrentEdits) setTimeout(() => (historyPausedRef.current = false), 0);
        };
        void restoreMedia();
        return () => {
            active = false;
        };
    }, [hydrated, navigate, openProject, projectId]);

    useEffect(() => {
        if (!projectLoaded || writeAccessStatus !== "readonly" || !currentProject || currentProject.updatedAt === lastAppliedProjectUpdateRef.current) return;
        let active = true;
        historyPausedRef.current = true;
        const applyRemote = async () => {
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(currentProject.nodes));
            const restoredSessions = await hydrateAssistantImages(currentProject.chatSessions || []);
            if (!active) return;
            const remoteActiveChatId = currentProject.activeChatId || null;
            const remoteShowImageInfo = currentProject.showImageInfo || false;
            syncCanvasLatestStateRefs(
                {
                    nodes: nodesRef,
                    connections: connectionsRef,
                    chatSessions: chatSessionsRef,
                    activeChatId: activeChatIdRef,
                    backgroundMode: backgroundModeRef,
                    showImageInfo: showImageInfoRef,
                    viewport: viewportRef,
                },
                {
                    nodes: restoredNodes,
                    connections: currentProject.connections,
                    chatSessions: restoredSessions,
                    activeChatId: remoteActiveChatId,
                    backgroundMode: currentProject.backgroundMode,
                    showImageInfo: remoteShowImageInfo,
                    viewport: currentProject.viewport,
                },
            );
            setNodes(restoredNodes);
            setConnections(currentProject.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(remoteActiveChatId);
            setBackgroundMode(currentProject.backgroundMode);
            setShowImageInfo(remoteShowImageInfo);
            setViewport(currentProject.viewport);
            setRenderViewport(currentProject.viewport);
            pendingDetailViewportRef.current = currentProject.viewport;
            viewportInteractionRef.current = false;
            canvasDetailPendingRef.current = false;
            setIsViewportInteracting(false);
            setIsCanvasDetailPending(false);
            setCanvasDetailMode("full");
            lastAppliedProjectUpdateRef.current = currentProject.updatedAt;
            historyRef.current = { past: [], future: [] };
            setHistoryState({ canUndo: false, canRedo: false });
            historyPausedRef.current = false;
        };
        void applyRemote();
        return () => {
            active = false;
            historyPausedRef.current = false;
        };
    }, [currentProject, projectLoaded, writeAccessStatus]);

    useEffect(() => {
        contentSaveReadyRef.current = false;
        viewportSaveReadyRef.current = false;
    }, [isEditor, projectId]);

    useEffect(() => {
        if (isEditor) return;
        setTitleEditing(false);
        setDialogNodeId(null);
        setEditingNodeId(null);
        setNodeImageSettingsOpen(false);
        setContextMenu(null);
        setNodeCreatePosition(null);
        setSelectionBox(null);
        setConnectingParams(null);
        setConnectionTargetNodeId(null);
        setPendingConnectionCreate(null);
        setConnectionCutTarget(null);
        setAssetValidationTarget(null);
        setAssetPickerOpen(false);
        setClearConfirmOpen(false);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setSplitNodeId(null);
        setUpscaleNodeId(null);
        setSuperResolveNodeId(null);
        setAngleNodeId(null);
        setManualRecoveryNodeId(null);
        setManualRecoveryTaskId("");
    }, [isEditor]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl")) openAgentPanel();
    }, [openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || !isEditor || historyPausedRef.current) return;
        if (!contentSaveReadyRef.current) {
            contentSaveReadyRef.current = true;
            return;
        }
        if (!updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo })) {
            if (!structuralSaveWarningShownRef.current) {
                structuralSaveWarningShownRef.current = true;
                message.error("检测到画布结构异常，已停止自动保存");
            }
            return;
        }
        structuralSaveWarningShownRef.current = false;
    }, [activeChatId, backgroundMode, chatSessions, connections, isEditor, message, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded || !isEditor) return;
        if (!viewportSaveReadyRef.current) {
            viewportSaveReadyRef.current = true;
            return;
        }
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [isEditor, projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        syncCanvasLatestStateRefs(
            {
                nodes: nodesRef,
                connections: connectionsRef,
                chatSessions: chatSessionsRef,
                activeChatId: activeChatIdRef,
                backgroundMode: backgroundModeRef,
                showImageInfo: showImageInfoRef,
                viewport: viewportRef,
            },
            { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport },
        );
        selectedNodeIdsRef.current = selectedNodeIds;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    const syncCanvasSize = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return sizeRef.current;
        const next = { width: rect.width, height: rect.height };
        const previous = sizeRef.current;
        if (Math.abs(previous.width - next.width) > 0.5 || Math.abs(previous.height - next.height) > 0.5) {
            sizeRef.current = next;
            setSize(next);
        }
        if (!didInitialCenterRef.current) {
            didInitialCenterRef.current = true;
            const centered = { x: next.width / 2, y: next.height / 2, k: 1 };
            viewportRef.current = centered;
            pendingDetailViewportRef.current = centered;
            setViewport(centered);
            setRenderViewport(centered);
        }
        return next;
    }, []);

    useLayoutEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;
        const resizeObserver = new ResizeObserver(syncCanvasSize);
        const visualViewport = window.visualViewport;
        let resolutionQuery: MediaQueryList | null = null;
        const handleResolutionChange = () => {
            syncCanvasSize();
            bindResolutionQuery();
        };
        const bindResolutionQuery = () => {
            resolutionQuery?.removeEventListener("change", handleResolutionChange);
            resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            resolutionQuery.addEventListener("change", handleResolutionChange);
        };

        syncCanvasSize();
        resizeObserver.observe(el);
        window.addEventListener("resize", syncCanvasSize);
        visualViewport?.addEventListener("resize", syncCanvasSize);
        bindResolutionQuery();
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", syncCanvasSize);
            visualViewport?.removeEventListener("resize", syncCanvasSize);
            resolutionQuery?.removeEventListener("change", handleResolutionChange);
        };
    }, [projectLoaded, syncCanvasSize]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const previewCanvasViewport = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        ambientConnectionsRef.current?.updateViewport(next);
    }, []);

    const previewCanvasFallbackViewport = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        ambientConnectionsRef.current?.updateViewport(next);
        setRenderViewport(next);
    }, []);

    const commitCanvasViewport = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        pendingDetailViewportRef.current = next;
        setViewport(next);
        if (!viewportInteractionRef.current && !canvasDetailPendingRef.current) setRenderViewport(next);
    }, []);

    useEffect(() => {
        if (backgroundMode !== "blank") lastVisibleBackgroundModeRef.current = backgroundMode;
    }, [backgroundMode]);

    const toggleCanvasGrid = useCallback(() => {
        setBackgroundMode((current) => (current === "blank" ? lastVisibleBackgroundModeRef.current : "blank"));
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const getVisiblePastePosition = useCallback(() => {
        const pointer = lastCanvasPointerRef.current;
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        if (pointer && rect) {
            const localX = pointer.x * currentViewport.k + currentViewport.x;
            const localY = pointer.y * currentViewport.k + currentViewport.y;
            if (localX >= 40 && localX <= rect.width - 40 && localY >= 40 && localY <= rect.height - 40) return pointer;
        }
        return getCanvasCenter();
    }, [getCanvasCenter]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;
            const batch = buildCanvasConnectionBatch({ current, targetNodeId, nodes: nodesRef.current, connections: connectionsRef.current, createId: nanoid });
            if (batch.connections.length) setConnections((prev) => [...prev, ...batch.connections]);
            if (batch.attemptedCount > 1) {
                message[batch.connectedCount ? "success" : "warning"](
                    t(batch.connectedCount ? "canvas.projectPage.batchConnected" : "canvas.projectPage.batchConnectNone", { connected: batch.connectedCount, skipped: batch.skippedCount }),
                );
            } else if (!batch.connectedCount && batch.skippedCount) {
                message.warning(t("canvas.projectPage.configConnection"));
            }
            setContextMenu(null);
        },
        [message, t],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const lastGenerationSettings = useConfigStore.getState().lastGenerationSettings;
            const imageDefaults = generationConfigWithLastSettings(effectiveConfig, lastGenerationSettings, "image");
            const metadata =
                type === CanvasNodeType.Config
                    ? {
                          model: imageDefaults.imageModel || imageDefaults.model,
                          size: imageDefaults.size,
                          count: getGenerationCount(imageGenerationCountWithLastSettings(effectiveConfig, lastGenerationSettings)),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const nextNodes = [...nodesRef.current, newNode];
            const batch = buildCanvasConnectionBatch({ current: pending.connection, targetNodeId: newNode.id, nodes: nextNodes, connections: connectionsRef.current, createId: nanoid });
            if (!batch.connections.length) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, ...batch.connections]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig, message, setConnecting, t],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            const sourceNodeIds = current.handleType === "source" && current.batchNodeIds?.length ? current.batchNodeIds : [current.nodeId];
            [...nodesRef.current].reverse().forEach((node) => {
                const anchor = getConnectionTargetAnchor(node, current);
                const dx = world.x - anchor.x;
                const dy = world.y - anchor.y;
                const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                const hitsExpanded =
                    world.x >= node.position.x - padding &&
                    world.x <= node.position.x + node.width + padding &&
                    world.y >= node.position.y - padding &&
                    world.y <= node.position.y + node.height + padding;

                if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                isNearNode = true;
                if (sourceNodeIds.includes(node.id) || !sourceNodeIds.some((sourceNodeId) => normalizeConnection(sourceNodeId, node.id, nodesRef.current, current.handleType))) return;

                const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                if (priority < bestPriority) {
                    bestNodeId = node.id;
                    bestPriority = priority;
                }
            });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const graphIndex = useMemo(() => buildCanvasGraphIndex(nodes, connections), [connections, nodes]);
    const lodPosterByNodeId = useMemo(() => buildCanvasLodPosterMap(graphIndex), [graphIndex]);
    const focusedLineage = useMemo(() => (focusLineageRootId ? buildCanvasLineage(graphIndex, focusLineageRootId) : null), [focusLineageRootId, graphIndex]);
    const renderNodes = useMemo(() => (focusedLineage ? nodes.filter((node) => focusedLineage.nodeIds.has(node.id)) : nodes), [focusedLineage, nodes]);
    const renderSpatialIndex = useMemo(() => buildCanvasSpatialIndex(renderNodes), [renderNodes]);
    // Preview camera updates keep the next detailed tree ready while the atlas carries the active
    // interaction. The durable viewport still commits only after the interaction settles.
    const baseRenderMode = canvasStableRenderMode(renderViewport.k, stableRenderModeRef.current);
    stableRenderModeRef.current = baseRenderMode;
    const renderMode = focusedLineage && baseRenderMode === "overview" ? "thumbnail" : baseRenderMode;
    const visibleNodes = useMemo(() => {
        reportCanvasPanDiagnostic(containerRef.current, "visibleScan");
        return queryCanvasSpatialIndex(renderSpatialIndex, renderViewport, size, canvasViewportPadding(renderMode, renderViewport.k, size));
    }, [renderMode, renderSpatialIndex, renderViewport, size]);
    const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
    const overviewClusters = useMemo(() => (renderMode === "overview" ? buildCanvasOverviewClusters(renderNodes) : []), [renderMode, renderNodes]);
    const overviewMediaClusterIds = useMemo(
        () => canvasPrioritizedOverviewClusterIds(overviewClusters, renderViewport, size, CANVAS_OVERVIEW_MEDIA_CLUSTER_LIMIT, selectedNodeIds),
        [overviewClusters, renderViewport, selectedNodeIds, size],
    );
    const thumbnailMediaNodeIds = useMemo(
        () => canvasPrioritizedMediaNodeIds(visibleNodes, renderViewport, size, CANVAS_THUMBNAIL_MEDIA_NODE_LIMIT, selectedNodeIds),
        [renderViewport, selectedNodeIds, size, visibleNodes],
    );
    const canvasDetailLocked = isViewportInteracting || isCanvasDetailPending || canvasDetailMode === "minimal";
    const canvasContentDetail = canvasInteractionDetail(renderMode, canvasDetailLocked);
    const handleInteractionPreviewReady = useCallback((mode: Exclude<CanvasRenderMode, "overview">) => setInteractionPreviewMode(mode), []);

    const clearCanvasDetailScheduling = useCallback(() => {
        canvasDetailGenerationRef.current += 1;
        if (canvasDetailQuietTimerRef.current !== null) {
            window.clearTimeout(canvasDetailQuietTimerRef.current);
            canvasDetailQuietTimerRef.current = null;
        }
        if (canvasDetailIdleRef.current !== null) {
            const idleWindow = window as CanvasIdleWindow;
            if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(canvasDetailIdleRef.current);
            else window.clearTimeout(canvasDetailIdleRef.current);
            canvasDetailIdleRef.current = null;
        }
    }, []);

    const scheduleCanvasDetailRestore = useCallback(() => {
        clearCanvasDetailScheduling();
        const generation = canvasDetailGenerationRef.current;
        const targetViewport = pendingDetailViewportRef.current;
        const targetBaseMode = canvasStableRenderMode(targetViewport.k, stableRenderModeRef.current);
        const targetRenderMode = focusedLineage && targetBaseMode === "overview" ? "thumbnail" : targetBaseMode;
        const targetNodes = queryCanvasSpatialIndex(renderSpatialIndex, targetViewport, size, canvasViewportPadding(targetRenderMode, targetViewport.k, size));
        const mediaNodeCount = targetNodes.filter((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content)).length;
        const videoNodeCount = targetNodes.filter((node) => node.type === CanvasNodeType.Video && Boolean(node.metadata?.content)).length;
        const plan = canvasDetailRestorePlan({
            viewportSize: size,
            devicePixelRatio: window.devicePixelRatio || 1,
            visibleNodeCount: targetNodes.length,
            mediaNodeCount,
            videoNodeCount,
            previousRestoreMs: previousCanvasDetailRestoreMsRef.current,
        });

        canvasDetailQuietTimerRef.current = window.setTimeout(() => {
            canvasDetailQuietTimerRef.current = null;
            if (canvasDetailGenerationRef.current !== generation || viewportInteractionRef.current) return;
            const restore = () => {
                canvasDetailIdleRef.current = null;
                if (canvasDetailGenerationRef.current !== generation || viewportInteractionRef.current) return;
                canvasDetailRestoreStartedAtRef.current = performance.now();
                const nextViewport = pendingDetailViewportRef.current;
                startTransition(() => {
                    setRenderViewport((current) => (canvasDetailGenerationRef.current === generation && !viewportInteractionRef.current ? nextViewport : current));
                    setCanvasDetailMode((current) => (canvasDetailGenerationRef.current === generation && !viewportInteractionRef.current ? "full" : current));
                    setCanvasDetailRestoreRevision((current) => (canvasDetailGenerationRef.current === generation && !viewportInteractionRef.current ? current + 1 : current));
                });
            };
            const idleWindow = window as CanvasIdleWindow;
            canvasDetailIdleRef.current = idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(restore, { timeout: plan.idleTimeoutMs }) : window.setTimeout(restore, 0);
        }, plan.quietMs);
    }, [clearCanvasDetailScheduling, focusedLineage, renderSpatialIndex, size]);

    const handleViewportInteractionChange = useCallback(
        (interacting: boolean) => {
            if (interacting && focusAnimRef.current) {
                clearTimeout(focusAnimRef.current);
                focusAnimRef.current = null;
                setIsViewportAnimating(false);
            }
            viewportInteractionRef.current = interacting;
            if (interacting) {
                clearCanvasDetailScheduling();
                canvasDetailPendingRef.current = true;
                startTransition(() => {
                    setIsViewportInteracting(() => viewportInteractionRef.current);
                    setIsCanvasDetailPending(() => canvasDetailPendingRef.current);
                    setConnectionsReady(false);
                    setContextMenu(null);
                    setHoveredNodeId(null);
                    setToolbarNodeId(null);
                    setConnectionCutTarget(null);
                    setNodeCreatePosition(null);
                });
                return;
            }
            startTransition(() => setIsViewportInteracting(() => viewportInteractionRef.current));
            scheduleCanvasDetailRestore();
        },
        [clearCanvasDetailScheduling, scheduleCanvasDetailRestore],
    );

    useLayoutEffect(() => {
        if (canvasDetailMode !== "full" || viewportInteractionRef.current || !canvasDetailPendingRef.current) return;
        const target = pendingDetailViewportRef.current;
        if (renderViewport.x !== target.x || renderViewport.y !== target.y || renderViewport.k !== target.k) return;
        const restoreMs = Math.max(0, performance.now() - canvasDetailRestoreStartedAtRef.current);
        previousCanvasDetailRestoreMsRef.current = restoreMs;
        canvasDetailPendingRef.current = false;
        setLastCanvasDetailRestoreMs(restoreMs);
        setIsCanvasDetailPending(false);
        setCanvasViewportCommitToken((current) => current + 1);
    }, [canvasDetailMode, canvasDetailRestoreRevision, renderViewport]);

    useEffect(() => {
        if (canvasDetailLocked) {
            setConnectionsReady(false);
            return;
        }
        const idleWindow = window as CanvasIdleWindow;
        const enableConnections = () => setConnectionsReady(true);
        const handle = idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(enableConnections, { timeout: 180 }) : window.setTimeout(enableConnections, 80);
        return () => {
            if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(handle);
            else window.clearTimeout(handle);
        };
    }, [canvasDetailLocked, renderViewport]);

    useEffect(() => () => clearCanvasDetailScheduling(), [clearCanvasDetailScheduling]);
    const nodeById = graphIndex.nodeById;
    // The toolbar follows a single selected node selected by click, creation, marquee, or keyboard.
    // It stays hidden for multi-selection and while isNodeDragging is true.
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const toolbarNode = (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) || (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
    const toolbarValidationReference = toolbarNode ? nodeVolcValidationReference(projectId, toolbarNode) : null;
    const toolbarValidationBinding = useAssetValidationStore((state) => (toolbarValidationReference ? state.bindings[toolbarValidationReference.localRef] : undefined));
    const checkAssetValidation = useAssetValidationStore((state) => state.check);
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const previewImageContent = getImagePreviewContent(previewNode, previewImageId);
    const videoHistoryNode = videoHistoryNodeId ? nodeById.get(videoHistoryNodeId) || null : null;

    useEffect(() => {
        if (writeAccessStatus !== "editor") return;
        startAssetValidationSync();
        if (toolbarValidationReference) void checkAssetValidation([toolbarValidationReference]);
    }, [checkAssetValidation, toolbarValidationReference?.localRef, toolbarValidationReference?.mediaKind, toolbarValidationReference?.projectId, writeAccessStatus]);
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const selectedNodes = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id)), [nodes, selectedNodeIds]);
    const selectedBounds = useMemo(() => (hasMultipleSelectedNodes ? canvasSelectionBounds(nodes, selectedNodeIds) : null), [hasMultipleSelectedNodes, nodes, selectedNodeIds]);
    const selectedSourceNodes = useMemo(
        () => selectedNodes.filter((node) => node.type !== CanvasNodeType.Group && node.type !== CanvasNodeType.Config && (getNodeDefinition(node.type)?.hasSourceHandle ?? true)),
        [selectedNodes],
    );
    const canGroupSelection = selectedNodes.length > 1 && selectedNodes.every((node) => node.type !== CanvasNodeType.Group);
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const groupChildCountById = useMemo(() => new Map([...graphIndex.childrenByGroupId].map(([groupId, children]) => [groupId, children.length])), [graphIndex]);
    const relationFocusNodeIds = useMemo(() => {
        const ids = new Set<string>();
        if (selectedNodeIds.size === 1) ids.add([...selectedNodeIds][0]);
        if (connectingParams) {
            ids.add(connectingParams.nodeId);
            connectingParams.batchNodeIds?.forEach((id) => ids.add(id));
        }
        return ids;
    }, [connectingParams, selectedNodeIds]);
    const guidanceConnections = useMemo(() => {
        reportCanvasPanDiagnostic(containerRef.current, "relationshipScan");
        if (focusedLineage) return canvasVisibleConnectionSubset(focusedLineage.connections, visibleNodeIds, CANVAS_LINEAGE_CONNECTION_LIMIT);
        if (relationFocusNodeIds.size || selectedConnectionId) return canvasFocusConnections(graphIndex, relationFocusNodeIds, selectedConnectionId, renderMode);
        return [];
    }, [focusedLineage, graphIndex, relationFocusNodeIds, renderMode, selectedConnectionId, visibleNodeIds]);
    const ambientHitConnections = useMemo(
        () => (!guidanceConnections.length && !canvasDetailLocked && connectionsReady ? canvasAmbientConnections(graphIndex, visibleNodeIds, renderMode) : []),
        [canvasDetailLocked, connectionsReady, graphIndex, guidanceConnections.length, renderMode, visibleNodeIds],
    );
    const interactiveConnections = canvasDetailLocked ? [] : guidanceConnections.length ? guidanceConnections : ambientHitConnections;
    const guidanceConnectionIds = useMemo(() => new Set(guidanceConnections.map((connection) => connection.id)), [guidanceConnections]);
    const panGuidanceLayer = useMemo(
        () =>
            guidanceConnections.length ? (
                <svg data-canvas-pan-guidance className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 1 }}>
                    <ConnectionDirectionMarker />
                    {guidanceConnections.map((connection) => {
                        const from = graphIndex.nodeById.get(connection.fromNodeId);
                        const to = graphIndex.nodeById.get(connection.toNodeId);
                        if (!from || !to) return null;
                        return <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active visible showDirection onSelect={() => undefined} />;
                    })}
                </svg>
            ) : null,
        [graphIndex.nodeById, guidanceConnections],
    );

    useEffect(() => {
        if (focusLineageRootId && !graphIndex.nodeById.has(focusLineageRootId)) setFocusLineageRootId(null);
    }, [focusLineageRootId, graphIndex]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        relationFocusNodeIds.forEach((nodeId) => nodeIds.add(nodeId));
        guidanceConnections.forEach((connection) => {
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [guidanceConnections, relationFocusNodeIds]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        if (renderMode !== "work") return map;
        visibleNodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes, renderMode, visibleNodes]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        if (renderMode !== "work") return map;
        visibleNodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes, renderMode, visibleNodes]);
    const { applyAgentOps } = useAgentBridge({
        projectId,
        title: currentProject?.title,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        projectId,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const lastGenerationSettings = useConfigStore.getState().lastGenerationSettings;
            const imageDefaults = generationConfigWithLastSettings(effectiveConfig, lastGenerationSettings, "image");
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: imageDefaults.imageModel || imageDefaults.model,
                          size: imageDefaults.size,
                          count: getGenerationCount(imageGenerationCountWithLastSettings(effectiveConfig, lastGenerationSettings)),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // Display-only plugin nodes with hidePanel do not open a panel; custom Panels require autoOpenPanel on creation.
            // Plugin nodes declaring useBuiltinPanel open the built-in generation panel on creation, like image nodes.
            // Built-in image, video, and config nodes retain their existing open-on-create behavior.
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    return node;
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setExpandedImageNodeIds((current) => removeExpandedImageNodes(current, allIds));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => removeConnectionById(prev, connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setConnectionCutTarget((current) => (current?.connectionId === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setConnectionCutTarget(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setPreviewImageId(null);
        setRunningNodeId(null);
        setExpandedImageNodeIds(new Set());
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback(
        (nodeId: string) => {
            const source = nodesRef.current.find((node) => node.id === nodeId);
            if (!source) return;

            const id = `${source.type}-${nanoid()}`;
            const isMediaVariant = isCanvasMediaNode(source) && Boolean(source.metadata?.content);
            const duplicated = duplicateCanvasVariant(source, isMediaVariant ? connectionsRef.current : [], {
                nodeId: id,
                title: t(isMediaVariant ? "canvas.projectPage.variantTitle" : "canvas.projectPage.copyTitle", { title: source.title }),
                createConnectionId: nanoid,
            });

            setNodes((prev) => [...prev, duplicated.node]);
            if (duplicated.inboundConnections.length) setConnections((prev) => [...prev, ...duplicated.inboundConnections]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            if (duplicated.node.type !== CanvasNodeType.Group) setDialogNodeId(id);
        },
        [t],
    );

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return false;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return false;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
        return true;
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        if (focusAnimRef.current) clearTimeout(focusAnimRef.current);
        focusAnimRef.current = null;
        setIsViewportAnimating(false);
        setIsViewportInteracting(false);
        commitCanvasViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [commitCanvasViewport, size.height, size.width]);

    const animateCanvasViewportTo = useCallback(
        (target: ViewportTransform) => {
            if (focusAnimRef.current) clearTimeout(focusAnimRef.current);
            setIsViewportInteracting(true);
            setIsViewportAnimating(true);
            commitCanvasViewport(target);
            focusAnimRef.current = setTimeout(() => {
                focusAnimRef.current = null;
                setIsViewportAnimating(false);
                setIsViewportInteracting(false);
            }, 470);
        },
        [commitCanvasViewport],
    );

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const worldX = node.position.x + node.width / 2;
            const worldY = node.position.y + node.height / 2;
            const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1);
            const target = { x: size.width / 2 - worldX * k, y: size.height / 2 - worldY * k, k };
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);

            animateCanvasViewportTo(target);
        },
        [animateCanvasViewportTo, size.height, size.width],
    );

    const focusOverviewCluster = useCallback(
        (cluster: CanvasOverviewCluster) => {
            setSelectedNodeIds(cluster.nodeId ? new Set([cluster.nodeId]) : new Set());
            setSelectedConnectionId(null);
            setContextMenu(null);
            animateCanvasViewportTo(canvasClusterViewport(cluster, size));
        },
        [animateCanvasViewportTo, size],
    );

    useEffect(() => () => void (focusAnimRef.current && clearTimeout(focusAnimRef.current)), []);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            const current = viewportRef.current;
            commitCanvasViewport({
                x: size.width / 2 - ((size.width / 2 - current.x) / current.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - current.y) / current.k) * nextScale,
                k: nextScale,
            });
            setContextMenu(null);
        },
        [commitCanvasViewport, size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(async () => {
        if (creatingProjectRef.current) return;
        creatingProjectRef.current = true;
        try {
            const id = await createPersistedCanvasProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));
            navigate(`/canvas/${id}`);
        } catch {
            message.error(t("canvas.projectSaveFailed"));
        } finally {
            creatingProjectRef.current = false;
        }
    }, [message, navigate, t]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error(t("canvas.projectPage.notFound"));
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            await exportCanvasProjects([project], project.title || t("canvas.title"));
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
            setEditingNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
            setConnectionCutTarget(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // Selection-only logic shared by the bubbling drag entry point and outer capture handler.
    // Returns the single target ID after the click, or null for multi-selection or deselection, to sync the toolbar.
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, []);

    // Capture-phase selection lets any inner element, including textarea or iframe, select the node and show its toolbar.
    // It only selects; body onMouseDown still starts dragging, so text selection inside editors does not drag the node.
    // Cache the capture result for the following bubbling drag handler to avoid applying shift-selection twice.
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            if (event.button !== 0) return;
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = nextSelected;
        },
        [selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            event.stopPropagation();
            // Capture already selected the node; this only starts dragging, with a fallback selection if capture did not run.
            const nextSelected = pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId).nextSelected;
            pendingSelectionRef.current = null;
            if (!isEditor) return;
            const currentNodes = nodesRef.current;
            const dragIds = new Set(nextSelected);
            currentNodes.forEach((node) => {
                if (!nextSelected.has(node.id)) return;
                if (node.type === CanvasNodeType.Group) {
                    currentNodes.forEach((child) => {
                        if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                    });
                }
            });
            dragRef.current = {
                isDraggingNode: true,
                hasMoved: false,
                startX: event.clientX,
                startY: event.clientY,
                initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
            };
            historyPausedRef.current = true;
            nodeDraggingRef.current = true;
            setIsNodeDragging(true);
        },
        [isEditor, selectNodeByEvent],
    );

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const movedIds = new Set(initialPositions.map((item) => item.id));
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedDefinition?.hidePanel) {
                // Clicking a display-only plugin node selects it without opening a lower panel.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                const movedIds = new Set(initialPositions.map((item) => item.id));
                const previewNodes = nodesRef.current.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.find((item) => item.id === node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current.forEach((node) => {
                const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                if (intersects) nextSelected.add(node.id);
            });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position, select = true) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        if (select) {
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        }
        return id;
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position, select = true) => {
        const video = await uploadMediaFile(normalizeSeedanceVideoFile(file), "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        if (select) {
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        }
        return id;
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position, select = true) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        if (select) {
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
        }
        return id;
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string, position = getCanvasCenter(), select = true) => {
            const trimmed = text.trim();
            if (!trimmed) return null;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, position, { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };

            setNodes((prev) => [...prev, node]);
            if (select) {
                setSelectedNodeIds(new Set([node.id]));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setDialogNodeId(node.id);
            }
            return node.id;
        },
        [getCanvasCenter, t],
    );

    const pasteSystemClipboard = useCallback(
        async (payload: CanvasClipboardPayload) => {
            const base = getVisiblePastePosition();
            const createdIds: string[] = [];
            let failedCount = payload.unsupportedCount;
            const STAGGER = 40;
            for (let index = 0; index < payload.mediaFiles.length; index++) {
                const file = payload.mediaFiles[index];
                const position = { x: base.x + index * STAGGER, y: base.y + index * STAGGER };
                try {
                    const id = isAudioFile(file)
                        ? await createAudioFileNode(file, position, false)
                        : isVideoFileByMimeOrExtension(file)
                          ? await createVideoFileNode(file, position, false)
                          : await createImageFileNode(file, position, false);
                    createdIds.push(id);
                } catch {
                    failedCount += 1;
                }
            }
            if (payload.text) {
                const id = createTextNodeFromClipboard(payload.text, { x: base.x + createdIds.length * STAGGER, y: base.y + createdIds.length * STAGGER }, false);
                if (id) createdIds.push(id);
            }
            if (createdIds.length) {
                setSelectedNodeIds(new Set(createdIds));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setDialogNodeId(createdIds[0]);
            }
            message[failedCount ? (createdIds.length ? "warning" : "error") : "success"](
                t(failedCount ? "canvas.projectPage.clipboardPastePartial" : "canvas.projectPage.clipboardPasteSuccess", { count: createdIds.length, failed: failedCount }),
            );
        },
        [createAudioFileNode, createImageFileNode, createTextNodeFromClipboard, createVideoFileNode, getVisiblePastePosition, message, t],
    );

    const pasteNavigatorClipboard = useCallback(
        async (requestId: number) => {
            if (pendingClipboardPasteRef.current !== requestId) return;
            try {
                const clipboard = navigator.clipboard;
                if (!clipboard) throw new Error("clipboard_unavailable");
                let payload: CanvasClipboardPayload | null = null;
                let readError: unknown;
                if (typeof clipboard.read === "function") {
                    try {
                        payload = await parseCanvasClipboardItems(await clipboard.read());
                    } catch (error) {
                        readError = error;
                    }
                }
                if ((!payload || (!payload.mediaFiles.length && !payload.text && !payload.unsupportedCount)) && typeof clipboard.readText === "function") {
                    try {
                        const text = await clipboard.readText();
                        payload = parseCanvasClipboardData({ getData: (type) => (type === "text/plain" ? text : "") });
                    } catch (error) {
                        readError ||= error;
                    }
                }
                if (pendingClipboardPasteRef.current !== requestId) return;
                pendingClipboardPasteRef.current = null;
                if (payload && (payload.mediaFiles.length || payload.text || payload.unsupportedCount)) {
                    await pasteSystemClipboard(payload);
                } else {
                    message.warning(t(readError ? "canvas.projectPage.clipboardReadFailed" : "canvas.projectPage.clipboardPasteEmpty"));
                }
            } catch {
                if (pendingClipboardPasteRef.current !== requestId) return;
                pendingClipboardPasteRef.current = null;
                message.warning(t("canvas.projectPage.clipboardReadFailed"));
            }
        },
        [message, pasteSystemClipboard, t],
    );

    useEffect(() => {
        const trackCanvasPointer = (event: PointerEvent) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
            lastCanvasPointerRef.current = screenToCanvas(event.clientX, event.clientY);
        };
        window.addEventListener("pointermove", trackCanvasPointer, { passive: true });
        return () => window.removeEventListener("pointermove", trackCanvasPointer);
    }, [screenToCanvas]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;
            if (isEditor && isModifierShortcut && !event.altKey && key === "v" && !isEditableTextTarget(event.target)) {
                const requestId = ++clipboardPasteRequestRef.current;
                pendingClipboardPasteRef.current = requestId;
                if (clipboardFallbackTimerRef.current) clearTimeout(clipboardFallbackTimerRef.current);
                clipboardFallbackTimerRef.current = setTimeout(() => {
                    clipboardFallbackTimerRef.current = null;
                    if (pendingClipboardPasteRef.current === requestId) void pasteNavigatorClipboard(requestId);
                }, 300);
                return;
            }
            if (!isModifierShortcut && !event.altKey && key === "f" && !isEditableTextTarget(event.target)) {
                const selected = [...selectedNodeIdsRef.current];
                if (selected.length === 1) {
                    event.preventDefault();
                    setFocusLineageRootId((current) => (current === selected[0] ? null : selected[0]));
                }
                return;
            }
            const isLineageEscape = event.key === "Escape" && Boolean(focusLineageRootId) && !isEditableTextTarget(event.target);
            if (isCanvasTextInputTarget(event.target) && !isLineageEscape) return;
            if (!isEditor && event.key !== "Escape") return;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                window.getSelection()?.removeAllRanges();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setFocusLineageRootId(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setConnectionCutTarget(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        const handleCopy = (event: ClipboardEvent) => {
            if (isCanvasTextInputTarget(event.target) || window.getSelection()?.toString() || !copySelectedNodes()) return;
            event.preventDefault();
            event.clipboardData?.setData(INTERNAL_CANVAS_CLIPBOARD_TYPE, clipboardTokenRef.current);
            event.clipboardData?.setData("text/plain", clipboardRef.current?.nodes.map((node) => node.title).join("\n") || "");
        };

        const handlePaste = (event: ClipboardEvent) => {
            if (!isEditor || isEditableTextTarget(event.target)) return;
            const requestId = pendingClipboardPasteRef.current ?? ++clipboardPasteRequestRef.current;
            pendingClipboardPasteRef.current = requestId;
            if (clipboardFallbackTimerRef.current) {
                clearTimeout(clipboardFallbackTimerRef.current);
                clipboardFallbackTimerRef.current = null;
            }
            if (!event.clipboardData) {
                event.preventDefault();
                void pasteNavigatorClipboard(requestId);
                return;
            }
            if (event.clipboardData.getData(INTERNAL_CANVAS_CLIPBOARD_TYPE) === clipboardTokenRef.current && pasteCopiedNodes()) {
                event.preventDefault();
                pendingClipboardPasteRef.current = null;
                return;
            }
            const payload = parseCanvasClipboardData(event.clipboardData);
            if (!payload.mediaFiles.length && !payload.text && !payload.unsupportedCount) {
                event.preventDefault();
                void pasteNavigatorClipboard(requestId);
                return;
            }
            event.preventDefault();
            pendingClipboardPasteRef.current = null;
            void pasteSystemClipboard(payload);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("copy", handleCopy);
        window.addEventListener("paste", handlePaste);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("copy", handleCopy);
            window.removeEventListener("paste", handlePaste);
            if (clipboardFallbackTimerRef.current) clearTimeout(clipboardFallbackTimerRef.current);
        };
    }, [
        copySelectedNodes,
        deleteConnection,
        deleteNodes,
        duplicateNode,
        focusLineageRootId,
        isEditor,
        pasteCopiedNodes,
        pasteNavigatorClipboard,
        pasteSystemClipboard,
        redoCanvas,
        selectedConnectionId,
        setConnecting,
        undoCanvas,
    ]);

    useEffect(() => {
        const container = containerRef.current?.parentElement;
        if (!container) return;
        const workspace = container.closest<HTMLElement>("[data-canvas-workspace]");
        const releaseZoomGuard = workspace ? bindCanvasBrowserZoomGuard(workspace) : undefined;
        const releaseDuplicate = bindCanvasDuplicateShortcut(container, () => {
            if (!isEditor) return;
            const selected = [...selectedNodeIdsRef.current];
            const source = selected.length === 1 ? nodesRef.current.find((node) => node.id === selected[0]) : null;
            if (source && isCanvasMediaNode(source) && source.metadata?.content) duplicateNode(source.id);
        });
        return () => {
            releaseDuplicate();
            releaseZoomGuard?.();
        };
    }, [duplicateNode, isEditor, projectLoaded]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleSelectionConnectStart = useCallback(
        (event: ReactMouseEvent) => {
            event.stopPropagation();
            if (!selectedBounds || !selectedSourceNodes.length) return message.warning(t("canvas.selectionToolbar.batchConnectNeedsSources"));
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({
                nodeId: selectedSourceNodes[0].id,
                handleType: "source",
                batchNodeIds: selectedSourceNodes.map((node) => node.id),
                origin: { x: selectedBounds.right, y: selectedBounds.top + selectedBounds.height / 2 },
            });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [message, screenToCanvas, selectedBounds, selectedSourceNodes, setConnecting, t],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        setIsNodeResizing(true);
    }, []);
    const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedImageNodeIds((current) => toggleExpandedImageNode(current, nodeId));
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, imageId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const image = node.metadata?.images?.find((item) => item.id === imageId);
                if (!image?.content) return node;
                const edge = Math.max(node.width, node.height);
                const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
                return {
                    ...node,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    ...size,
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const duplicateBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        const id = nanoid();
        const edge = Math.max(node.width, node.height);
        const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
        const copy: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: node.title,
            position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + node.height / 2 - size.height / 2 },
            ...size,
            metadata: {
                content: image.content,
                storageKey: image.storageKey,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                bytes: image.bytes,
                mimeType: image.mimeType,
                status: NODE_STATUS_SUCCESS,
                prompt: node.metadata?.prompt,
                generationType: node.metadata?.generationType,
                model: node.metadata?.model,
                size: node.metadata?.size,
                quality: node.metadata?.quality,
                background: node.metadata?.background,
                references: node.metadata?.references,
            },
        };
        setNodes((prev) => [...prev, copy]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(
            node.metadata.content,
            `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? (node.metadata.mimeType === "video/quicktime" ? "mov" : "mp4") : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`,
        );
    }, []);

    const downloadBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        saveAs(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
    }, []);

    const captureVideoNodeFrame = useCallback(
        async (nodeId: string, position: VideoFramePosition, selectedTime?: number) => {
            setContextMenu(null);
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const player = Array.from(containerRef.current?.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]") || []).find((item) => item.dataset.canvasVideo === nodeId);
            try {
                if (node?.type !== CanvasNodeType.Video) throw new Error("Not a video node");
                let source = player?.currentSrc || player?.src || node.metadata?.content || "";
                if (!source && node.metadata?.storageKey) {
                    source = (await prepareLocalVideoPlayback({ src: node.metadata.content || "", storageKey: node.metadata.storageKey, mimeType: node.metadata.mimeType, bytes: node.metadata.bytes }))
                        .src;
                }
                if (!source) throw new Error("Missing video source");
                const uploaded = await uploadImage(await captureVideoFrame(source, position, selectedTime ?? player?.currentTime ?? 0));
                const size = fitNodeSize(uploaded.width, uploaded.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                const id = nanoid();
                const x = node.position.x + node.width + 96;
                let y = node.position.y + node.height / 2 - size.height / 2;
                while (
                    nodesRef.current.some(
                        (item) => item.id !== node.id && item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y,
                    )
                )
                    y += size.height + 24;
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Image,
                        title: t(`canvas.videoFrames.${position}Title`, { name: node.title || t("assets.kinds.video") }),
                        position: { x, y },
                        ...size,
                        metadata: imageMetadata(uploaded),
                    },
                ]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: id }]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
                message.success(t("canvas.videoFrames.captured"));
            } catch {
                message.error(t("canvas.videoFrames.failed"));
            }
        },
        [message, t],
    );

    const openVideoFrameCapture = useCallback(
        async (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (node?.type !== CanvasNodeType.Video) return message.error(t("canvas.videoFrames.failed"));
            const player = Array.from(containerRef.current?.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]") || []).find((item) => item.dataset.canvasVideo === nodeId);
            const directSource = player?.currentSrc || player?.src || node.metadata?.content || "";
            if (directSource) {
                setVideoFrameCaptureSource(directSource);
                setVideoFrameCaptureNodeId(nodeId);
                return;
            }
            if (!node.metadata?.storageKey) return message.error(t("canvas.videoFrames.failed"));
            try {
                const prepared = await prepareLocalVideoPlayback({
                    src: node.metadata.content || "",
                    storageKey: node.metadata.storageKey,
                    mimeType: node.metadata.mimeType,
                    bytes: node.metadata.bytes,
                });
                if (!prepared.src) throw new Error("Missing video source");
                setVideoFrameCaptureSource(prepared.src);
                setVideoFrameCaptureNodeId(nodeId);
            } catch {
                message.error(t("canvas.videoFrames.failed"));
            }
        },
        [message, t],
    );

    const videoFrameCaptureNode = videoFrameCaptureNodeId ? nodesRef.current.find((item) => item.id === videoFrameCaptureNodeId) || null : null;

    const groupSelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        const bounds = canvasSelectionBounds(nodesRef.current, selectedIds);
        if (!bounds) return message.warning(t("canvas.selectionToolbar.groupNeedsNodes"));
        const result = groupCanvasSelection(nodesRef.current, selectedIds, createCanvasNode(CanvasNodeType.Group, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }));
        if (!result) return message.warning(t("canvas.selectionToolbar.groupNeedsNodes"));
        setNodes(result.nodes);
        setSelectedNodeIds(new Set([result.group.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        message.success(t("canvas.selectionToolbar.grouped", { count: result.groupedCount }));
    }, [message, t]);

    const downloadSelectedNodes = useCallback(async () => {
        const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
        if (!selected.length) return;
        try {
            await exportCanvasNodes(selected, t("canvas.selectionToolbar.archiveName"));
            message.success(t("canvas.selectionToolbar.downloaded", { count: selected.length }));
        } catch {
            message.error(t("canvas.selectionToolbar.downloadFailed"));
        }
    }, [message, t]);

    const layoutSelectedNodes = useCallback(
        (layout: CanvasSelectionLayout) => {
            setNodes((prev) => layoutCanvasSelection(prev, selectedNodeIdsRef.current, layout));
            setDialogNodeId(null);
            message.success(t("canvas.selectionToolbar.layoutApplied", { layout: t(`canvas.selectionToolbar.${layout}`) }));
        },
        [message, t],
    );

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error(t("canvas.projectPage.noTextToSave"));
                addAsset({
                    kind: "text",
                    title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasText"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { content },
                    metadata: { source: "canvas", nodeId: node.id },
                });
                message.success(t("common.addedToAssets"));
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noVideoToSave"));
                addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasVideo"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: {
                        url: node.metadata.content,
                        storageKey: node.metadata.storageKey,
                        width: node.width,
                        height: node.height,
                        bytes: node.metadata.bytes || 0,
                        mimeType: node.metadata.mimeType || "video/mp4",
                        durationMs: node.metadata.durationMs,
                    },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success(t("common.addedToAssets"));
                return;
            }
            if (!node.metadata?.content) return message.error(t("canvas.projectPage.noImageToSave"));
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasImage"),
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success(t("common.addedToAssets"));
        },
        [addAsset, message, t],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas.projectPage.emptyReverse"));
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(
                    CanvasNodeType.Text,
                    { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY },
                    { content: t("canvas.projectPage.reversePreset"), prompt: t("canvas.projectPage.reversePreset"), status: NODE_STATUS_SUCCESS, fontSize: 14 },
                ),
                title: t("canvas.projectPage.reverseTitle"),
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: t("canvas.reverseComposer", { imageId: node.id, textId: textNode.id }),
                    },
                ),
                title: t("canvas.projectPage.reverseConfigTitle"),
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message, t],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: t("canvas.projectPage.splitTitle", { name: node.title || t("assets.kinds.image"), row: piece.row + 1, column: piece.column + 1 }),
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(t("canvas.projectPage.splitSuccess", { count: childNodes.length }));
        },
        [message, t],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (payload.generate && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = t("canvas.projectPage.maskPrompt", { source: imageReferenceLabel(0), mask: imageReferenceLabel(1), prompt: userPrompt });
            setMaskEditNodeId(null);
            const maskImage = await uploadImage(payload.maskDataUrl);
            const maskNodeId = nanoid();
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const maskSource = { id: maskNodeId, name: "mask-overlay.png", type: maskImage.mimeType || "image/png", dataUrl: maskImage.url, storageKey: maskImage.storageKey };
            const references = [source, maskSource];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, references);
            setNodes((prev) => [
                ...prev,
                {
                    id: maskNodeId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.projectPage.maskNodeTitle"),
                    position: { x: node.position.x, y: node.position.y + node.height + 96 },
                    width: node.width,
                    height: node.height,
                    metadata: imageMetadata(maskImage),
                },
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || t("canvas.projectPage.maskResult"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: payload.generate ? { prompt, status: NODE_STATUS_LOADING, ...generationMetadata } : { prompt },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }, { id: nanoid(), fromNodeId: maskNodeId, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            if (!payload.generate) return;
            setRunningNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, references, { signal: controller.signal, projectId }).then((items) => items[0]);
                const uploaded = await uploadGeneratedImage(image);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.maskFailed");
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startGenerationRequest, t],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    { signal: controller.signal, projectId },
                ).then((items) => items[0]);
                const uploaded = await uploadGeneratedImage(image);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest, t],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter((f) => f.type.startsWith("image/") || isVideoFileByMimeOrExtension(f) || isAudioFile(f));
            if (!files.length) {
                uploadTargetRef.current = null;
                event.target.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition =
                target?.position ||
                screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const STAGGER = 40; // Offset between multiple imported files.

            // When replacing a target node, use the first file as the replacement and create the rest nearby.
            if (target?.nodeId) {
                const [first, ...rest] = files;

                // Replace the target node with the first file.
                if (isAudioFile(first)) {
                    const audio = await uploadMediaFile(first, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else if (isVideoFileByMimeOrExtension(first)) {
                    const video = await uploadMediaFile(normalizeSeedanceVideoFile(first), "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else {
                    const image = await uploadImage(first);
                    const s = fitNodeSize(image.width, image.height);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Image,
                                      title: first.name,
                                      width: s.width,
                                      height: s.height,
                                      metadata: {
                                          ...node.metadata,
                                          ...imageMetadata(image),
                                          errorDetails: undefined,
                                          freeResize: false,
                                          images: undefined,
                                          generationType: undefined,
                                          model: undefined,
                                          size: undefined,
                                          quality: undefined,
                                          count: undefined,
                                          references: undefined,
                                          primaryImageId: undefined,
                                      },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                }

                // Create the remaining files near the target node.
                for (let i = 0; i < rest.length; i++) {
                    const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                    const f = rest[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (isVideoFileByMimeOrExtension(f)) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            } else {
                // Without a replacement target, create all files near the canvas center.
                for (let i = 0; i < files.length; i++) {
                    const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                    const f = files[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (isVideoFileByMimeOrExtension(f)) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith("image/") || isVideoFileByMimeOrExtension(item) || isAudioFile(item));
            if (!files.length) return;

            const basePos = screenToCanvas(event.clientX, event.clientY);
            const STAGGER = 40;
            for (let i = 0; i < files.length; i++) {
                const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                const f = files[i];
                if (isAudioFile(f)) {
                    void createAudioFileNode(f, pos);
                } else if (isVideoFileByMimeOrExtension(f)) {
                    void createVideoFileNode(f, pos);
                } else {
                    void createImageFileNode(f, pos);
                }
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || t("canvas.projectPage.untitledCanvas"));
        setTitleEditing(true);
    }, [currentProject?.title, t]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            // useBuiltinPanel.writeBackToSelf reuses built-in generation while writing the result back to the plugin node.
            // Image mode currently supports display-only nodes such as panoramas, with a useBuiltinPanel.promptPrefix.
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    // Upstream image nodes become references; without them this is text-to-image.
                    const upstreamNodes = connectionsRef.current
                        .filter((conn) => conn.toNodeId === nodeId)
                        .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                        .filter((node): node is CanvasNodeData => Boolean(node));
                    const refs = upstreamNodes.flatMap((up) =>
                        typeof up.metadata?.content === "string" && up.metadata.content && up.type !== sourceNode.type
                            ? [{ id: up.id, name: `${up.title || up.id}.png`, type: up.metadata.mimeType || "image/png", dataUrl: up.metadata.content, storageKey: up.metadata.storageKey }]
                            : [],
                    );
                    useConfigStore.getState().rememberGenerationSettings("image", { ...generationConfig, imageModel: generationConfig.model });
                    const image = refs.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, fullPrompt, refs, { signal: controller.signal, projectId }).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, fullPrompt, { signal: controller.signal, projectId }).then((items) => items[0]);
                    const uploaded = await uploadGeneratedImage(image);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId
                                ? {
                                      ...node,
                                      metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                        message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            let generationContext: NodeGenerationContext;
            try {
                generationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(
                        nodeId,
                        nodesRef.current,
                        connectionsRef.current,
                        editingTextNode ? t("canvas.projectPage.editTextPrompt", { source: sourceTextContent, prompt }) : prompt,
                        { aggregateReferences: mode === "video" && isGrokVideoModel(generationConfig.model) },
                    ),
                );
            } catch (error) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                message.error(error instanceof Error ? error.message : "参考素材读取失败，请检查连接后重试。");
                return;
            }
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus)
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId
                            ? { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Config ? {} : { prompt }), status: NODE_STATUS_LOADING, errorDetails: undefined } }
                            : node,
                    ),
                );

            try {
                if (mode === "image") {
                    const count = effectiveImageGenerationCount(generationConfig, generationConfig.model);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [
                                  {
                                      id: sourceNode.id,
                                      name: `${sourceNode.title || sourceNode.id}.png`,
                                      type: sourceNode.metadata.mimeType || "image/png",
                                      dataUrl: sourceNode.metadata.content,
                                      storageKey: sourceNode.metadata.storageKey,
                                  },
                              ]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const imageIds = Array.from({ length: count }, () => nanoid());
                    pendingChildIds = [rootId];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            images: imageIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" })),
                            ...generationMetadata,
                        },
                    };

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                    ]);
                    if (!isEmptyImageNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstError = "";
                    useConfigStore.getState().rememberGenerationSettings("image", { ...generationConfig, imageModel: generationConfig.model });
                    await Promise.all(
                        imageIds.map(async (imageId) => {
                            let generatedImage: { dataUrl: string; remoteUrl?: string; upstreamTaskId?: string; remoteExpiresAt?: string; resultIndex?: number } | undefined;
                            try {
                                generatedImage = referenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, { signal: controller.signal, projectId }).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, { signal: controller.signal, projectId }).then((items) => items[0]);
                                if (!generatedImage) throw new Error(t("canvas.projectPage.generationFailed"));
                                const uploaded = await uploadImage(
                                    generatedImage.remoteUrl
                                        ? {
                                              url: generatedImage.remoteUrl,
                                              provider: "apimart",
                                              taskId: generatedImage.upstreamTaskId,
                                              resultIndex: generatedImage.resultIndex,
                                              expiresAt: generatedImage.remoteExpiresAt,
                                          }
                                        : generatedImage.dataUrl,
                                );
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                const item: CanvasNodeImage = {
                                    id: imageId,
                                    status: NODE_STATUS_SUCCESS,
                                    content: uploaded.url,
                                    storageKey: uploaded.storageKey,
                                    naturalWidth: uploaded.width,
                                    naturalHeight: uploaded.height,
                                    bytes: uploaded.bytes,
                                    mimeType: uploaded.mimeType,
                                    remoteUrl: generatedImage.remoteUrl,
                                    upstreamTaskId: generatedImage.upstreamTaskId,
                                    remoteExpiresAt: generatedImage.remoteExpiresAt,
                                    resultIndex: generatedImage.resultIndex,
                                };
                                setNodes((prev) =>
                                    prev.map((node) => {
                                        if (node.id !== rootId) return node;
                                        const images = node.metadata?.images?.map((image) => (image.id === imageId ? item : image)) || [];
                                        if (node.metadata?.primaryImageId) return { ...node, metadata: { ...node.metadata, images } };
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        return {
                                            ...node,
                                            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                            ...imageSize,
                                            metadata: {
                                                ...node.metadata,
                                                content: item.content,
                                                storageKey: item.storageKey,
                                                naturalWidth: item.naturalWidth,
                                                naturalHeight: item.naturalHeight,
                                                bytes: item.bytes,
                                                mimeType: item.mimeType,
                                                images,
                                                primaryImageId: imageId,
                                            },
                                        };
                                    }),
                                );
                                hasSuccess = true;
                                if (isConfigNode)
                                    setNodes((prev) =>
                                        prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)),
                                    );
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                if (!firstError) firstError = errorDetails;
                                hasFailure = true;
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        node.id === rootId
                                            ? {
                                                  ...node,
                                                  metadata: {
                                                      ...node.metadata,
                                                      images: node.metadata?.images?.map((image) =>
                                                          image.id === imageId
                                                              ? {
                                                                    ...image,
                                                                    status: NODE_STATUS_ERROR,
                                                                    errorDetails,
                                                                    remoteUrl: generatedImage?.remoteUrl,
                                                                    upstreamTaskId: generatedImage?.upstreamTaskId,
                                                                    remoteExpiresAt: generatedImage?.remoteExpiresAt,
                                                                    resultIndex: generatedImage?.resultIndex,
                                                                }
                                                              : image,
                                                      ),
                                                  },
                                              }
                                            : node,
                                    ),
                                );
                            }
                            return false;
                        }),
                    );
                    if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } }
                                    : node,
                            ),
                        );
                        return;
                    }
                    if (hasFailure) {
                        message.error(hasSuccess ? t("canvas.projectPage.partialFailed") : firstError || t("canvas.projectPage.generationFailed"));
                    }
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? {
                                      ...node,
                                      metadata: {
                                          ...node.metadata,
                                          status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                          errorDetails: hasSuccess ? undefined : t("canvas.projectPage.generationFailed"),
                                      },
                                  }
                                : node.id === rootId
                                  ? {
                                        ...node,
                                        metadata: {
                                            ...node.metadata,
                                            status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                            errorDetails: hasSuccess ? undefined : t("canvas.projectPage.allFailed"),
                                        },
                                    }
                                  : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    validateCanvasGrokVideoRequest(generationConfig, effectivePrompt, generationContext);
                    const localH3 = isLocalH3Model(generationConfig.model);
                    if (localH3 && (generationContext.referenceVideos.length || generationContext.referenceAudios.length)) throw new Error("本机 H3 当前只支持图片参考，请断开视频或音频参考。");
                    if (localH3 && generationContext.referenceImages.length > 2) throw new Error("本机 H3 最多支持 2 张图片：第 1 张为首帧，第 2 张为尾帧。");
                    const localH3ReferenceMode = generationContext.referenceImages.length === 2 ? "first_last_frame" : generationContext.referenceImages.length === 1 ? "first_frame" : "text_to_video";
                    const videoGenerationConfig = localH3
                        ? { ...generationConfig, videoReferenceMode: localH3ReferenceMode as "text_to_video" | "first_frame" | "first_last_frame" }
                        : generationConfig;
                    const requestReferences = localH3
                        ? { referenceImages: generationContext.referenceImages, referenceVideos: [], referenceAudios: [] }
                        : await (async () => {
                              const assetPreflight = await useAssetValidationStore
                                  .getState()
                                  .preflight({ ...videoGenerationConfig, videoModel: videoGenerationConfig.model }, generationVolcValidationReferences(projectId, generationContext));
                              if (!assetPreflight.allowed) throw new Error(t("assetValidation.blocked"));
                              return generationVolcRequestReferences(projectId, generationContext, assetPreflight.bindings);
                          })();
                    const spec =
                        nodeSizeFromRatio(videoGenerationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) ||
                        NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isExistingVideoNode = sourceNode?.type === CanvasNodeType.Video;
                    const videoId = isExistingVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    if (isExistingVideoNode) await bootstrapCurrentVideoTake(sourceNode);
                    const take = await createVideoGenerationTake({
                        projectId,
                        nodeId: videoId,
                        prompt: effectivePrompt,
                        model: videoGenerationConfig.model,
                        parameters: videoTakeParameters(videoGenerationConfig),
                    });
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isExistingVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isExistingVideoNode ? sourceNode.width : spec.width,
                        height: isExistingVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            ...(isExistingVideoNode ? sourceNode.metadata : {}),
                            ...(isGrokVideoModel(videoGenerationConfig.model) ? { composerContent: prompt } : {}),
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: videoGenerationConfig.model,
                            size: videoGenerationConfig.size,
                            seconds: videoGenerationConfig.videoSeconds,
                            vquality: videoGenerationConfig.vquality,
                            generateAudio: videoGenerationConfig.videoGenerateAudio,
                            watermark: videoGenerationConfig.videoWatermark,
                            videoReferenceMode: videoGenerationConfig.videoReferenceMode,
                            videoOutputFormat: videoGenerationConfig.videoOutputFormat,
                            primaryEditVideoId: sourceNode?.metadata?.primaryEditVideoId,
                            references: generationReferenceUrls(generationContext),
                            videoTakeId: take.takeId,
                            videoTakeStatus: "created",
                            videoSubmissionState: "not_submitted",
                            generationTask: undefined,
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isExistingVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isExistingVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    let takeStatus: VideoGenerationTake["status"] = "created";
                    try {
                        const owner = { projectId, nodeId: videoId, takeId: take.takeId, primaryEditVideoId: sourceNode?.metadata?.primaryEditVideoId };
                        useConfigStore
                            .getState()
                            .rememberGenerationSettings("video", {
                                ...videoGenerationConfig,
                                videoModel: videoGenerationConfig.model,
                                videoReferenceMode: localH3 ? videoGenerationConfig.videoReferenceMode : ("omni" as const),
                            });
                        const created = await createPersistedVideoTask(
                            videoGenerationConfig,
                            effectivePrompt,
                            requestReferences.referenceImages,
                            requestReferences.referenceVideos,
                            requestReferences.referenceAudios,
                            owner,
                            controller.signal,
                        );
                        let latestRecord = created.record;
                        const linkedTake = await updateVideoTakeFromTask(take.takeId, latestRecord);
                        takeStatus = linkedTake.status;
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          metadata: {
                                              ...node.metadata,
                                              generationTask: videoTaskMetadata(latestRecord),
                                              videoTakeId: take.takeId,
                                              videoTakeStatus: linkedTake.status,
                                              videoSubmissionState: "submitted",
                                          },
                                      }
                                    : node,
                            ),
                        );
                        const video = await recoverAndStoreVideoTask(videoGenerationConfig, created.task, owner, {
                            signal: controller.signal,
                            onProgress: async (record) => {
                                latestRecord = record;
                                if (record.status !== "completed" && !(record.status === "failed" && takeStatus === "failed")) {
                                    const updatedTake = await updateVideoTakeFromTask(take.takeId, record);
                                    takeStatus = updatedTake.status;
                                }
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        node.id === videoId
                                            ? {
                                                  ...node,
                                                  metadata: {
                                                      ...node.metadata,
                                                      generationTask: videoTaskMetadata(record),
                                                      videoTakeId: take.takeId,
                                                      videoTakeStatus: takeStatus,
                                                      videoSubmissionState: "submitted",
                                                  },
                                              }
                                            : node,
                                    ),
                                );
                            },
                        });
                        const completedTake = await completeVideoGenerationTake(take.takeId, latestRecord, video);
                        await adoptVideoGenerationTake(take.takeId);
                        takeStatus = "completed";
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...node.metadata,
                                              ...videoMetadata(video),
                                              prompt: effectivePrompt,
                                              model: videoGenerationConfig.model,
                                              size: videoGenerationConfig.size,
                                              seconds: videoGenerationConfig.videoSeconds,
                                              vquality: videoGenerationConfig.vquality,
                                              generateAudio: videoGenerationConfig.videoGenerateAudio,
                                              watermark: videoGenerationConfig.videoWatermark,
                                              videoReferenceMode: videoGenerationConfig.videoReferenceMode,
                                              videoOutputFormat: videoGenerationConfig.videoOutputFormat,
                                              primaryEditVideoId: sourceNode?.metadata?.primaryEditVideoId,
                                              references: generationReferenceUrls(generationContext),
                                              generationTask: videoTaskMetadata(latestRecord),
                                              activeVideoTakeId: completedTake.takeId,
                                              videoTakeId: completedTake.takeId,
                                              videoTakeStatus: "completed",
                                              videoSubmissionState: "submitted",
                                          },
                                      }
                                    : node,
                            ),
                        );
                    } catch (error) {
                        const failure = await resolveVideoSubmissionFailure(take.takeId, error);
                        if (failure.take) {
                            takeStatus = failure.take.status;
                            syncVideoTakeToNode(failure.take, failure.message);
                        }
                        if (isGenerationCanceled(error)) throw error;
                        throw new Error(failure.message);
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode
                            ? sourceNode.position
                            : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(
                            await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal, projectId }),
                            generationConfig.audioFormat,
                        );
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === audioId
                                    ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } }
                                    : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = getTextGenerationCount(sourceNode);
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14, model: generationConfig.model, reasoningEffort: generationConfig.reasoningEffort },
                    }));
                    setNodes((prev) => [
                        ...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        let localStreamed = "";
                        return requestImageQuestion(
                            generationConfig,
                            buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                            (text) => {
                                localStreamed = text;
                                streamed = text;
                                if (isConfigNode) return;
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node,
                                    ),
                                );
                            },
                            { signal: controller.signal, projectId },
                        )
                            .then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed }))
                            .finally(() => finishGenerationRequest(targetNodeId, controller));
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Text,
                                      title: prompt.slice(0, 32) || "Generated Text",
                                      metadata: {
                                          ...node.metadata,
                                          content: answerByNodeId.get(node.id) || streamed,
                                          model: generationConfig.model,
                                          reasoningEffort: generationConfig.reasoningEffort,
                                          status: NODE_STATUS_SUCCESS,
                                      },
                                  }
                                : node,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id)
                            ? node.id === nodeId && !markSourceStatus
                                ? node
                                : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }
                            : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [bootstrapCurrentVideoTake, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startGenerationRequest, syncVideoTakeToNode, t],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? node.metadata : undefined;
            const targetImage = imageId ? savedImageMetadata?.images?.find((image) => image.id === imageId) : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : {
                          ...buildGenerationConfig(
                              effectiveConfig,
                              sourceNode,
                              node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image",
                          ),
                          count: "1",
                      };
            // A missing creation contract must not block querying an existing provider task.
            const unavailableVideoContract = node.type === CanvasNodeType.Video && !isModelBackendSupported(generationConfig.model);
            if (!unavailableVideoContract && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            let retryVideoTake: VideoGenerationTake | undefined;
            if (node.type === CanvasNodeType.Video) {
                if (node.metadata?.videoTakeId) retryVideoTake = await readVideoGenerationTake(node.metadata.videoTakeId).catch(() => undefined);
                if (!retryVideoTake) {
                    const history = await listVideoGenerationTakes(projectId, node.id).catch(() => undefined);
                    retryVideoTake = history?.takes.at(-1);
                }
                if (retryVideoTake?.status === "completed" && retryVideoTake.media) {
                    adoptVideoTakeToNode(retryVideoTake);
                    return;
                }
                if (retryVideoTake && !retryVideoTake.taskId && ["submitting", "submission_unknown"].includes(retryVideoTake.status)) {
                    if (videoSubmissionRetryDecision(retryVideoTake) === "wait_for_reconciliation") {
                        const closeWaiting = message.loading(t("canvas.generation.videoRecoveryWaiting"), 0);
                        retryVideoTake = await waitForVideoSubmissionRelease(retryVideoTake);
                        closeWaiting();
                        syncVideoTakeToNode(retryVideoTake);
                        if (retryVideoTake.status === "completed" && retryVideoTake.media) {
                            adoptVideoTakeToNode(retryVideoTake);
                            return;
                        }
                    }
                }
            }

            const resumesSavedVideo = node.type === CanvasNodeType.Video && Boolean(retryVideoTake?.taskId || node.metadata?.generationTask?.taskId);
            let context: NodeGenerationContext | null;
            try {
                context = hasSavedImageMetadata
                    ? null
                    : resumesSavedVideo
                      ? {
                            prompt: retryVideoTake?.prompt || node.metadata?.prompt || sourceNode.metadata?.prompt || "恢复已有视频任务",
                            referenceImages: [],
                            referenceVideos: [],
                            referenceAudios: [],
                            textCount: 0,
                            imageCount: 0,
                            videoCount: 0,
                            audioCount: 0,
                        }
                      : await hydrateNodeGenerationContext(
                            buildNodeGenerationContext(
                                sourceNode.id,
                                nodesRef.current,
                                connectionsRef.current,
                                sourceNode.metadata?.composerContent || sourceNode.metadata?.prompt || node.metadata?.prompt || "",
                                { aggregateReferences: node.type === CanvasNodeType.Video && isGrokVideoModel(generationConfig.model) },
                            ),
                        );
            } catch (error) {
                message.error(error instanceof Error ? error.message : "参考素材读取失败，请检查连接后重试。");
                return;
            }
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata
                    ? await resolveMetadataReferences(savedImageMetadata)
                    : useReferenceImages
                      ? context?.referenceImages.length
                          ? context.referenceImages
                          : sourceNodeReferenceImages(sourceNode)
                      : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error(t("canvas.projectPage.referenceMissing"));
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : t("canvas.projectPage.referenceMissing"),
                                      images: item.metadata?.images?.map((image) =>
                                          image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("canvas.projectPage.referenceMissing") } : image,
                                      ),
                                  },
                              }
                            : item,
                    ),
                );
                return;
            }
            const retryImages = retryReferenceImages || [];
            setRunningNodeId(node.id);
            setNodes((prev) =>
                prev.map((item) =>
                    item.id === node.id
                        ? {
                              ...item,
                              metadata: {
                                  ...item.metadata,
                                  status: NODE_STATUS_LOADING,
                                  errorDetails: undefined,
                                  images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_LOADING, errorDetails: undefined } : image)),
                              },
                          }
                        : item,
                ),
            );
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) =>
                                prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)),
                            );
                        },
                        { signal: controller.signal, projectId },
                    );
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item,
                        ),
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const savedTask = (retryVideoTake ? videoTakeTaskMetadata(retryVideoTake) : undefined) || node.metadata?.generationTask;
                    let task: VideoGenerationTask;
                    let latestRecord: PersistedGenerationTask | undefined;
                    let take: VideoGenerationTake | undefined = retryVideoTake;
                    if (savedTask) {
                        if (!take) {
                            const history = await listVideoGenerationTakes(projectId, node.id);
                            take = [...history.takes].reverse().find((item) => item.provider === savedTask.provider && item.taskId === savedTask.taskId && item.status !== "completed");
                        }
                        if (!take) {
                            const bootstrapped = await bootstrapCurrentVideoTake(node);
                            if (bootstrapped?.status === "completed") {
                                adoptVideoTakeToNode(bootstrapped);
                                return;
                            }
                            take = await createVideoGenerationTake(
                                { projectId, nodeId: node.id, prompt, model: generationConfig.model, parameters: videoTakeParameters(generationConfig) },
                                { existingTaskId: savedTask.taskId },
                            );
                            try {
                                take = await updateVideoTakeFromTask(take.takeId, {
                                    ...savedTask,
                                    projectId,
                                    nodeId: node.id,
                                    status: savedTask.status === "result_pending" ? "result_pending" : "pending",
                                });
                            } catch (error) {
                                await failVideoGenerationTakeIfSafe(take.takeId, "task_link_failed").catch(() => undefined);
                                throw error;
                            }
                        }
                        latestRecord = { ...savedTask, projectId, nodeId: node.id };
                        task = { id: savedTask.taskId, provider: savedTask.provider, model: savedTask.model };
                    } else {
                        const retryContext = { referenceImages: retryImages, referenceVideos: context?.referenceVideos || [], referenceAudios: context?.referenceAudios || [] };
                        validateCanvasGrokVideoRequest(generationConfig, prompt, retryContext);
                        const localH3 = isLocalH3Model(generationConfig.model);
                        if (localH3 && (retryContext.referenceVideos.length || retryContext.referenceAudios.length)) throw new Error("本机 H3 当前只支持图片参考，请断开视频或音频参考。");
                        if (localH3 && retryContext.referenceImages.length > 2) throw new Error("本机 H3 最多支持 2 张图片：第 1 张为首帧，第 2 张为尾帧。");
                        const retryLocalH3Mode = retryContext.referenceImages.length === 2 ? "first_last_frame" : retryContext.referenceImages.length === 1 ? "first_frame" : "text_to_video";
                        const retryGenerationConfig = localH3
                            ? { ...generationConfig, videoReferenceMode: retryLocalH3Mode as "text_to_video" | "first_frame" | "first_last_frame" }
                            : generationConfig;
                        const requestReferences = localH3
                            ? { referenceImages: retryContext.referenceImages, referenceVideos: [], referenceAudios: [] }
                            : await (async () => {
                                  const assetPreflight = await useAssetValidationStore
                                      .getState()
                                      .preflight({ ...retryGenerationConfig, videoModel: retryGenerationConfig.model }, generationVolcValidationReferences(projectId, retryContext));
                                  if (!assetPreflight.allowed) throw new Error(t("assetValidation.blocked"));
                                  return generationVolcRequestReferences(projectId, retryContext, assetPreflight.bindings);
                              })();
                        take = await createVideoGenerationTake({ projectId, nodeId: node.id, prompt, model: retryGenerationConfig.model, parameters: videoTakeParameters(retryGenerationConfig) });
                        syncVideoTakeToNode(take);
                        let created;
                        try {
                            created = await createPersistedVideoTask(
                                retryGenerationConfig,
                                prompt,
                                requestReferences.referenceImages,
                                requestReferences.referenceVideos,
                                requestReferences.referenceAudios,
                                { projectId, nodeId: node.id, takeId: take.takeId, primaryEditVideoId: node.metadata?.primaryEditVideoId },
                                controller.signal,
                            );
                        } catch (error) {
                            const failure = await resolveVideoSubmissionFailure(take.takeId, error);
                            if (failure.take) syncVideoTakeToNode(failure.take, failure.message);
                            if (isGenerationCanceled(error)) throw error;
                            throw new Error(failure.message);
                        }
                        latestRecord = created.record;
                        task = created.task;
                        take = await updateVideoTakeFromTask(take.takeId, created.record);
                    }
                    const owner = { projectId, nodeId: node.id, takeId: take.takeId, primaryEditVideoId: node.metadata?.primaryEditVideoId };
                    let takeStatus = take.status;
                    try {
                        const video = await recoverAndStoreVideoTask(generationConfig, task, owner, {
                            signal: controller.signal,
                            onProgress: async (record) => {
                                latestRecord = record;
                                if (record.status !== "completed" && !(record.status === "failed" && takeStatus === "failed")) {
                                    const updatedTake = await updateVideoTakeFromTask(take!.takeId, record);
                                    takeStatus = updatedTake.status;
                                }
                                setNodes((prev) =>
                                    prev.map((item) =>
                                        item.id === node.id
                                            ? {
                                                  ...item,
                                                  metadata: {
                                                      ...item.metadata,
                                                      generationTask: videoTaskMetadata(record),
                                                      videoTakeId: take!.takeId,
                                                      videoTakeStatus: takeStatus,
                                                      videoSubmissionState: "submitted",
                                                  },
                                              }
                                            : item,
                                    ),
                                );
                            },
                        });
                        const completedTake = await completeVideoGenerationTake(take.takeId, latestRecord, video);
                        await adoptVideoGenerationTake(take.takeId);
                        takeStatus = "completed";
                        const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((item) =>
                                item.id === node.id
                                    ? {
                                          ...item,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...item.metadata,
                                              ...videoMetadata(video),
                                              prompt,
                                              model: generationConfig.model,
                                              size: generationConfig.size,
                                              seconds: generationConfig.videoSeconds,
                                              vquality: generationConfig.vquality,
                                              generateAudio: generationConfig.videoGenerateAudio,
                                              watermark: generationConfig.videoWatermark,
                                              videoReferenceMode: generationConfig.videoReferenceMode,
                                              videoOutputFormat: generationConfig.videoOutputFormat,
                                              primaryEditVideoId: node.metadata?.primaryEditVideoId,
                                              generationTask: latestRecord ? videoTaskMetadata(latestRecord) : item.metadata?.generationTask,
                                              activeVideoTakeId: completedTake.takeId,
                                              videoTakeId: completedTake.takeId,
                                              videoTakeStatus: "completed",
                                              videoSubmissionState: "submitted",
                                          },
                                      }
                                    : item,
                            ),
                        );
                    } catch (error) {
                        const failure = await resolveVideoSubmissionFailure(take.takeId, error);
                        if (failure.take) {
                            takeStatus = failure.take.status;
                            syncVideoTakeToNode(failure.take, failure.message);
                        }
                        if (isGenerationCanceled(error)) throw error;
                        throw new Error(failure.message);
                    }
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal, projectId }), generationConfig.audioFormat);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item,
                        ),
                    );
                    return;
                }

                let image: { dataUrl: string; remoteUrl?: string; upstreamTaskId?: string; remoteExpiresAt?: string; resultIndex?: number };
                if (targetImage?.remoteUrl) {
                    image = {
                        dataUrl: targetImage.remoteUrl,
                        remoteUrl: targetImage.remoteUrl,
                        upstreamTaskId: targetImage.upstreamTaskId,
                        remoteExpiresAt: targetImage.remoteExpiresAt,
                        resultIndex: targetImage.resultIndex,
                    };
                } else {
                    if (String(generationConfig.model || "").startsWith("apimart::")) throw new Error("此失败记录没有保存 APIMart 任务结果，已阻止自动重新付费生成；请提供 task_id 恢复。");
                    const requestedImage = useReferenceImages
                        ? await requestEdit(generationConfig, prompt, retryImages, { signal: controller.signal, projectId }).then((items) => items[0])
                        : await requestGeneration(generationConfig, prompt, { signal: controller.signal, projectId }).then((items) => items[0]);
                    if (!requestedImage) throw new Error(t("canvas.projectPage.generationFailed"));
                    image = requestedImage;
                }
                const uploadedImage = await uploadImage(
                    image.remoteUrl ? { url: image.remoteUrl, provider: "apimart", taskId: image.upstreamTaskId, resultIndex: image.resultIndex, expiresAt: image.remoteExpiresAt } : image.dataUrl,
                );
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const retryImage: CanvasNodeImage = {
                    id: imageId || node.metadata?.primaryImageId || nanoid(),
                    status: NODE_STATUS_SUCCESS,
                    content: uploadedImage.url,
                    storageKey: uploadedImage.storageKey,
                    naturalWidth: uploadedImage.width,
                    naturalHeight: uploadedImage.height,
                    bytes: uploadedImage.bytes,
                    mimeType: uploadedImage.mimeType,
                    remoteUrl: image.remoteUrl,
                    upstreamTaskId: image.upstreamTaskId,
                    remoteExpiresAt: image.remoteExpiresAt,
                    resultIndex: image.resultIndex,
                };
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const makePrimary = !imageId || !item.metadata?.content;
                        const edge = imageId ? Math.max(item.width, item.height) : 0;
                        const imageSize =
                            imageId && item.metadata?.freeResize
                                ? { width: item.width, height: item.height }
                                : imageId
                                  ? fitNodeSize(uploadedImage.width, uploadedImage.height, edge, edge)
                                  : fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                        return {
                            ...item,
                            type: CanvasNodeType.Image,
                            ...(makePrimary
                                ? {
                                      width: imageSize.width,
                                      height: imageSize.height,
                                      ...(imageId ? { position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 } } : {}),
                                  }
                                : {}),
                            metadata: {
                                ...item.metadata,
                                ...(makePrimary ? imageMetadata(uploadedImage) : { status: NODE_STATUS_SUCCESS }),
                                images: item.metadata?.images?.map((current) => (current.id === retryImage.id ? retryImage : current)),
                                primaryImageId: makePrimary ? retryImage.id : item.metadata?.primaryImageId,
                                prompt,
                                ...generationMetadata,
                            },
                        };
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [
            adoptVideoTakeToNode,
            bootstrapCurrentVideoTake,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            modal,
            openConfigDialog,
            projectId,
            startGenerationRequest,
            syncVideoTakeToNode,
            t,
        ],
    );

    const submitManualVideoRecovery = useCallback(() => {
        const taskId = manualRecoveryTaskId.trim();
        const node = nodesRef.current.find((item) => item.id === manualRecoveryNodeId);
        if (!node || !/^task_[a-zA-Z0-9_-]{8,160}$/.test(taskId)) {
            message.error("请输入有效的 APIMart task_id");
            return;
        }
        const model = node.metadata?.model || effectiveConfig.videoModel || effectiveConfig.model;
        const generationTask = { provider: "apimart" as const, taskId, mediaKind: "video" as const, model, status: "pending" as const };
        const patched = { ...node, metadata: { ...node.metadata, generationTask, status: NODE_STATUS_ERROR } };
        setNodes((prev) => prev.map((item) => (item.id === node.id ? patched : item)));
        setManualRecoveryNodeId(null);
        setManualRecoveryTaskId("");
        void handleRetryNode(patched);
    }, [effectiveConfig.model, effectiveConfig.videoModel, handleRetryNode, manualRecoveryNodeId, manualRecoveryTaskId, message]);

    useEffect(() => {
        if (!projectLoaded) return;
        let cancelled = false;
        let scanning = false;
        const recoverVideoNodes = async (initial: boolean) => {
            if (scanning) return;
            scanning = true;
            try {
                const videoNodes = nodesRef.current.filter(
                    (node) => node.type === CanvasNodeType.Video && !node.metadata?.content && (initial || ["submitting", "submission_unknown"].includes(String(node.metadata?.videoTakeStatus || ""))),
                );
                await Promise.all(
                    videoNodes.map(async (node) => {
                        const history = await listVideoGenerationTakes(projectId, node.id);
                        if (cancelled) return;
                        const take = history.takes.at(-1);
                        if (!take) return;
                        if (take.status === "completed" && take.media) {
                            adoptVideoTakeToNode(take);
                            return;
                        }
                        if (!take.taskId && ["submitting", "submission_unknown"].includes(take.status)) {
                            syncVideoTakeToNode(take, t("canvas.generation.videoSubmissionUnknown"));
                            return;
                        }
                        if (take.status === "failed") {
                            const errorDetails =
                                take.errorCode === "provider_task_not_found"
                                    ? t("canvas.generation.videoTaskNotFound")
                                    : describeVideoSubmissionFailure(take, new Error(t("canvas.projectPage.generationFailed"))).message;
                            syncVideoTakeToNode(take, errorDetails);
                            return;
                        }
                        if (!take.taskId || !["pending", "result_pending"].includes(take.status) || resumedTaskIdsRef.current.has(take.taskId)) return;
                        const generationTask = videoTakeTaskMetadata(take);
                        if (!generationTask) return;
                        const patched = {
                            ...node,
                            metadata: {
                                ...node.metadata,
                                generationTask,
                                videoTakeId: take.takeId,
                                videoTakeStatus: take.status,
                                status: NODE_STATUS_ERROR,
                                errorDetails: t("canvas.generation.videoRecovery"),
                            },
                        };
                        if (!isEditor) {
                            syncVideoTakeToNode(take, t("canvas.generation.videoRecovery"));
                            return;
                        }
                        resumedTaskIdsRef.current.add(take.taskId);
                        setNodes((current) => current.map((item) => (item.id === node.id ? patched : item)));
                        void handleRetryNode(patched);
                    }),
                );
            } finally {
                scanning = false;
            }
        };
        void recoverVideoNodes(true).catch(() => undefined);
        const timer = window.setInterval(() => void recoverVideoNodes(false).catch(() => undefined), 5_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [adoptVideoTakeToNode, handleRetryNode, isEditor, projectId, projectLoaded, syncVideoTakeToNode, t]);

    useEffect(() => {
        if (!projectLoaded || !isEditor) return;
        let cancelled = false;
        void listGenerationTasks({ projectId })
            .then((records) => {
                if (cancelled) return;
                for (const record of records) {
                    if (record.mediaKind !== "video" || !record.nodeId || record.status === "failed" || resumedTaskIdsRef.current.has(record.taskId)) continue;
                    const node = nodesRef.current.find((item) => item.id === record.nodeId && item.type === CanvasNodeType.Video);
                    if (!node || node.metadata?.content) continue;
                    const generationTask = videoTaskMetadata(record);
                    if (record.archivedResult) {
                        setNodes((prev) =>
                            prev.map((item) =>
                                item.id === node.id
                                    ? {
                                          ...item,
                                          metadata: {
                                              ...item.metadata,
                                              content: record.archivedResult!.url,
                                              storageKey: record.archivedResult!.storageKey,
                                              mimeType: record.archivedResult!.mimeType,
                                              bytes: record.archivedResult!.bytes,
                                              status: NODE_STATUS_SUCCESS,
                                              errorDetails: undefined,
                                              generationTask,
                                          },
                                      }
                                    : item,
                            ),
                        );
                        continue;
                    }
                    if (record.status === "completed") continue;
                    const patched = { ...node, metadata: { ...node.metadata, generationTask, status: NODE_STATUS_ERROR, errorDetails: "检测到未完成的原任务，正在继续恢复" } };
                    resumedTaskIdsRef.current.add(record.taskId);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? patched : item)));
                    void handleRetryNode(patched);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [handleRetryNode, isEditor, projectId, projectLoaded]);

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if ((node?.metadata?.images?.length || 0) <= 2) setExpandedImageNodeIds((current) => removeExpandedImageNodes(current, new Set([nodeId])));
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                const images = item.metadata?.images?.filter((image) => image.id !== imageId) || [];
                return {
                    ...item,
                    metadata: { ...item.metadata, images, count: images.length, primaryImageId: item.metadata?.primaryImageId === imageId ? images[0]?.id : item.metadata?.primaryImageId },
                };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.emptyTextImage"));
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const lastGenerationSettings = useConfigStore.getState().lastGenerationSettings;
            const imageDefaults = generationConfigWithLastSettings(effectiveConfig, lastGenerationSettings, "image");
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: imageDefaults.imageModel || imageDefaults.model,
                    size: imageDefaults.size,
                    count: getGenerationCount(imageGenerationCountWithLastSettings(effectiveConfig, lastGenerationSettings)),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current
                .map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item))
                .concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig, message, t],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey
                ? { url: image.dataUrl, storageKey: image.storageKey, width: image.width || 1, height: image.height || 1, bytes: image.bytes || 0, mimeType: image.mimeType || "image/png" }
                : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), sourceAssetId: image.sourceAssetId, prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: {
                            content: payload.url,
                            storageKey: payload.storageKey,
                            sourceAssetId: payload.sourceAssetId,
                            status: NODE_STATUS_SUCCESS,
                            naturalWidth: payload.width,
                            naturalHeight: payload.height,
                            bytes: payload.bytes,
                            mimeType: payload.mimeType || "video/mp4",
                            durationMs: payload.durationMs,
                        },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({
                    id: `asset-${Date.now()}`,
                    prompt: payload.title,
                    dataUrl: payload.dataUrl,
                    storageKey: payload.storageKey,
                    sourceAssetId: payload.sourceAssetId,
                    width: payload.width,
                    height: payload.height,
                    bytes: payload.bytes,
                    mimeType: payload.mimeType,
                });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const openImagePreview = useCallback((nodeId: string, imageId?: string) => {
        setPreviewNodeId(nodeId);
        setPreviewImageId(imageId || null);
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData, imageId?: string) => openImagePreview(node.id, imageId), [openImagePreview]);
    const handleNodeRetry = useCallback((node: CanvasNodeData) => void handleRetryNode(node), [handleRetryNode]);
    const handleNodeContextMenu = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isEditor) return;
            setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
        },
        [isEditor],
    );

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    referencesEnabled
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    projectId={projectId}
                    isRunning={runningNodeId === panelNode.id}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    onSavePrompt={undefined}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),

        [
            false,
            configInputsById,
            confirmStopGeneration,
            effectiveConfig,
            handleConfigNodeChange,
            handleGenerateNode,
            handleNodePromptChange,
            mentionReferencesByNodeId,
            projectId,
            renderPluginPanel,
            runningNodeId,
        ],
    );

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => (
            <CanvasConfigNodePanel
                node={contentNode}
                projectId={projectId}
                readOnly={canvasReadOnly}
                isRunning={runningNodeId === contentNode.id}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                references={mentionReferencesByNodeId.get(contentNode.id) || EMPTY_REFERENCES}
                onConfigChange={handleConfigNodeChange}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onStop={confirmStopGeneration}
                onGenerate={(nodeId) => {
                    const target = nodesRef.current.find((item) => item.id === nodeId);
                    void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                }}
            />
        ),

        [canvasReadOnly, configInputsById, confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, mentionReferencesByNodeId, projectId, runningNodeId],
    );

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main data-canvas-workspace className="relative flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} readOnly={canvasReadOnly} onFocusNode={focusNode} onPreviewNode={openImagePreview} onInsertAsset={handleAssetInsert} />
            <section
                className="relative min-w-0 flex-1 overflow-hidden"
                data-canvas-readonly={canvasReadOnly || undefined}
                data-canvas-render-mode={renderMode}
                data-canvas-interaction-detail={canvasContentDetail}
                data-canvas-interaction-preview-ready={interactionPreviewMode === renderMode ? renderMode : undefined}
                data-canvas-detail-mode={canvasDetailMode}
                data-canvas-detail-state={isViewportInteracting ? "interacting" : isCanvasDetailPending ? "restoring" : "full"}
                data-canvas-detail-revision={canvasDetailRestoreRevision}
                data-canvas-detail-restore-ms={lastCanvasDetailRestoreMs ? lastCanvasDetailRestoreMs.toFixed(1) : undefined}
                data-canvas-webgl-pan-v1={canvasWebglPanEnabled ? "enabled" : "disabled"}
            >
                <CanvasTopBar
                    title={currentProject?.title || t("canvas.projectPage.untitledCanvas")}
                    readOnly={canvasReadOnly}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={exportCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onOpenPlugins={() => {
                        if (isEditor) setPluginManagerOpen(true);
                    }}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                />

                {focusLineageRootId && !canvasDetailLocked ? (
                    <div
                        className="absolute left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        data-canvas-lineage-focus={focusLineageRootId}
                    >
                        <span className="font-semibold">脉络聚焦</span>
                        <span className="max-w-52 truncate opacity-55">{nodeById.get(focusLineageRootId)?.title}</span>
                        <button
                            type="button"
                            className="rounded px-1.5 py-0.5 opacity-65 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                            onClick={() => setFocusLineageRootId(null)}
                        >
                            F / Esc 退出
                        </button>
                    </div>
                ) : null}

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    interactionLocked={canvasDetailLocked}
                    animateViewport={isViewportAnimating}
                    onViewportChange={commitCanvasViewport}
                    onViewportPreview={previewCanvasViewport}
                    onPanFallbackViewport={previewCanvasFallbackViewport}
                    onViewportInteractionChange={handleViewportInteractionChange}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        if (!isEditor) return;
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={isEditor ? handleDrop : undefined}
                    viewportUnderlay={
                        <CanvasAmbientConnections ref={ambientConnectionsRef} connections={connections} nodeById={nodeById} viewport={renderViewport} viewportSize={size} renderMode={renderMode} />
                    }
                    interactionCommitToken={canvasViewportCommitToken}
                    preferStreamingPan={canvasWebglPanEnabled && renderMode !== "overview"}
                    streamingPanSessionRef={webglPanSessionRef}
                    streamingPanSurface={
                        canvasWebglPanEnabled && renderMode !== "overview" ? (
                            <CanvasWebglInteractionLayer
                                ref={webglPanSessionRef}
                                enabled
                                nodes={renderNodes}
                                spatialIndex={renderSpatialIndex}
                                graphIndex={graphIndex}
                                posterByNodeId={lodPosterByNodeId}
                                selectedNodeIds={selectedNodeIds}
                                viewport={renderViewport}
                                viewportSize={size}
                                renderMode={renderMode}
                            />
                        ) : null
                    }
                    interactionSurface={
                        renderMode === "overview" || canvasWebglPanEnabled ? null : (
                            <>
                                <CanvasInteractionPreview
                                    nodes={visibleNodes}
                                    mode={renderMode}
                                    viewport={renderViewport}
                                    viewportSize={size}
                                    posterByNodeId={lodPosterByNodeId}
                                    selectedNodeIds={selectedNodeIds}
                                    relatedNodeIds={relatedHighlight.nodeIds}
                                    interactionLocked={canvasDetailLocked}
                                    snapshotRevision={canvasViewportCommitToken}
                                    onReady={handleInteractionPreviewReady}
                                />

                                {panGuidanceLayer}
                            </>
                        )
                    }
                >
                    {renderMode === "overview" ? <CanvasInteractionAtlas nodes={renderNodes} /> : null}
                    {interactiveConnections.length || connectingParams ? (
                        <svg
                            data-canvas-connections="mounted"
                            className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible"
                            style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}
                        >
                            <ConnectionDirectionMarker />
                            {interactiveConnections.map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;
                                const isGuidanceConnection = guidanceConnectionIds.has(connection.id);

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={isGuidanceConnection || selectedConnectionId === connection.id}
                                        visible={isGuidanceConnection}
                                        showDirection={isGuidanceConnection}
                                        onSelect={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setConnectionCutTarget({ connectionId: connection.id, position: screenToCanvas(event.clientX, event.clientY) });
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setConnectionCutTarget(null);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                            {connectingParams ? (
                                <ActiveConnectionPath
                                    node={nodeById.get(connectingParams.nodeId)}
                                    handle={connectingParams}
                                    mouseWorld={mouseWorld}
                                    target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined}
                                />
                            ) : null}
                        </svg>
                    ) : null}

                    {!canvasDetailLocked && connectionCutTarget && selectedConnectionId === connectionCutTarget.connectionId ? (
                        <ConnectionCutButton
                            connectionId={connectionCutTarget.connectionId}
                            position={connectionCutTarget.position}
                            scale={viewport.k}
                            label={t("canvas.agentOps.delete_connections")}
                            onCut={() => deleteConnection(connectionCutTarget.connectionId)}
                        />
                    ) : null}

                    {renderMode === "overview"
                        ? overviewClusters.map((cluster) => (
                              <CanvasOverviewSummary
                                  key={cluster.id}
                                  cluster={cluster}
                                  scale={renderViewport.k}
                                  showMedia={canvasDetailMode === "full" && overviewMediaClusterIds.has(cluster.id)}
                                  posterByNodeId={lodPosterByNodeId}
                                  onFocus={focusOverviewCluster}
                              />
                          ))
                        : renderMode === "thumbnail"
                          ? visibleNodes.map((node) => (
                                <CanvasThumbnailNode
                                    key={node.id}
                                    node={node}
                                    scale={renderViewport.k}
                                    selected={selectedNodeIds.has(node.id)}
                                    related={relatedHighlight.nodeIds.has(node.id)}
                                    showMedia={canvasDetailMode === "full" && thumbnailMediaNodeIds.has(node.id)}
                                    posterUrl={lodPosterByNodeId.get(node.id)}
                                    onMouseDown={handleNodeMouseDown}
                                    onDoubleClick={focusNode}
                                />
                            ))
                          : visibleNodes.map((node) => (
                                <CanvasNode
                                    key={node.id}
                                    data={node}
                                    scale={renderViewport.k}
                                    readOnly={canvasReadOnly}
                                    detailMode={canvasDetailMode}
                                    isSelected={selectedNodeIds.has(node.id)}
                                    isRelated={relatedHighlight.nodeIds.has(node.id)}
                                    isFocusRelated={activeNodeId === node.id}
                                    isConnectionTarget={connectionTargetNodeId === node.id}
                                    isConnecting={Boolean(connectingParams)}
                                    suppressConnectionHandles={hasMultipleSelectedNodes && selectedNodeIds.has(node.id)}
                                    editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                                    showPanel={isEditor && dialogNodeId === node.id && !selectionBox && !isNodeResizing && !getNodeDefinition(node.type)?.hidePanel}
                                    groupChildCount={groupChildCountById.get(node.id) || 0}
                                    isGroupDropTarget={dropTargetGroupId === node.id}
                                    batchExpanded={expandedImageNodeIds.has(node.id)}
                                    showImageInfo={showImageInfo}
                                    mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                                    pluginHost={pluginHost}
                                    registryVersion={nodeRegistryVersion}
                                    renderPanel={renderNodePanel}
                                    renderNodeContent={renderNodeContentPanel}
                                    onMouseDown={handleNodeMouseDown}
                                    onSelectCapture={handleNodeSelectCapture}
                                    onHoverStart={handleNodeHoverStart}
                                    onHoverEnd={handleNodeHoverEnd}
                                    onConnectStart={handleConnectStart}
                                    onResizeStart={handleNodeResizeStart}
                                    onResize={handleNodeResize}
                                    onResizeEnd={handleNodeResizeEnd}
                                    onContentChange={handleNodeContentChange}
                                    onTitleChange={handleNodeTitleChange}
                                    onToggleBatch={toggleBatchExpanded}
                                    onSetBatchPrimary={isEditor ? setBatchPrimary : undefined}
                                    onDuplicateBatchImage={isEditor ? duplicateBatchImage : undefined}
                                    onDownloadBatchImage={downloadBatchImage}
                                    onRetryBatchImage={isEditor ? retryBatchImage : undefined}
                                    onDeleteBatchImage={isEditor ? deleteBatchImage : undefined}
                                    onRetry={isEditor ? handleNodeRetry : undefined}
                                    onGenerateImage={isEditor ? generateImageFromTextNode : undefined}
                                    onViewImage={handleNodeViewImage}
                                    onContextMenu={handleNodeContextMenu}
                                />
                            ))}

                    {isEditor && !canvasDetailLocked && selectedBounds && !selectionBox && !isNodeDragging && !isNodeResizing ? (
                        <CanvasSelectionToolbar
                            bounds={selectedBounds}
                            scale={viewport.k}
                            canGroup={canGroupSelection}
                            canConnect={selectedSourceNodes.length > 0}
                            onGroup={groupSelectedNodes}
                            onDownload={() => void downloadSelectedNodes()}
                            onLayout={layoutSelectedNodes}
                            onConnectStart={handleSelectionConnectStart}
                        />
                    ) : null}

                    {selectedBounds && !selectionBox && !isNodeDragging && !isNodeResizing ? (
                        <CanvasSelectionToolbar
                            bounds={selectedBounds}
                            scale={viewport.k}
                            canGroup={canGroupSelection}
                            canConnect={selectedSourceNodes.length > 0}
                            onGroup={groupSelectedNodes}
                            onDownload={() => void downloadSelectedNodes()}
                            onLayout={layoutSelectedNodes}
                            onConnectStart={handleSelectionConnectStart}
                        />
                    ) : null}

                    {selectionBox ? (
                        <svg
                            className="pointer-events-none absolute z-[100] overflow-visible"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                            }}
                        >
                            <rect
                                width="100%"
                                height="100%"
                                fill={theme.canvas.selectionFill}
                                stroke={theme.canvas.selectionStroke}
                                strokeOpacity={0.55}
                                strokeWidth={1 / viewport.k}
                                strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`}
                            />
                        </svg>
                    ) : null}
                    {!canvasDetailLocked && pendingConnectionCreate ? (
                        <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} />
                    ) : null}
                    {!canvasDetailLocked && nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                {isEditor && !canvasDetailLocked ? (
                    <CanvasNodeHoverToolbar
                        node={isNodeDragging || isNodeResizing || nodeImageSettingsOpen || expandedImageNodeIds.size ? null : toolbarNode}
                        viewport={viewport}
                        extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                        onKeep={keepNodeToolbar}
                        onLeave={hideNodeToolbar}
                        onInfo={(node) => setInfoNodeId(node.id)}
                        onEditText={openTextEditor}
                        onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                        onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                        onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                        onGenerateImage={generateImageFromTextNode}
                        onUpload={(node) => handleUploadRequest(node.id)}
                        onDownload={downloadNodeImage}
                        onSaveAsset={(node) => void saveNodeAsset(node)}
                        onSavePrompt={undefined}
                        onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                        onCrop={(node) => setCropNodeId(node.id)}
                        onSplit={(node) => setSplitNodeId(node.id)}
                        onUpscale={(node) => setUpscaleNodeId(node.id)}
                        onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                        onAngle={(node) => setAngleNodeId(node.id)}
                        onViewImage={handleNodeViewImage}
                        onReversePrompt={createImageReversePromptNodes}
                        onRetry={(node) => void handleRetryNode(node)}
                        onOpenVideoHistory={(node) => setVideoHistoryNodeId(node.id)}
                        onCaptureVideoFrame={(node, position) => (position === "current" ? void openVideoFrameCapture(node.id) : void captureVideoNodeFrame(node.id, position))}
                        onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                        assetValidationLabel={t(`assetValidation.status.${toolbarValidationBinding?.status || "unverified"}`)}
                        assetValidationActive={Boolean(toolbarValidationBinding && ["active", "not_required"].includes(toolbarValidationBinding.status))}
                        assetValidationTone={volcAssetStatusTone(toolbarValidationBinding?.status || "unverified")}
                        onValidateAsset={(node) => {
                            const reference = nodeVolcValidationReference(projectId, node);
                            if (reference) setAssetValidationTarget(reference);
                        }}
                        onDelete={(node) => deleteNodes(new Set([node.id]))}
                    />
                ) : null}
                {isEditor ? <AssetValidationDialog open={Boolean(assetValidationTarget)} reference={assetValidationTarget} onClose={() => setAssetValidationTarget(null)} /> : null}
                {null}

                {isEditor && !canvasDetailLocked ? (
                    <CanvasToolbar
                        selectedCount={selectedNodeIds.size}
                        canvasTool={canvasTool}
                        canUndo={historyState.canUndo}
                        canRedo={historyState.canRedo}
                        backgroundMode={backgroundMode}
                        showImageInfo={showImageInfo}
                        onAddImage={() => createNode(CanvasNodeType.Image)}
                        onAddVideo={() => createNode(CanvasNodeType.Video)}
                        onAddAudio={() => createNode(CanvasNodeType.Audio)}
                        onAddText={() => createNode(CanvasNodeType.Text)}
                        onAddConfig={() => createNode(CanvasNodeType.Config)}
                        onAddGroup={() => createNode(CanvasNodeType.Group)}
                        onAddExtensionNode={(type) => createNode(type)}
                        onUndo={undoCanvas}
                        onRedo={redoCanvas}
                        onUpload={() => handleUploadRequest()}
                        onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                        onClear={() => setClearConfirmOpen(true)}
                        onCanvasToolChange={setCanvasTool}
                        onBackgroundModeChange={setBackgroundMode}
                        onShowImageInfoChange={setShowImageInfo}
                    />
                ) : null}

                {!canvasDetailLocked && isMiniMapOpen ? <Minimap nodes={nodes} viewport={renderViewport} viewportSize={size} onViewportChange={commitCanvasViewport} /> : null}
                <CanvasZoomControls
                    scale={renderViewport.k}
                    onScaleChange={setZoomScale}
                    onReset={resetViewport}
                    isMiniMapOpen={isMiniMapOpen}
                    onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
                    backgroundMode={backgroundMode}
                    onToggleGrid={toggleCanvasGrid}
                />

                {isEditor && contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        canCaptureVideoFrame={contextMenuNode?.type === CanvasNodeType.Video && Boolean(contextMenuNode.metadata?.content || contextMenuNode.metadata?.storageKey)}
                        canUngroup={contextMenuNode?.type === CanvasNodeType.Group}
                        onClose={() => setContextMenu(null)}
                        onCaptureVideoFrame={(position) =>
                            contextMenu.type === "node" && (position === "current" ? void openVideoFrameCapture(contextMenu.nodeId) : void captureVideoNodeFrame(contextMenu.nodeId, position))
                        }
                        onUngroup={() => {
                            if (contextMenu.type !== "node") return;
                            deleteNodes(new Set([contextMenu.nodeId]));
                            setContextMenu(null);
                            message.success(t("canvas.controls.ungrouped"));
                        }}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple accept="image/*,video/*,.mp4,.mov,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                <CanvasVideoGenerationHistoryModal
                    open={Boolean(videoHistoryNode)}
                    projectId={projectId}
                    node={videoHistoryNode}
                    canAdopt={isEditor}
                    onClose={() => setVideoHistoryNodeId(null)}
                    onAdopt={adoptVideoTakeToNode}
                />
                <CanvasVideoFrameCaptureModal
                    open={Boolean(videoFrameCaptureNode)}
                    source={videoFrameCaptureSource}
                    initialTime={(() => {
                        const player = Array.from(containerRef.current?.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]") || []).find(
                            (item) => item.dataset.canvasVideo === videoFrameCaptureNode?.id,
                        );
                        return player?.currentTime || 0;
                    })()}
                    onClose={() => {
                        setVideoFrameCaptureNodeId(null);
                        setVideoFrameCaptureSource(null);
                    }}
                    onCapture={(time) => {
                        const nodeId = videoFrameCaptureNode?.id;
                        setVideoFrameCaptureNodeId(null);
                        setVideoFrameCaptureSource(null);
                        if (nodeId) void captureVideoNodeFrame(nodeId, "current", time);
                    }}
                />

                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

                {cropNode?.metadata?.content ? (
                    <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} />
                ) : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog
                        dataUrl={maskEditNode.metadata.content}
                        open={Boolean(maskEditNode)}
                        onClose={() => setMaskEditNodeId(null)}
                        onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)}
                    />
                ) : null}

                {splitNode?.metadata?.content ? (
                    <CanvasNodeSplitDialog
                        dataUrl={splitNode.metadata.content}
                        open={Boolean(splitNode)}
                        onClose={() => setSplitNodeId(null)}
                        onConfirm={(params) => void splitImageNode(splitNode!, params)}
                    />
                ) : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog
                        dataUrl={upscaleNode.metadata.content}
                        open={Boolean(upscaleNode)}
                        onClose={() => setUpscaleNodeId(null)}
                        onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)}
                    />
                ) : null}

                <Modal title={t("canvas.projectPage.superResolve")} open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">{t("canvas.projectPage.notImplemented")}</div>
                </Modal>

                {angleNode?.metadata?.content ? (
                    <CanvasNodeAngleDialog
                        dataUrl={angleNode.metadata.content}
                        open={Boolean(angleNode)}
                        onClose={() => setAngleNodeId(null)}
                        onConfirm={(params) => void generateAngleNode(angleNode!, params)}
                    />
                ) : null}

                <Modal
                    title={t("canvas.projectPage.imageDetails")}
                    open={Boolean(previewImageContent)}
                    centered
                    onCancel={() => {
                        setPreviewNodeId(null);
                        setPreviewImageId(null);
                    }}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewImageContent ? (
                        <img src={previewImageContent} alt={previewNode?.title || t("assets.kinds.image")} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
                    ) : null}
                </Modal>

                <Modal
                    title={t("canvas.projectPage.clearTitle")}
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>{t("common.cancel")}</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                {t("canvas.projectPage.clear")}
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">{t("canvas.projectPage.clearDescription")}</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
                <Modal
                    title="恢复 APIMart 原视频任务"
                    open={Boolean(manualRecoveryNodeId)}
                    okText="恢复原任务"
                    cancelText="取消"
                    onOk={submitManualVideoRecovery}
                    onCancel={() => (setManualRecoveryNodeId(null), setManualRecoveryTaskId(""))}
                >
                    <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">仅查询并恢复已有任务，不会重新提交视频生成或再次计费。</p>
                    <Input value={manualRecoveryTaskId} placeholder="task_..." onChange={(event) => setManualRecoveryTaskId(event.target.value)} />
                </Modal>
            </section>
        </main>
    );
}
