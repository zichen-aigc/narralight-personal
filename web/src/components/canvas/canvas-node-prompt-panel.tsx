import { GrokVideoPromptGuide } from "@/components/grok-video-prompt-guide";
import { CanvasReferenceStrip } from "./canvas-reference-strip";
import { CanvasVideoAssetValidationButton } from "./canvas-video-asset-validation";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { LocalH3WorkerBadge, VideoReferenceModeBar } from "@/components/video-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { Button, Modal, Tooltip } from "antd";
import { ArrowUp, BookmarkPlus, LoaderCircle, Maximize2, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

import { moveCanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

import { useGrokOfficialReadiness } from "@/hooks/use-grok-official-readiness";

import { isLocalH3Model } from "@/services/api/local-h3";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;

    projectId: string;

    isRunning: boolean;

    onPromptChange: (nodeId: string, prompt: string) => void;

    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;

    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;

    onStop: (nodeId: string) => void;

    onSavePrompt?: (node: CanvasNodeData, prompt: string, kind: CanvasNodeGenerationMode) => void;

    mentionReferences?: CanvasResourceReference[];

    onImageSettingsOpenChange?: (open: boolean) => void;

    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({
    node,
    projectId,
    isRunning,
    onPromptChange,
    onConfigChange,
    onGenerate,
    onStop,
    onSavePrompt,
    mentionReferences = [],
    onImageSettingsOpenChange,
    modeOverride,
}: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();

    const globalConfig = useEffectiveConfig();

    const lastGenerationSettings = useConfigStore((state) => state.lastGenerationSettings);

    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const mode = modeOverride ?? defaultMode(node.type);

    const config = buildNodeConfig(globalConfig, node, mode, lastGenerationSettings);

    const localH3 = mode === "video" && isLocalH3Model(config.model);

    const localH3ImageCount = mentionReferences.filter((reference) => reference.kind === "image").length;

    const localH3ReferenceError =
        localH3 && mentionReferences.some((reference) => reference.kind === "video" || reference.kind === "audio")
            ? "本机 H3 当前只支持图片参考，请断开视频或音频参考。"
            : localH3 && localH3ImageCount > 2
              ? "本机 H3 最多支持 2 张图片：第 1 张为首帧，第 2 张为尾帧。"
              : "";

    const readiness = useGrokOfficialReadiness(mode === "video" ? config.model : undefined);

    const promptReferences = mentionReferences;

    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());

    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);

    const isEditingExistingContent = hasTextContent || hasImageContent;

    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");

    const [expanded, setExpanded] = useState(false);

    const videoReferences = mentionReferences.filter((reference) => reference.kind === "video");

    const primaryEditVideoId = videoReferences.some((reference) => reference.nodeId === node.metadata?.primaryEditVideoId)
        ? node.metadata?.primaryEditVideoId
        : videoReferences.length === 1
          ? videoReferences[0].nodeId
          : undefined;

    const primarySelectionMissing = mode === "video" && config.videoReferenceMode === "video_edit" && videoReferences.length > 1 && !primaryEditVideoId;

    const moveReference = (index: number, offset: number) => {
        const reordered = moveCanvasResourceReference(mentionReferences, index, offset);

        if (reordered === mentionReferences) return;

        onConfigChange(node.id, { referenceOrder: reordered.map((reference) => reference.nodeId) });
    };

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.

    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);

        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();

        if (!text || isRunning || !readiness.canSubmit || localH3ReferenceError) return;

        onGenerate(node.id, mode, text);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    return (
        <div
            data-canvas-no-zoom

            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"

            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}

            onMouseDown={(event) => event.stopPropagation()}

            onPointerDown={(event) => event.stopPropagation()}

            onWheel={(event) => event.stopPropagation()}
        >
            {mode === "video" ? (
                <VideoReferenceModeBar config={config} className="mb-2" persistNormalizationOnMount={false} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
            ) : null}

            <CanvasReferenceStrip
                references={mentionReferences}
                onMove={moveReference}
                primaryEditVideoId={config.videoReferenceMode === "video_edit" ? primaryEditVideoId : undefined}
                onPrimaryEditVideoChange={config.videoReferenceMode === "video_edit" ? (nodeId) => onConfigChange(node.id, { primaryEditVideoId: nodeId }) : undefined}
            />

            {mode === "video" && !localH3 ? <GrokVideoPromptGuide model={config.model} imageCount={mentionReferences.filter((ref) => ref.kind === "image").length} color={theme.node.muted} /> : null}

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

            <CanvasPromptChipInput
                value={prompt}

                references={promptReferences}

                onChange={updatePrompt}

                onSubmit={submit}

                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"

                style={{ background: "transparent", color: theme.node.text }}

                placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button
                            type="text"
                            className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                            style={{ color: theme.node.text }}
                            icon={<Maximize2 className="size-3.5" />}
                            onClick={openExpandedEditor}
                            aria-label={t("canvas.promptPanel.expandEditor")}
                        />
                    </Tooltip>

                    <CanvasPromptLibrary onSelect={updatePrompt} />

                    {onSavePrompt ? (
                        <Tooltip title="保存提示词">
                            <Button
                                type="text"
                                className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                                style={{ color: theme.node.text }}
                                icon={<BookmarkPlus className="size-3.5" />}
                                disabled={!prompt.trim()}
                                onClick={() => onSavePrompt(node, prompt, mode)}
                                aria-label="保存提示词"
                            />
                        </Tooltip>
                    ) : null}

                    {mode === "image" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                onChange={(model) => onConfigChange(node.id, { model })}
                                capability="image"
                                onMissingConfig={() => openConfigDialog(true)}
                                className="max-w-[190px]"
                            />

                            <CanvasImageSettingsPopover
                                config={config}

                                placement="topLeft"

                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"

                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}

                                onMissingConfig={() => openConfigDialog(true)}

                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                onChange={(model) => onConfigChange(node.id, { model })}
                                capability="video"
                                onMissingConfig={() => openConfigDialog(true)}
                                className="max-w-[190px]"
                            />

                            <CanvasVideoSettingsPopover
                                config={config}
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                persistNormalizationOnMount={false}
                                onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                            />

                            {localH3 ? null : <CanvasVideoAssetValidationButton projectId={projectId} config={config} references={mentionReferences} />}
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                onChange={(model) => onConfigChange(node.id, { model })}
                                capability="audio"
                                onMissingConfig={() => openConfigDialog(true)}
                                className="max-w-[190px]"
                            />

                            <CanvasAudioSettingsPopover
                                config={config}
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                            />
                        </>
                    ) : (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                onChange={(model) => onConfigChange(node.id, { model })}
                                capability="text"
                                onMissingConfig={() => openConfigDialog(true)}
                                className="max-w-[190px]"
                            />

                            <CanvasTextSettingsPopover
                                config={config}
                                count={node.metadata?.textCount || 1}
                                onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                                onCountChange={(textCount) => onConfigChange(node.id, { textCount })}
                            />
                        </>
                    )}
                </div>

                <Tooltip title={isRunning ? (localH3 ? "取消本机 H3 生成" : t("canvas.promptPanel.stopGeneration")) : localH3 ? "生成带声音视频" : t("canvas.promptPanel.generateShortcut")}>
                    <Button
                        type="primary"
                        className={`!h-10 shrink-0 !rounded-full !px-3 ${localH3 && !isRunning ? "!min-w-36" : "!min-w-16"}`}
                        danger={isRunning}
                        disabled={!isRunning && (!prompt.trim() || primarySelectionMissing || !readiness.canSubmit || Boolean(localH3ReferenceError))}
                        onClick={() => (isRunning ? onStop(node.id) : submit())}
                        aria-label={isRunning ? (localH3 ? "取消本机 H3 生成" : t("canvas.promptPanel.stopGeneration")) : localH3 ? "生成带声音视频" : t("canvas.promptPanel.generateShortcut")}
                    >
                        <span className="flex items-center gap-1.5">
                            {isRunning ? (
                                <>
                                    <LoaderCircle className="size-4 animate-spin" />

                                    <Square className="size-3.5 fill-current" />

                                    <span className="text-xs font-medium">{localH3 ? "取消生成" : t("canvas.promptPanel.stop")}</span>
                                </>
                            ) : localH3 ? (
                                <>
                                    <ArrowUp className="size-4" />

                                    <span className="text-xs font-medium">生成带声音视频</span>
                                </>
                            ) : (
                                <ArrowUp className="size-4" />
                            )}
                        </span>
                    </Button>
                </Tooltip>
            </div>

            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasPromptChipInput
                        value={prompt}

                        references={promptReferences}

                        onChange={updatePrompt}

                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"

                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}

                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode, lastGenerationSettings: LastGenerationSettings): AiConfig {
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
