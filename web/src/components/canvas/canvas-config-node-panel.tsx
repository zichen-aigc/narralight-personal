import { CanvasVideoAssetValidationButton } from "./canvas-video-asset-validation";
import { CanvasReferenceStrip } from "./canvas-reference-strip";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { LocalH3WorkerBadge, VideoReferenceModeBar } from "@/components/video-settings-panel";
import { GrokVideoPromptGuide } from "@/components/grok-video-prompt-guide";
import { ModelPicker } from "@/components/model-picker";
import { Button, Segmented } from "antd";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, Video } from "lucide-react";
import { type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useGrokOfficialReadiness } from "@/hooks/use-grok-official-readiness";
import {
    defaultConfig,
    generationConfigWithLastSettings,
    imageGenerationCountWithLastSettings,
    resolveCanvasNodeModelForPresentation,
    useConfigStore,
    useEffectiveConfig,
    type AiConfig,
    type LastGenerationSettings,
} from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";

import { useThemeStore } from "@/stores/use-theme-store";

import { type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";

import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

import { moveCanvasResourceReference, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

import { isLocalH3Model } from "@/services/api/local-h3";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;

    projectId: string;

    readOnly?: boolean;

    isRunning: boolean;

    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };

    references: CanvasResourceReference[];

    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;

    onGenerate: (nodeId: string) => void;

    onStop: (nodeId: string) => void;

    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, projectId, readOnly = false, isRunning, inputSummary, references, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();

    const globalConfig = useEffectiveConfig();

    const lastGenerationSettings = useConfigStore((state) => state.lastGenerationSettings);

    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const mode = node.metadata?.generationMode || "image";

    const config = buildNodeConfig(globalConfig, node, mode, lastGenerationSettings);

    const localH3 = mode === "video" && isLocalH3Model(config.model);

    const localH3ImageCount = references.filter((reference) => reference.kind === "image").length;

    const localH3ReferenceError =
        localH3 && references.some((reference) => reference.kind === "video" || reference.kind === "audio")
            ? "本机 H3 当前只支持图片参考，请断开视频或音频参考。"
            : localH3 && localH3ImageCount > 2
              ? "本机 H3 最多支持 2 张图片：第 1 张为首帧，第 2 张为尾帧。"
              : "";

    const readiness = useGrokOfficialReadiness(mode === "video" ? config.model : undefined);

    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };

    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);

    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());

    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);

    const videoReferences = references.filter((reference) => reference.kind === "video");

    const primaryEditVideoId = videoReferences.some((reference) => reference.nodeId === node.metadata?.primaryEditVideoId)
        ? node.metadata?.primaryEditVideoId
        : videoReferences.length === 1
          ? videoReferences[0].nodeId
          : undefined;

    const primarySelectionMissing = mode === "video" && config.videoReferenceMode === "video_edit" && videoReferences.length > 1 && !primaryEditVideoId;

    const moveReference = (index: number, offset: number) => {
        const reordered = moveCanvasResourceReference(references, index, offset);

        if (reordered !== references) onConfigChange(node.id, { referenceOrder: reordered.map((reference) => reference.nodeId) });
    };

    const changeMode = (value: string | number) => {
        const generationMode = value as CanvasGenerationMode;

        if (generationMode === "image") {
            const defaults = generationConfigWithLastSettings(globalConfig, lastGenerationSettings, "image");

            onConfigChange(node.id, {
                generationMode,
                model: defaults.imageModel || defaults.model,
                quality: defaults.quality,
                size: defaults.size,
                background: defaults.background,
                count: Number(imageGenerationCountWithLastSettings(globalConfig, lastGenerationSettings)) || 1,
            });

            return;
        }

        if (generationMode === "video") {
            const defaults = generationConfigWithLastSettings(globalConfig, lastGenerationSettings, "video");

            onConfigChange(node.id, {
                generationMode,
                model: defaults.videoModel || defaults.model,
                size: defaults.size,
                seconds: defaults.videoSeconds,
                vquality: defaults.vquality,
                generateAudio: defaults.videoGenerateAudio,
                watermark: defaults.videoWatermark,
                videoReferenceMode: "omni",
                videoOutputFormat: defaults.videoOutputFormat,
                primaryEditVideoId: undefined,
            });

            return;
        }

        onConfigChange(node.id, { generationMode, model: undefined });
    };

    return (
        <div
            className={`flex h-full w-full flex-col px-3 pb-3 pt-7 text-sm ${readOnly ? "cursor-default" : "cursor-move"}`}
            data-canvas-config-readonly={readOnly || undefined}
            style={{ color: theme.node.text }}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{t("canvas.configNode.title")}</div>

                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        disabled={readOnly}

                        size="small"

                        className="canvas-config-mode !rounded-md !p-0.5"

                        value={mode}

                        onChange={changeMode}

                        options={[
                            {
                                value: "image",

                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />

                                        {t("canvas.configNode.image")}
                                    </span>
                                ),
                            },

                            {
                                value: "text",

                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />

                                        {t("canvas.configNode.text")}
                                    </span>
                                ),
                            },

                            {
                                value: "video",

                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />

                                        {t("canvas.configNode.video")}
                                    </span>
                                ),
                            },

                            {
                                value: "audio",

                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />

                                        {t("canvas.configNode.audio")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            {mode === "video" ? (
                <VideoReferenceModeBar config={config} className="mb-2" persistNormalizationOnMount={false} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
            ) : null}

            <CanvasReferenceStrip
                references={references}
                onMove={moveReference}
                primaryEditVideoId={config.videoReferenceMode === "video_edit" ? primaryEditVideoId : undefined}
                onPrimaryEditVideoChange={config.videoReferenceMode === "video_edit" ? (nodeId) => onConfigChange(node.id, { primaryEditVideoId: nodeId }) : undefined}
            />

            {mode === "video" && !localH3 && !readOnly ? (
                <div className="mb-2 flex justify-end">
                    <CanvasVideoAssetValidationButton projectId={projectId} config={config} references={references} />
                </div>
            ) : null}

            <div className="mb-2 flex flex-wrap gap-1.5">
                <InputChip label={t("canvas.configNode.prompt")} value={t("canvas.configNode.items", { count: inputSummary.textCount })} style={chipStyle} />

                <InputChip label={t("canvas.configNode.references")} value={t("canvas.configNode.images", { count: inputSummary.imageCount })} style={chipStyle} />

                <InputChip label={t("canvas.configNode.videoReferences")} value={t("canvas.configNode.items", { count: inputSummary.videoCount })} style={chipStyle} />

                <InputChip label={t("canvas.configNode.audioReferences")} value={t("canvas.configNode.items", { count: inputSummary.audioCount })} style={chipStyle} />

                <button
                    type="button"
                    disabled={readOnly}
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] disabled:cursor-default disabled:opacity-55"
                    style={chipStyle}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={onComposerToggle}
                >
                    <Settings2 className="size-3.5" />

                    {t("canvas.configNode.compose")}
                </button>
            </div>

            {mode === "video" && !localH3 ? <GrokVideoPromptGuide model={config.model} imageCount={inputSummary.imageCount} color={theme.node.muted} /> : null}

            {localH3 ? <LocalH3WorkerBadge /> : null}

            {localH3ReferenceError ? (
                <p className="mb-2 text-xs leading-5 text-amber-400" role="status">
                    {localH3ReferenceError}
                </p>
            ) : localH3 && localH3ImageCount ? (
                <p className="mb-2 text-xs leading-5" style={{ color: theme.node.muted }} role="status">
                    {localH3ImageCount === 1 ? "已使用图片1作为首帧。" : "已按画布顺序使用图片1作为首帧、图片2作为尾帧。"}
                </p>
            ) : null}

            {readiness.reason ? (
                <p className="mb-2 text-xs leading-5" role="status">
                    {readiness.reason}
                </p>
            ) : null}

            <div className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px] items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker
                    className="canvas-compact-control h-10"
                    config={config}
                    value={config.model}
                    onChange={(model) => onConfigChange(node.id, { model })}
                    capability={mode}
                    onMissingConfig={() => openConfigDialog(true)}
                    fullWidth
                />

                {mode === "video" ? (
                    <CanvasVideoSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        persistNormalizationOnMount={false}
                        onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                    />
                ) : mode === "image" ? (
                    <CanvasImageSettingsPopover
                        config={config}
                        placement="topRight"
                        autoAdjustOverflow={false}
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                    />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                    />
                ) : (
                    <CanvasTextSettingsPopover
                        config={config}
                        count={node.metadata?.textCount || 1}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                        onCountChange={(textCount) => onConfigChange(node.id, { textCount })}
                    />
                )}
            </div>

            <Button
                type="primary"

                className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"

                danger={isRunning}

                disabled={readOnly || (!isRunning && (!canGenerate || primarySelectionMissing || !readiness.canSubmit || Boolean(localH3ReferenceError)))}

                onMouseDown={(event) => event.stopPropagation()}

                onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />

                            <Square className="size-3.5 fill-current" />

                            <span>{localH3 ? "取消生成" : t("canvas.configNode.stop")}</span>
                        </>
                    ) : (
                        <>
                            <Play className="size-4" />

                            <span>{localH3 ? "生成带声音视频" : t("canvas.configNode.generate")}</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>

            <span className="font-medium">{value}</span>
        </div>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode, lastGenerationSettings: LastGenerationSettings): AiConfig {
    const defaults = mode === "image" || mode === "video" ? generationConfigWithLastSettings(globalConfig, lastGenerationSettings, mode) : globalConfig;

    const model = resolveCanvasNodeModelForPresentation(defaults, node.metadata?.model, mode);

    return {
        ...defaults,

        model,

        ...(mode === "image" ? { imageModel: model } : mode === "video" ? { videoModel: model } : mode === "audio" ? { audioModel: model } : { textModel: model }),

        reasoningEffort: node.metadata?.reasoningEffort || defaults.reasoningEffort || defaultConfig.reasoningEffort,

        quality: node.metadata?.quality || defaults.quality || defaultConfig.quality,

        size: node.metadata?.size || defaults.size || defaultConfig.size,

        background: node.metadata?.background ?? defaults.background ?? defaultConfig.background,

        videoSeconds: node.metadata?.seconds || defaults.videoSeconds || defaultConfig.videoSeconds,

        vquality: node.metadata?.vquality || defaults.vquality || defaultConfig.vquality,

        videoGenerateAudio: node.metadata?.generateAudio || defaults.videoGenerateAudio || defaultConfig.videoGenerateAudio,

        videoWatermark: node.metadata?.watermark || defaults.videoWatermark || defaultConfig.videoWatermark,

        videoReferenceMode: node.metadata?.videoReferenceMode || defaults.videoReferenceMode || defaultConfig.videoReferenceMode,

        videoOutputFormat: node.metadata?.videoOutputFormat || defaults.videoOutputFormat || defaultConfig.videoOutputFormat,

        audioVoice: node.metadata?.audioVoice || defaults.audioVoice || defaultConfig.audioVoice,

        audioFormat: node.metadata?.audioFormat || defaults.audioFormat || defaultConfig.audioFormat,

        audioSpeed: node.metadata?.audioSpeed || defaults.audioSpeed || defaultConfig.audioSpeed,

        audioInstructions: node.metadata?.audioInstructions || defaults.audioInstructions || defaultConfig.audioInstructions,

        count: String(node.metadata?.count || (mode === "image" ? imageGenerationCountWithLastSettings(globalConfig, lastGenerationSettings) : defaults.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };

    if (key === "videoGenerateAudio") return { generateAudio: value };

    if (key === "videoWatermark") return { watermark: value };

    if (key === "videoReferenceMode") return { videoReferenceMode: value as AiConfig["videoReferenceMode"] };

    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };

    if (key === "audioFormat") return { audioFormat: value };

    if (key === "audioSpeed") return { audioSpeed: value };

    return { audioInstructions: value };
}
