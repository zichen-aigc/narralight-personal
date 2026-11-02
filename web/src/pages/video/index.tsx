import { GrokVideoPromptGuide } from "@/components/grok-video-prompt-guide";
import { VideoSettingsPopover } from "@/components/video-settings-popover";
import { VideoReferenceModeBar } from "@/components/video-settings-panel";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { ModelPicker } from "@/components/model-picker";
import { AssetValidationBatchButton } from "@/components/asset-validation-control";
import { CanvasPromptChipInput } from "@/components/canvas/canvas-prompt-chip-input";
import { DeferredCanvasVideo } from "@/components/canvas/deferred-canvas-video";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { Button, Checkbox, Drawer, Input, Modal, Tag } from "antd";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, Plus, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { type VolcAssetBinding, type VolcAssetValidationReference } from "@/services/volc-asset-validation";
import { type VideoSubmissionState } from "@/services/video-submission-feedback";
import { VideoGenerationTask } from "@/services/api/video";
import { type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { type DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { App, Empty } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { grokApimartVideoCapabilitiesFor, isGrokApimartVideoModel, normalizeGrokApimartVideoSettings } from "@/lib/grok-apimart-video";
import { apimartGrokOfficialVideoCapabilitiesFor, normalizeApimartGrokOfficialVideoSettings } from "@/lib/apimart-grok-official-video";
import { validateApimartGrokOfficialVideoRequest } from "@/services/api/apimart-grok-official-video";
import { compileGrokReferencePrompt, grokReferenceBatchIssue } from "@/lib/grok-video-prompt";
import { useGrokOfficialReadiness } from "@/hooks/use-grok-official-readiness";
import { isRunningHubGrokVideoModel, normalizeRunningHubGrokSettings, runningHubGrokCapabilitiesFor, runningHubGrokMediaTypeAllowed } from "@/lib/runninghub-grok-video";
import {
    boolConfig,
    isSeedanceVideoConfig,
    normalizeResolutionToken,
    normalizeSeedanceRatio,
    normalizeSeedanceVideoFile,
    seedanceReferenceLabel,
    seedanceVideoReferenceError,
    seedanceVideoReferenceHint,
    SEEDANCE_REFERENCE_LIMITS,
    SEEDANCE_VIDEO_MIME_TYPES,
} from "@/lib/seedance-video";
import { isMiniMaxH3Model, normalizeMiniMaxH3Settings } from "@/lib/minimax-h3-capabilities";
import { seedanceCapabilitiesFor } from "@/lib/seedance-model-capabilities";
import { deleteStoredMedia, resolveMediaUrl, uploadMediaFile } from "@/services/platform-file-storage";
import { resolveImageUrl, uploadImage } from "@/services/platform-image-storage";
import { assertPlainGrokVideoPrompt, validateGrokApimartVideoRequest } from "@/services/api/apimart-grok-video";
import { validateRunningHubGrokRequest } from "@/services/api/runninghub";
import { createPersistedVideoTask, recoverAndStoreVideoTask } from "@/services/video-task-recovery";
import { describeVideoSubmissionFailure, resolveVideoSubmissionFailure, videoSubmissionRetryDecision, waitForVideoSubmissionRelease } from "@/services/video-submission-feedback";
import { createVideoGenerationTake, readVideoGenerationTake, videoTakeParameters } from "@/services/video-generation-take";
import { listGenerationTasks } from "@/services/generation-task";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { modelProfileOf, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";
import { assetValidationRef, resolveVolcAssetReferenceUrl } from "@/services/volc-asset-validation";
import { useAssetValidationStore } from "@/stores/use-asset-validation-store";
import { resolveReferencePrompt } from "@/lib/reference-prompt";

import { useRuntimeStore } from "@/stores/use-runtime-store";
import { currentBackendContractContext } from "@/lib/backend-model-contract";
import { verifyWorkbenchProject, workbenchProjectId } from "./workbench-project";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    projectId?: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
    takeId?: string;
    videoSubmissionState?: VideoSubmissionState;
    primaryEditVideoId?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoReferenceMode" | "videoOutputFormat">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

function workbenchValidationReferences(projectId: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]): VolcAssetValidationReference[] {
    return [
        ...images.map((reference) => ({
            localRef: assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }),
            projectId,
            mediaKind: "image" as const,
            title: reference.name,
            previewUrl: reference.url || reference.dataUrl,
        })),
        ...videos.map((reference) => ({
            localRef: assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }),
            projectId,
            mediaKind: "video" as const,
            title: reference.name,
            previewUrl: reference.url,
        })),
        ...audios.map((reference) => ({
            localRef: assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }),
            projectId,
            mediaKind: "audio" as const,
            title: reference.name,
        })),
    ];
}

function workbenchRequestReferences(projectId: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], bindings: VolcAssetBinding[]) {
    return {
        images: images.map((reference) => {
            const url = resolveVolcAssetReferenceUrl(reference.url || reference.dataUrl, assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }), bindings);
            return url.startsWith("asset://") ? { ...reference, url, dataUrl: url } : reference;
        }),
        videos: videos.map((reference) => ({
            ...reference,
            url: resolveVolcAssetReferenceUrl(reference.url, assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }), bindings),
        })),
        audios: audios.map((reference) => ({
            ...reference,
            url: resolveVolcAssetReferenceUrl(reference.url, assetValidationRef({ storageKey: reference.storageKey, projectId, nodeId: reference.id }), bindings),
        })),
    };
}

const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const activeTakeLogIdsRef = useRef<Set<string>>(new Set());

    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const applyLastGenerationSettings = useConfigStore((state) => state.applyLastGenerationSettings);
    const rememberGenerationSettings = useConfigStore((state) => state.rememberGenerationSettings);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [primaryEditVideoId, setPrimaryEditVideoId] = useState("");
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState<"image" | "video" | "audio" | null>(null);
    const [manualRecoveryLogId, setManualRecoveryLogId] = useState<string | null>(null);
    const [manualRecoveryTaskId, setManualRecoveryTaskId] = useState("");
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const referenceImportBusy = useRef(false);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const identityStatus = useRuntimeStore((state) => state.status);
    const profile = useRuntimeStore((state) => state.meta?.profile);

    const [selectedProjectId, setSelectedProjectId] = useState("");

    const projectId = workbenchProjectId(profile, identityStatus);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const selectedProfile = modelProfileOf(effectiveConfig, model);
    const grokCapabilities = selectedProfile?.grokVideoCapabilities || grokApimartVideoCapabilitiesFor(model);
    const officialGrokCapabilities = apimartGrokOfficialVideoCapabilitiesFor(model);
    const officialReadiness = useGrokOfficialReadiness(model);
    const runningHubGrokCapabilities = selectedProfile?.runningHubGrokCapabilities || runningHubGrokCapabilitiesFor(model);
    const grokModel = Boolean(officialGrokCapabilities || grokCapabilities || runningHubGrokCapabilities);
    const acceptsImages = officialGrokCapabilities
        ? Boolean(officialGrokCapabilities.references.images)
        : Boolean(grokCapabilities || !runningHubGrokCapabilities || runningHubGrokCapabilities.references.images);
    const acceptsVideos = officialGrokCapabilities
        ? Boolean(officialGrokCapabilities.references.videos)
        : Boolean(!grokCapabilities && (!runningHubGrokCapabilities || runningHubGrokCapabilities.references.videos));
    const acceptsAudios = !grokModel;
    const promptReferences = [
        ...references.map((reference, index) => ({
            id: `image:${reference.id}`,
            nodeId: `image:${reference.id}`,
            kind: "image" as const,
            label: seedanceReferenceLabel("image", index),
            title: reference.name,
            previewUrl: reference.dataUrl,
            active: true,
        })),
        ...videoReferences.map((reference, index) => ({
            id: `video:${reference.id}`,
            nodeId: `video:${reference.id}`,
            kind: "video" as const,
            label: seedanceReferenceLabel("video", index),
            title: reference.name,
            previewUrl: reference.url,
            active: true,
        })),
        ...audioReferences.map((reference, index) => ({
            id: `audio:${reference.id}`,
            nodeId: `audio:${reference.id}`,
            kind: "audio" as const,
            label: seedanceReferenceLabel("audio", index),
            title: reference.name,
            previewUrl: reference.url,
            active: true,
        })),
    ];

    const seedanceReferenceCapabilities = selectedProfile?.videoCapabilities || selectedProfile?.h3Capabilities || seedanceCapabilitiesFor(model);
    const modelCapabilities = officialGrokCapabilities || grokCapabilities || runningHubGrokCapabilities || seedanceReferenceCapabilities;
    const referenceLimits = {
        ...SEEDANCE_REFERENCE_LIMITS,
        ...(modelCapabilities ? { images: modelCapabilities.references.images, videos: modelCapabilities.references.videos, audios: modelCapabilities.references.audios } : {}),
        ...(grokCapabilities || selectedProfile?.h3Capabilities ? { imageMaxBytes: 20 * 1024 * 1024 } : {}),
        ...(officialGrokCapabilities ? { imageMaxBytes: 20 * 1024 * 1024, videoMaxBytes: 200 * 1024 * 1024 } : {}),
        ...(runningHubGrokCapabilities ? { imageMaxBytes: runningHubGrokCapabilities.references.imageMaxBytes, videoMaxBytes: runningHubGrokCapabilities.references.videoMaxBytes } : {}),
    };
    const acceptsRunningHubImageFile = (file: Pick<File, "name" | "type">) =>
        officialGrokCapabilities
            ? runningHubGrokMediaTypeAllowed(file.name, file.type, ["image/jpeg", "image/png", "image/webp", "image/gif"])
            : !runningHubGrokCapabilities || runningHubGrokMediaTypeAllowed(file.name, file.type, runningHubGrokCapabilities.references.imageMimeTypes);
    const acceptsRunningHubVideoFile = (file: Pick<File, "name" | "type">) =>
        officialGrokCapabilities
            ? runningHubGrokMediaTypeAllowed(file.name, file.type, ["video/mp4", "video/quicktime"])
            : !runningHubGrokCapabilities || runningHubGrokMediaTypeAllowed(file.name, file.type, runningHubGrokCapabilities.references.videoMimeTypes);
    const runningHubGrokFileAccept = runningHubGrokCapabilities
        ? [
              ...runningHubGrokCapabilities.references.imageMimeTypes,
              ...(runningHubGrokCapabilities.references.images ? [".jpg", ".jpeg", ".png", ".webp"] : []),
              ...runningHubGrokCapabilities.references.videoMimeTypes,
              ...(runningHubGrokCapabilities.references.videoMimeTypes.includes("video/mp4") ? [".mp4"] : []),
              ...(runningHubGrokCapabilities.references.videoMimeTypes.includes("video/quicktime") ? [".mov"] : []),
          ].join(",")
        : "";
    const runningHubGrokImageEmptyKey =
        runningHubGrokCapabilities?.workflow === "first_frame"
            ? "videoWorkbench.runningHubGrokFirstFrameEmpty"
            : runningHubGrokCapabilities?.workflow === "multi_image"
              ? "videoWorkbench.runningHubGrokMultiImageEmpty"
              : "videoWorkbench.noImages";
    const runningHubGrokVideoEmptyKey =
        runningHubGrokCapabilities?.workflow === "video_edit"
            ? "videoWorkbench.runningHubGrokEditVideoEmpty"
            : runningHubGrokCapabilities?.workflow === "video_extend"
              ? "videoWorkbench.runningHubGrokExtendVideoEmpty"
              : "videoWorkbench.noVideos";
    const usesPrimaryEditVideo = Boolean(
        selectedProfile?.videoCapabilities?.modes.video_edit.requestFields.includes("omni_reference_task_type") && effectiveConfig.videoReferenceMode === "video_edit",
    );
    const canGenerate = Boolean(prompt.trim() && projectId);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        applyLastGenerationSettings("video");
    }, [applyLastGenerationSettings]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    useEffect(() => {
        if (effectiveConfig.videoReferenceMode !== "video_edit") return;
        setPrimaryEditVideoId((current) => (videoReferences.some((video) => video.id === current) ? current : videoReferences.length === 1 ? videoReferences[0].id : ""));
    }, [effectiveConfig.videoReferenceMode, videoReferences]);

    const addReferences = async (files?: FileList | File[] | null) => {
        if (referenceImportBusy.current) {
            message.warning("上一批素材仍在导入，请完成后再添加。");
            return false;
        }
        referenceImportBusy.current = true;
        try {
            const selectedFiles = Array.from(files || []);
            if (grokModel) {
                const issue = grokReferenceBatchIssue(
                    { images: references.length, videos: videoReferences.length, audios: audioReferences.length },
                    {
                        images: selectedFiles.filter((file) => file.type.startsWith("image/")).length,
                        videos: selectedFiles.filter(isSupportedVideoFile).length,
                        audios: selectedFiles.filter(isSupportedAudioFile).length,
                    },
                    referenceLimits,
                );
                if (issue) {
                    message.warning(issue);
                    return false;
                }
            }
            if (
                grokModel &&
                selectedFiles.some((file) => (file.type.startsWith("image/") ? !acceptsImages : isSupportedVideoFile(file) ? !acceptsVideos : isSupportedAudioFile(file) ? !acceptsAudios : false))
            )
                message.warning(t("videoWorkbench.grokWorkflowAssets"));
            const unsupported = selectedFiles.filter((file) =>
                file.type.startsWith("image/") ? !acceptsRunningHubImageFile(file) : isSupportedVideoFile(file) ? !acceptsRunningHubVideoFile(file) : !isSupportedAudioFile(file),
            );
            if (unsupported.length) message.warning(t("videoWorkbench.unsupportedFiles"));
            if (
                grokModel &&
                (unsupported.length ||
                    selectedFiles.some(
                        (file) => (file.type.startsWith("image/") && file.size > referenceLimits.imageMaxBytes) || (isSupportedVideoFile(file) && file.size > referenceLimits.videoMaxBytes),
                    ))
            ) {
                message.warning(
                    `这批素材含不支持的格式或超出平台大小限制（图片${Math.round(referenceLimits.imageMaxBytes / 1024 / 1024)}MB、视频${Math.round(referenceLimits.videoMaxBytes / 1024 / 1024)}MB），未加入任何素材。`,
                );
                return false;
            }
            const imageFiles = acceptsImages
                ? selectedFiles
                      .filter((file) => file.type.startsWith("image/") && acceptsRunningHubImageFile(file) && file.size <= referenceLimits.imageMaxBytes)
                      .slice(0, Math.max(0, referenceLimits.images - references.length))
                : [];
            const videoFiles = acceptsVideos
                ? selectedFiles
                      .filter((file) => isSupportedVideoFile(file) && acceptsRunningHubVideoFile(file) && file.size <= referenceLimits.videoMaxBytes)
                      .slice(0, Math.max(0, referenceLimits.videos - videoReferences.length))
                : [];
            const audioFiles = acceptsAudios
                ? selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= referenceLimits.audioMaxBytes).slice(0, Math.max(0, referenceLimits.audios - audioReferences.length))
                : [];
            if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > referenceLimits.imageMaxBytes))
                message.warning(
                    t(runningHubGrokCapabilities ? "videoWorkbench.imageTooLargeForModel" : selectedProfile?.h3Capabilities ? "videoWorkbench.h3ImageTooLarge" : "videoWorkbench.imageTooLarge", {
                        size: Math.round(referenceLimits.imageMaxBytes / 1024 / 1024),
                    }),
                );
            if (selectedFiles.some((file) => isSupportedVideoFile(file) && file.size > referenceLimits.videoMaxBytes))
                message.warning(
                    t(runningHubGrokCapabilities ? "videoWorkbench.videoTooLargeForModel" : "videoWorkbench.videoTooLarge", { size: Math.round(referenceLimits.videoMaxBytes / 1024 / 1024) }),
                );
            if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > referenceLimits.audioMaxBytes)) message.warning(t("videoWorkbench.audioTooLarge"));
            const nextReferences = await Promise.all(
                imageFiles.map(async (file) => {
                    const image = await uploadImage(file);
                    return {
                        id: nanoid(),
                        name: file.name,
                        type: image.mimeType,
                        mimeType: image.mimeType,
                        dataUrl: image.url,
                        storageKey: image.storageKey,
                        width: image.width,
                        height: image.height,
                        bytes: image.bytes,
                    };
                }),
            );
            const nextVideoReferences = await Promise.all(
                videoFiles.map(async (file) => {
                    const video = await uploadMediaFile(normalizeSeedanceVideoFile(file), "video-reference");
                    return {
                        id: nanoid(),
                        name: file.name,
                        type: video.mimeType,
                        url: video.url,
                        storageKey: video.storageKey,
                        bytes: video.bytes,
                        width: video.width,
                        height: video.height,
                        durationMs: video.durationMs,
                    };
                }),
            );
            const nextAudioReferences = filterAudioReferencesByDuration(
                audioReferences,
                await Promise.all(
                    audioFiles.map(async (file) => {
                        const audio = await uploadMediaFile(file, "audio-reference");
                        return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                    }),
                ),
                message.warning,
                modelCapabilities?.references,
            );
            setReferences((value) => (grokModel ? [...value, ...nextReferences] : [...value, ...nextReferences].slice(0, referenceLimits.images)));
            setVideoReferences((value) => (grokModel ? [...value, ...nextVideoReferences] : [...value, ...nextVideoReferences].slice(0, referenceLimits.videos)));
            setAudioReferences((value) => (grokModel ? [...value, ...nextAudioReferences] : [...value, ...nextAudioReferences].slice(0, referenceLimits.audios)));
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材导入失败");
            return false;
        } finally {
            referenceImportBusy.current = false;
        }
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>, target: "image" | "video" | "audio") => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(target);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(null);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(null);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        if (!acceptsImages) {
            message.warning(t("videoWorkbench.grokWorkflowAssets"));
            return;
        }
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const acceptedBlobs = blobs.filter((blob) => acceptsRunningHubImageFile({ name: "clipboard.png", type: blob.type }));
            if (acceptedBlobs.length !== blobs.length) message.warning(t("videoWorkbench.unsupportedFiles"));
            const files = acceptedBlobs.map((blob, index) => new File([blob], `clipboard-${index + 1}.png`, { type: blob.type }));
            if (await addReferences(files)) message.success(t("videoWorkbench.clipboardAdded", { count: files.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async (historicalProjectId?: string) => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot(historicalProjectId);
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        const logId = nanoid();
        setResults([{ id: logId, status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        let pendingLog: GenerationLog | undefined;
        let takeId = "";
        try {
            const assertContext = () => {
                const identity = useRuntimeStore.getState();
                if (!snapshot.context || snapshot.context !== currentBackendContractContext() || identity.meta?.profile !== snapshot.profile || identity.status !== snapshot.identityStatus)
                    throw new Error("登录或运行环境已变化，请重新选择项目后生成");
            };
            assertContext();
            await verifyWorkbenchProject(snapshot.projectId, snapshot.profile);
            assertContext();
            const assetPreflight = await useAssetValidationStore
                .getState()
                .preflight(snapshot.config, workbenchValidationReferences(snapshot.projectId, snapshot.references, snapshot.videoReferences, snapshot.audioReferences));
            if (!assetPreflight.allowed) throw new Error(t("assetValidation.blocked"));
            assertContext();
            const requestReferences = workbenchRequestReferences(snapshot.projectId, snapshot.references, snapshot.videoReferences, snapshot.audioReferences, assetPreflight.bindings);
            rememberGenerationSettings("video", { ...snapshot.config, model, videoModel: model, videoReferenceMode: runningHubGrokCapabilities ? snapshot.config.videoReferenceMode : "omni" });
            const take = await createVideoGenerationTake({
                projectId: snapshot.projectId,
                nodeId: `workbench:${logId}`,
                prompt: snapshot.text,
                model,
                parameters: videoTakeParameters(snapshot.config),
            });
            takeId = take.takeId;
            pendingLog = buildLog({
                id: logId,
                projectId: snapshot.projectId,
                prompt: snapshot.prompt,
                model,
                config: snapshot.config,
                references: snapshot.references,
                videoReferences: snapshot.videoReferences,
                audioReferences: snapshot.audioReferences,
                durationMs: 0,
                status: "pending",
                takeId,
                videoSubmissionState: "not_submitted",
                primaryEditVideoId: snapshot.primaryEditVideoId,
            });
            await saveLog(pendingLog, false);
            assertContext();
            await verifyWorkbenchProject(snapshot.projectId, snapshot.profile);
            assertContext();
            const { task } = await createPersistedVideoTask(snapshot.config, snapshot.text, requestReferences.images, requestReferences.videos, requestReferences.audios, {
                projectId: snapshot.projectId,
                nodeId: `workbench:${logId}`,
                takeId,
                primaryEditVideoId: snapshot.primaryEditVideoId,
            });
            const log = { ...pendingLog, task, videoSubmissionState: "submitted" as const };
            await saveLog(log, false);
            void pollGenerationLog(log, snapshot.config, agentTaskId);
        } catch (error) {
            const rawErrorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            const feedback = takeId ? await resolveVideoSubmissionFailure(takeId, error) : undefined;
            const errorMessage = feedback?.message || `${rawErrorMessage} · ${t("videoSubmission.notSubmitted")}`;
            if (pendingLog && feedback?.take && ["submitting", "submission_unknown", "pending", "result_pending"].includes(feedback.take.status)) {
                const recovering = { ...pendingLog, status: "pending" as const, error: feedback.message, videoSubmissionState: feedback.state };
                await saveLog(recovering, false);
                void resumePendingTakeLog(recovering);
                message.warning(feedback.message);
                return;
            }
            setResults([{ id: logId, status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog(
                buildLog({
                    id: logId,
                    projectId: snapshot.projectId,
                    prompt: snapshot.prompt,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    videoReferences: snapshot.videoReferences,
                    audioReferences: snapshot.audioReferences,
                    durationMs: performance.now() - batchStartedAt,
                    status: "failed",
                    error: errorMessage,
                    takeId: takeId || undefined,
                    videoSubmissionState: feedback?.state || "not_submitted",
                    primaryEditVideoId: snapshot.primaryEditVideoId,
                }),
            );
            message.error(errorMessage);
            setRunning(false);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = (historicalProjectId?: string) => {
        const targetProjectId = historicalProjectId === undefined ? projectId : workbenchProjectId(profile, identityStatus);
        if (!targetProjectId) {
            message.error("请先选择一个可编辑的所属项目；历史记录缺少项目归属时，请新建生成会话。");
            return null;
        }
        if (!officialReadiness.canSubmit) {
            message.error(officialReadiness.reason);
            return null;
        }
        let stablePrompt = prompt.trim();
        if (!stablePrompt) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (grokModel) {
            try {
                stablePrompt = compileGrokReferencePrompt(stablePrompt, promptReferences);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "素材引用无法解析");
                return null;
            }
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        const actualVideoReferences = videoReferences;
        const actualAudioReferences = audioReferences;
        const requestConfig = buildVideoConfig(effectiveConfig, model);
        if (grokModel && ((!acceptsImages && references.length) || (!acceptsVideos && actualVideoReferences.length) || (!acceptsAudios && actualAudioReferences.length))) {
            message.error(`${t("videoWorkbench.incompatibleReferencesRetained")} · ${t("videoSubmission.notSubmitted")}`);
            return null;
        }
        if (grokCapabilities) {
            try {
                assertPlainGrokVideoPrompt(stablePrompt);
                validateGrokApimartVideoRequest({
                    model,
                    prompt: stablePrompt,
                    resolution: requestConfig.vquality,
                    size: requestConfig.size,
                    duration: Number(requestConfig.videoSeconds),
                    imageCount: references.length,
                    videoCount: actualVideoReferences.length,
                    audioCount: actualAudioReferences.length,
                });
            } catch (error) {
                message.error(`${error instanceof Error ? error.message : t("videoWorkbench.invalidParams")} · ${t("videoSubmission.notSubmitted")}`);
                return null;
            }
        }
        if (officialGrokCapabilities) {
            try {
                validateApimartGrokOfficialVideoRequest({
                    model,
                    prompt: stablePrompt,
                    resolution: requestConfig.vquality,
                    ratio: requestConfig.size,
                    duration: Number(requestConfig.videoSeconds),
                    imageCount: references.length,
                    videoCount: actualVideoReferences.length,
                    audioCount: actualAudioReferences.length,
                });
            } catch (error) {
                message.error(`${error instanceof Error ? error.message : t("videoWorkbench.invalidParams")} · ${t("videoSubmission.notSubmitted")}`);
                return null;
            }
        }
        if (runningHubGrokCapabilities) {
            try {
                validateRunningHubGrokRequest({
                    model,
                    prompt: stablePrompt,
                    resolution: requestConfig.vquality,
                    ratio: requestConfig.size,
                    duration: runningHubGrokCapabilities.workflow === "video_edit" ? 0 : Number(requestConfig.videoSeconds),
                    imageUrls: references.map(() => "https://pending.invalid/image"),
                    videoUrls: actualVideoReferences.map(() => "https://pending.invalid/video"),
                    imageBytes: references.map((item) => item.bytes),
                    videoBytes: actualVideoReferences.map((item) => item.bytes),
                    imageMimeTypes: references.map((item) => item.mimeType || item.type),
                    videoMimeTypes: actualVideoReferences.map((item) => item.type),
                    videoDurationsMs: actualVideoReferences.map((item) => item.durationMs),
                });
            } catch (error) {
                message.error(`${error instanceof Error ? error.message : t("videoWorkbench.invalidParams")} · ${t("videoSubmission.notSubmitted")}`);
                return null;
            }
        }
        const videoReferenceError = grokModel ? "" : seedanceVideoReferenceError(actualVideoReferences, seedanceReferenceCapabilities);
        if (videoReferenceError) {
            const hint = selectedProfile?.h3Capabilities ? t("videoWorkbench.h3ReferenceHint") : seedanceVideoReferenceHint();
            message.error(`${t("videoWorkbench.referenceError", { error: videoReferenceError, hint })} · ${t("videoSubmission.notSubmitted")}`);
            return null;
        }
        const editing25 = Boolean(selectedProfile?.videoCapabilities?.modes.video_edit.requestFields.includes("omni_reference_task_type") && effectiveConfig.videoReferenceMode === "video_edit");
        const selectedPrimaryId = actualVideoReferences.some((video) => video.id === primaryEditVideoId) ? primaryEditVideoId : actualVideoReferences.length === 1 ? actualVideoReferences[0].id : "";
        if (editing25 && actualVideoReferences.length > 1 && !selectedPrimaryId) {
            message.error("多份视频参考时，请先选择哪一份是待编辑原片");
            return null;
        }
        return {
            projectId: targetProjectId,
            profile,
            identityStatus,
            context: currentBackendContractContext(),
            prompt: prompt.trim(),
            text: grokModel ? stablePrompt : resolveReferencePrompt(stablePrompt, promptReferences),
            config: requestConfig,
            references: [...references],
            videoReferences: [...actualVideoReferences],
            audioReferences: [...actualAudioReferences],
            primaryEditVideoId: editing25 ? selectedPrimaryId : undefined,
        };
    };

    const retryResult = async () => {
        const failedId = results.find((result) => result.status === "failed")?.id;
        const log = (failedId && logs.find((item) => item.id === failedId)) || previewLog || undefined;
        if (log?.task) {
            const pending = { ...log, status: "pending" as const, error: undefined };
            await saveLog(pending, false);
            void pollGenerationLog(pending);
            return;
        }
        if (log?.takeId) {
            const take = await readVideoGenerationTake(log.takeId).catch(() => undefined);
            if (!take) {
                message.error(t("videoSubmission.unconfirmed"));
                return;
            }
            const decision = videoSubmissionRetryDecision(take);
            let releasedTake = take;
            if (decision === "wait_for_reconciliation") {
                const closeWaiting = message.loading(t("videoSubmission.unknown"), 0);
                try {
                    releasedTake = await waitForVideoSubmissionRelease(take);
                } finally {
                    closeWaiting();
                }
            }
            if (releasedTake.taskId && releasedTake.provider) {
                const pending = {
                    ...log,
                    projectId: releasedTake.projectId || log.projectId,
                    status: "pending" as const,
                    error: undefined,
                    videoSubmissionState: "submitted" as const,
                    task: { id: releasedTake.taskId, provider: releasedTake.provider, model: releasedTake.model || log.model },
                };
                await saveLog(pending, false);
                void pollGenerationLog(pending);
                return;
            }
            if (["safe_resubmit", "allow_new_submission", "wait_for_reconciliation"].includes(decision)) {
                const originalProjectId = releasedTake.projectId || log.projectId || "";
                await saveLog({ ...log, projectId: originalProjectId || undefined }, false);
                void generate(originalProjectId);
                return;
            }
            const feedback = describeVideoSubmissionFailure(take);
            message.error(feedback.message);
            return;
        }
        if (log && String(log.model || "").startsWith("apimart::")) {
            setManualRecoveryTaskId("");
            setManualRecoveryLogId(log.id);
            return;
        }
        if (log) {
            message.error(t("videoSubmission.unconfirmed"));
            return;
        }
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, video.mimeType === "video/quicktime" ? "video.mov" : "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType, durationMs: video.durationMs },
            metadata: { source: "video-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (grokModel && payload.kind !== "text") {
            const issue = grokReferenceBatchIssue(
                { images: references.length, videos: videoReferences.length, audios: audioReferences.length },
                { images: Number(payload.kind === "image"), videos: Number(payload.kind === "video"), audios: 0 },
                referenceLimits,
            );
            if (issue) {
                message.warning(issue);
                return;
            }
        }
        if (referenceImportBusy.current) {
            message.warning("上一批素材仍在导入，请完成后再添加。");
            return;
        }
        referenceImportBusy.current = true;
        try {
            if (payload.kind === "text") {
                setPrompt(payload.content);
            } else if (payload.kind === "image") {
                if (!acceptsImages) {
                    message.warning(t("videoWorkbench.grokWorkflowAssets"));
                    setAssetPickerOpen(false);
                    return;
                }
                if (!acceptsRunningHubImageFile({ name: payload.title, type: payload.mimeType || "" })) {
                    message.warning(t("videoWorkbench.unsupportedFiles"));
                    setAssetPickerOpen(false);
                    return;
                }
                const stored = await uploadImage(payload.dataUrl);
                setReferences((value) =>
                    [
                        ...value,
                        {
                            id: nanoid(),
                            name: payload.title,
                            type: stored.mimeType,
                            mimeType: stored.mimeType,
                            dataUrl: stored.url,
                            storageKey: stored.storageKey,
                            width: stored.width,
                            height: stored.height,
                            bytes: stored.bytes,
                        },
                    ].slice(0, referenceLimits.images),
                );
            } else if (payload.kind === "video") {
                if (!acceptsVideos) {
                    message.warning(t("videoWorkbench.grokWorkflowAssets"));
                    setAssetPickerOpen(false);
                    return;
                }
                if (!acceptsRunningHubVideoFile({ name: payload.title, type: payload.mimeType || "" })) {
                    message.warning(t("videoWorkbench.unsupportedFiles"));
                    setAssetPickerOpen(false);
                    return;
                }
                setVideoReferences((value) =>
                    [
                        ...value,
                        {
                            id: nanoid(),
                            name: payload.title,
                            type: payload.mimeType || "video/mp4",
                            url: payload.url,
                            storageKey: payload.storageKey,
                            bytes: payload.bytes,
                            width: payload.width,
                            height: payload.height,
                            durationMs: payload.durationMs,
                        },
                    ].slice(0, referenceLimits.videos),
                );
            }
            setAssetPickerOpen(false);
        } finally {
            referenceImportBusy.current = false;
        }
    };

    const createSession = () => {
        applyLastGenerationSettings("video");
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setPrimaryEditVideoId("");
        setAudioReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const mediaKeys = logs
            .filter((log) => selectedLogIds.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        void Promise.all([deleteStoredMedia(mediaKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]).then(() => refreshLogs());
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        await logStore.setItem(log.id, serializeLog(log));
        await refreshLogs(resumePending);
    };

    const refreshLogs = async (resumePending = true) => {
        let nextLogs = await readStoredLogs();
        const existingIds = new Set(nextLogs.map((item) => item.id));
        const serverTasks = await listGenerationTasks().catch(() => []);
        for (const record of serverTasks) {
            if (record.mediaKind !== "video" || !record.nodeId?.startsWith("workbench:")) continue;
            const id = record.nodeId.slice("workbench:".length);
            if (!id) continue;
            if (existingIds.has(id)) {
                const existing = nextLogs.find((item) => item.id === id);
                if (existing && !existing.projectId && record.projectId && existing.task?.id === record.taskId && existing.task.provider === record.provider)
                    await logStore.setItem(id, serializeLog({ ...existing, projectId: record.projectId }));
                continue;
            }
            const archivedVideo = record.archivedResult
                ? {
                      id: nanoid(),
                      url: record.archivedResult.url,
                      storageKey: record.archivedResult.storageKey,
                      durationMs: 0,
                      width: 0,
                      height: 0,
                      bytes: record.archivedResult.bytes,
                      mimeType: record.archivedResult.mimeType,
                  }
                : undefined;
            const recovered = buildLog({
                id,
                projectId: record.projectId,
                prompt: "",
                model: record.model,
                config: buildVideoConfig(effectiveConfig, record.model),
                references: [],
                videoReferences: [],
                audioReferences: [],
                durationMs: 0,
                status: archivedVideo ? "success" : record.status === "failed" ? "failed" : "pending",
                task: { id: record.taskId, provider: record.provider, model: record.model },
                video: archivedVideo,
                error: record.status === "completed" && !archivedVideo ? "上游任务已完成，等待恢复本地视频" : undefined,
            });
            await logStore.setItem(id, serializeLog(recovered));
            existingIds.add(id);
        }
        if (serverTasks.length) nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
            else if (log.status === "pending" && log.takeId) void resumePendingTakeLog(log);
        }
    };

    const resumePendingTakeLog = async (log: GenerationLog) => {
        if (!log.takeId || activeTakeLogIdsRef.current.has(log.id)) return;
        const originalTakeId = log.takeId;
        activeTakeLogIdsRef.current.add(log.id);
        setRunning(true);
        setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        try {
            for (let attempt = 0; attempt < 1200; attempt += 1) {
                const take = await readVideoGenerationTake(originalTakeId);
                log = { ...log, projectId: take.projectId || log.projectId };
                if (take.status === "created") {
                    const feedback = await resolveVideoSubmissionFailure(take.takeId, new Error(t("workbench.generationFailed")));
                    const failed = { ...log, status: "failed" as const, error: feedback.message, videoSubmissionState: feedback.state };
                    setResults([{ id: log.id, status: "failed", error: feedback.message }]);
                    await saveLog(failed, false);
                    return;
                }
                if (take.taskId && take.provider) {
                    const linked = { ...log, projectId: take.projectId || log.projectId, task: { id: take.taskId, provider: take.provider, model: take.model || log.model }, error: undefined };
                    await saveLog(linked, false);
                    void pollGenerationLog(linked);
                    return;
                }
                if (take.status === "completed" && take.media) {
                    const video: GeneratedVideo = {
                        id: nanoid(),
                        url: take.media.url,
                        storageKey: take.media.storageKey,
                        durationMs: take.media.durationMs || 0,
                        width: take.media.width || 0,
                        height: take.media.height || 0,
                        bytes: take.media.bytes,
                        mimeType: take.media.mimeType,
                    };
                    const completed = { ...log, projectId: take.projectId || log.projectId, status: "success" as const, video, durationMs: Date.now() - log.createdAt, error: undefined };
                    setResults([{ id: video.id, status: "success", video }]);
                    await saveLog(completed, false);
                    return;
                }
                if (take.status === "failed") {
                    const feedback = describeVideoSubmissionFailure(take);
                    const error = feedback.message;
                    setResults([{ id: log.id, status: "failed", error }]);
                    await saveLog({ ...log, status: "failed", error, videoSubmissionState: feedback.state }, false);
                    return;
                }
                await delay(3000);
            }
            await saveLog({ ...log, error: "原任务仍由本地平台后台恢复，刷新后可继续查看" }, false);
        } catch (error) {
            await saveLog({ ...log, error: error instanceof Error ? error.message : "读取原任务失败" }, false);
        } finally {
            activeTakeLogIdsRef.current.delete(log.id);
            if (!activeTakeLogIdsRef.current.size && !activeLogIdsRef.current.size) setRunning(false);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            const stored = await recoverAndStoreVideoTask(
                configOverride || taskConfig,
                log.task,
                { projectId: log.projectId, nodeId: `workbench:${log.id}`, takeId: log.takeId },
                {
                    onProgress: async () => {
                        await logStore.setItem(log.id, serializeLog({ ...log, status: "pending", task: log.task, error: undefined }));
                    },
                },
            );
            const nextVideo: GeneratedVideo = {
                id: nanoid(),
                url: stored.url,
                storageKey: stored.storageKey,
                durationMs: stored.durationMs || 0,
                width: stored.width || 0,
                height: stored.height || 0,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            };
            setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
            await saveLog({ ...log, status: "success", durationMs: Date.now() - log.createdAt, video: nextVideo, error: undefined });
            message.success(t("videoWorkbench.generated"));
            return;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLog({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setSelectedProjectId(log.projectId || "");
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setPrimaryEditVideoId(log.primaryEditVideoId || "");
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoReferenceMode) updateConfig("videoReferenceMode", log.config.videoReferenceMode);
        if (log.config.videoOutputFormat) updateConfig("videoOutputFormat", log.config.videoOutputFormat);
        setResults(
            log.status === "pending"
                ? [{ id: log.id, status: "pending" }]
                : log.video
                  ? [{ id: log.video.id, status: "success", video: log.video }]
                  : [{ id: log.id, status: "failed", error: log.error || t("workbench.generationFailed") }],
        );
    };

    const submitManualRecovery = async () => {
        const taskId = manualRecoveryTaskId.trim();
        const log = logs.find((item) => item.id === manualRecoveryLogId);
        if (!log || !/^task_[a-zA-Z0-9_-]{8,160}$/.test(taskId)) {
            message.error("请输入有效的 APIMart task_id");
            return;
        }
        const pending = { ...log, status: "pending" as const, error: undefined, task: { id: taskId, provider: "apimart" as const, model: log.model } };
        setManualRecoveryLogId(null);
        setManualRecoveryTaskId("");
        await saveLog(pending, false);
        void pollGenerationLog(pending);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-x-hidden overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                    />
                </aside>

                <section className="grid min-w-0 gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex min-w-0 flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("videoWorkbench.title")}</h1>
                            <div className="flex shrink-0 gap-2 lg:hidden">
                                <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    {t("workbench.logs")}
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            {!projectId ? (
                                <p role="status" className="text-xs">
                                    正在确认登录与项目环境，暂不能生成。
                                </p>
                            ) : null}
                            <VideoReferenceModeBar config={effectiveConfig} onConfigChange={(key, value) => updateConfig(key, value)} />
                            <div>
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="shrink-0 text-base font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <CanvasPromptChipInput
                                    value={prompt}
                                    references={promptReferences}
                                    onChange={setPrompt}
                                    className="min-h-[168px] w-full rounded-lg border border-stone-200 px-3 py-2 text-sm leading-6 dark:border-stone-800"
                                    placeholder={t("videoWorkbench.promptPlaceholder")}
                                />
                            </div>

                            <GrokVideoPromptGuide model={model} imageCount={references.length} />
                            {officialReadiness.reason ? (
                                <p className="text-xs leading-5" role="status">
                                    {officialReadiness.reason}
                                </p>
                            ) : null}

                            {acceptsImages || references.length ? (
                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-base font-semibold">{t("videoWorkbench.references")}</span>
                                        {acceptsImages ? (
                                            <div className="flex gap-2">
                                                <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                                    {t("workbench.clipboard")}
                                                </Button>
                                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                                    {t("workbench.upload")}
                                                </Button>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-amber-600 dark:text-amber-300">{t("videoWorkbench.incompatibleReferencesRetained")}</span>
                                        )}
                                    </div>
                                    <div
                                        className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget === "image" ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                        onDragEnter={(event) => handleReferenceDragEnter(event, "image")}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={handleReferenceDragLeave}
                                        onDrop={handleReferenceDrop}
                                    >
                                        {references.map((item, index) => (
                                            <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                                <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                                    {seedanceReferenceLabel("image", index)}
                                                </span>
                                                <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                                <button
                                                    type="button"
                                                    className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                    onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label={t("videoWorkbench.removeImage")}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                        {!references.length ? (
                                            <div className="flex min-w-full items-center justify-center text-sm text-stone-500">
                                                {referenceDragTarget === "image" ? t("videoWorkbench.dropReferences") : t(runningHubGrokImageEmptyKey)}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            {acceptsVideos || videoReferences.length ? (
                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-base font-semibold">{t("videoWorkbench.videoReferences")}</span>
                                        <div className="flex items-center gap-2">
                                            {usesPrimaryEditVideo && videoReferences.length > 1 && !primaryEditVideoId ? (
                                                <span className="text-xs text-amber-600 dark:text-amber-300">请选择待编辑原片</span>
                                            ) : null}
                                            {acceptsVideos ? (
                                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                                    {t("workbench.upload")}
                                                </Button>
                                            ) : (
                                                <span className="text-xs text-amber-600 dark:text-amber-300">{t("videoWorkbench.incompatibleReferencesRetained")}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div
                                        className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget === "video" ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                        onDragEnter={(event) => handleReferenceDragEnter(event, "video")}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={handleReferenceDragLeave}
                                        onDrop={handleReferenceDrop}
                                    >
                                        {videoReferences.map((item, index) => (
                                            <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800">
                                                <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                                    {seedanceReferenceLabel("video", index)}
                                                </span>
                                                {usesPrimaryEditVideo ? (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        aria-pressed={primaryEditVideoId === item.id}
                                                        className="!absolute !left-1/2 !top-1 !z-10 !h-5 !-translate-x-1/2 !rounded-full !bg-black/65 !px-1.5 !text-[10px] !text-white"
                                                        icon={<Check className={`size-3 ${primaryEditVideoId === item.id ? "opacity-100" : "opacity-35"}`} />}
                                                        onClick={() => setPrimaryEditVideoId(item.id)}
                                                    >
                                                        主片
                                                    </Button>
                                                ) : null}
                                                <ReferenceOrderButtons
                                                    index={index}
                                                    total={videoReferences.length}
                                                    onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))}
                                                />
                                                <button
                                                    type="button"
                                                    className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                    onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label={t("videoWorkbench.removeVideo")}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                        {!videoReferences.length ? (
                                            <div className="flex min-w-full items-center justify-center text-sm text-stone-500">
                                                {referenceDragTarget === "video" ? t("videoWorkbench.dropReferences") : t(runningHubGrokVideoEmptyKey)}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            {acceptsAudios || audioReferences.length ? (
                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-base font-semibold">{t("videoWorkbench.audioReferences")}</span>
                                        {acceptsAudios ? (
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                                {t("workbench.upload")}
                                            </Button>
                                        ) : (
                                            <span className="text-xs text-amber-600 dark:text-amber-300">{t("videoWorkbench.incompatibleReferencesRetained")}</span>
                                        )}
                                    </div>
                                    <div
                                        className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget === "audio" ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                        onDragEnter={(event) => handleReferenceDragEnter(event, "audio")}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={handleReferenceDragLeave}
                                        onDrop={handleReferenceDrop}
                                    >
                                        {audioReferences.map((item, index) => (
                                            <div
                                                key={item.id}
                                                className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900"
                                            >
                                                <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                    <Music2 className="size-4 shrink-0" />
                                                    <span className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                                                        {seedanceReferenceLabel("audio", index)}
                                                    </span>
                                                    <span className="truncate">{item.name}</span>
                                                </div>
                                                <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                                <ReferenceOrderButtons
                                                    index={index}
                                                    total={audioReferences.length}
                                                    onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))}
                                                />
                                                <button
                                                    type="button"
                                                    className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                    onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label={t("videoWorkbench.removeAudio")}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                        {!audioReferences.length ? (
                                            <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">
                                                {referenceDragTarget === "audio" ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noAudio")}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            <div className="flex justify-end">
                                <AssetValidationBatchButton
                                    config={{ ...effectiveConfig, model, videoModel: model }}
                                    references={projectId ? workbenchValidationReferences(projectId, references, videoReferences, audioReferences) : []}
                                    buttonClassName="!h-8 !rounded-md !px-2.5"
                                />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button
                                type="primary"
                                size="large"
                                block
                                icon={<Sparkles className="size-4" />}
                                loading={running}
                                disabled={!canGenerate || running || !officialReadiness.canSubmit}
                                onClick={() => void generate()}
                            >
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar min-w-0 rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={() => void retryResult()} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("videoWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <Modal
                title="恢复 APIMart 原视频任务"
                open={Boolean(manualRecoveryLogId)}
                okText="恢复原任务"
                cancelText="取消"
                onOk={() => void submitManualRecovery()}
                onCancel={() => (setManualRecoveryLogId(null), setManualRecoveryTaskId(""))}
            >
                <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">仅查询并恢复已有任务，不会重新提交视频生成或再次计费。</p>
                <Input value={manualRecoveryTaskId} placeholder="task_..." onChange={(event) => setManualRecoveryTaskId(event.target.value)} />
            </Modal>
            <input
                ref={fileInputRef}
                type="file"
                accept={
                    runningHubGrokCapabilities
                        ? runningHubGrokFileAccept
                        : acceptsImages && !acceptsVideos && !acceptsAudios
                          ? "image/*"
                          : acceptsVideos && !acceptsImages && !acceptsAudios
                            ? "video/mp4,video/quicktime,.mp4,.mov"
                            : "image/*,video/mp4,video/quicktime,.mp4,.mov,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                }
                multiple={!runningHubGrokCapabilities || runningHubGrokCapabilities.workflow === "multi_image"}
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />

            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                />
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal
                title={t("workbench.deleteLogs")}
                open={deleteConfirmOpen}
                onCancel={() => setDeleteConfirmOpen(false)}
                onOk={deleteSelectedLogs}
                okText={t("common.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
            >
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({
    config,
    model,
    updateConfig,
    openConfigDialog,
}: {
    config: AiConfig;
    model: string;
    updateConfig: UpdateAiConfig;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-semibold">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <VideoSettingsPopover
                config={config}
                placement="topRight"
                containerClassName="w-full sm:w-auto"
                buttonClassName="!h-8 !w-full !justify-start !rounded-md !px-2.5 sm:!max-w-[190px]"
                onConfigChange={(key, value) => updateConfig(key, value)}
            />
        </div>
    );
}

export function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    const source = video.storageKey || video.url;
    const [measured, setMeasured] = useState<{ source: string; width: number; height: number; durationMs: number }>();
    // Old local history can contain placeholder dimensions or generation latency.
    // Only the currently loaded media is authoritative, including when saving an asset.
    const actual = measured?.source === source ? { ...video, ...measured } : undefined;
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="aspect-video w-full">
                <DeferredCanvasVideo
                    key={source}
                    src={video.url}
                    storageKey={video.storageKey}
                    mimeType={video.mimeType}
                    bytes={video.bytes}
                    eager
                    onMetadata={(metadata) => setMeasured({ source, ...metadata })}
                />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>{actual ? `${actual.width}x${actual.height}` : "尺寸待读取"}</span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{actual ? formatDuration(actual.durationMs) : "时长待读取"}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" disabled={!actual} icon={<FolderPlus className="size-3.5" />} onClick={() => actual && onSaveAsset(actual)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video min-h-0 flex-col gap-3 p-5 text-center">
                <div className="shrink-0 text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-red-500 [overflow-wrap:anywhere] dark:text-red-300">{error}</div>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? (
                    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">
                        {t("workbench.noLogs")}
                    </div>
                ) : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red"}>
                        {t(`workbench.${log.status === "success" ? "success" : log.status === "pending" ? "generating" : "failed"}`)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        projectId: log.projectId,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
        takeId: log.takeId,
        videoSubmissionState: log.videoSubmissionState,
        primaryEditVideoId: log.primaryEditVideoId,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function isSupportedVideoFile(file: File) {
    return SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) || /\.(mp4|mov)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void, limits?: { maxAudioDurationMs: number; totalAudioDurationMs: number }) {
    const maxDurationMs = limits?.maxAudioDurationMs || 15_000;
    const totalLimitMs = limits?.totalAudioDurationMs || 15_000;
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > maxDurationMs)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > totalLimitMs) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn(i18n.t("videoWorkbench.audioDurationInvalid", { max: maxDurationMs / 1000, total: totalLimitMs / 1000 }));
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={() => onMove(1)}
            />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoReferenceMode: log.config?.videoReferenceMode || "omni",
        videoOutputFormat: log.config?.videoOutputFormat === "mov" ? "mov" : "mp4",
    };
}

function buildLog({
    id,
    projectId,
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    video,
    error,
    takeId,
    videoSubmissionState,
    primaryEditVideoId,
}: {
    id?: string;
    projectId?: string;
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
    takeId?: string;
    videoSubmissionState?: VideoSubmissionState;
    primaryEditVideoId?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoReferenceMode: config.videoReferenceMode,
        videoOutputFormat: config.videoOutputFormat,
    };
    return {
        id: id || nanoid(),
        projectId,
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
        takeId,
        videoSubmissionState,
        primaryEditVideoId,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const official = apimartGrokOfficialVideoCapabilitiesFor(model);
    const normalizedOfficial = normalizeApimartGrokOfficialVideoSettings(model, { resolution: config.vquality, ratio: config.size, duration: Number(config.videoSeconds) });
    const grok = isGrokApimartVideoModel(model);
    const runningHubGrok = isRunningHubGrokVideoModel(model);
    const seedance = isSeedanceVideoConfig({ ...config, model, videoModel: model });
    const h3 = isMiniMaxH3Model(model);
    const normalizedGrok = grok ? normalizeGrokApimartVideoSettings({ resolution: normalizeResolutionToken(config.vquality), ratio: config.size, duration: Number(config.videoSeconds) }) : null;
    const normalizedRunningHubGrok = runningHubGrok
        ? normalizeRunningHubGrokSettings(model, { resolution: normalizeResolutionToken(config.vquality), ratio: normalizeSeedanceRatio(config.size), duration: Number(config.videoSeconds) })
        : null;
    const normalizedH3 = h3
        ? normalizeMiniMaxH3Settings({ referenceMode: config.videoReferenceMode, resolution: config.vquality, ratio: normalizeSeedanceRatio(config.size), duration: Number(config.videoSeconds) })
        : null;
    return {
        ...config,
        model,
        videoModel: model,
        size:
            (official?.workflow === "video_edit" ? config.size : normalizedOfficial?.ratio) ??
            normalizedRunningHubGrok?.ratio ??
            normalizedGrok?.ratio ??
            normalizedH3?.ratio ??
            (seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size)),
        videoSeconds: normalizedOfficial
            ? official?.workflow === "video_edit"
                ? config.videoSeconds || "6"
                : String(normalizedOfficial.duration)
            : normalizedRunningHubGrok
              ? runningHubGrokCapabilitiesFor(model)?.workflow === "video_edit"
                  ? ""
                  : String(normalizedRunningHubGrok.duration)
              : normalizedGrok
                ? String(normalizedGrok.duration)
                : normalizedH3
                  ? String(normalizedH3.duration)
                  : seedance
                    ? config.videoSeconds
                    : normalizeVideoSeconds(config.videoSeconds),
        vquality:
            (official?.workflow === "video_edit" ? config.vquality : normalizedOfficial?.resolution) ??
            normalizedRunningHubGrok?.resolution ??
            normalizedGrok?.resolution ??
            normalizedH3?.resolution ??
            normalizeResolution(config.vquality),
        videoReferenceMode: official ? (official.workflow === "video_edit" ? "video_edit" : "omni") : normalizedRunningHubGrok?.referenceMode || config.videoReferenceMode,
        videoGenerateAudio: official || grok || runningHubGrok ? "false" : String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: official || grok || runningHubGrok ? "false" : String(boolConfig(config.videoWatermark, false)),
        videoOutputFormat: official || grok || runningHubGrok ? "mp4" : config.videoOutputFormat === "mov" ? "mov" : "mp4",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
