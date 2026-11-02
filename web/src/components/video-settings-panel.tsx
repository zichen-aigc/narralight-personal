import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { Segmented, Slider, Switch } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";

import { grokApimartVideoCapabilitiesFor, normalizeGrokApimartVideoSettings } from "@/lib/grok-apimart-video";

import { apimartGrokOfficialVideoCapabilitiesFor, normalizeApimartGrokOfficialVideoSettings } from "@/lib/apimart-grok-official-video";

import { isModelBackendSupported, useBackendModelContracts } from "@/lib/backend-model-contract";

import { miniMaxH3CapabilitiesFor, normalizeMiniMaxH3Settings } from "@/lib/minimax-h3-capabilities";

import { normalizeRunningHubGrokSettings, runningHubGrokCapabilitiesFor, type RunningHubGrokVideoCapabilities } from "@/lib/runninghub-grok-video";

import {
    enabledSeedanceReferenceModes,
    normalizeSeedanceSettings,
    seedanceCapabilitiesFor,
    seedanceDurationSlider,
    seedanceModeConstraints,
    type SeedanceReferenceMode,
} from "@/lib/seedance-model-capabilities";

import { normalize888ApiVideoSettings } from "@/lib/api888-video-settings";

import { boolConfig, isSeedanceVideoConfig, normalizeResolutionToken, normalizeSeedanceRatio, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";

import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";

import { modelProfileOf, type AiConfig, type ModelParameter } from "@/stores/use-config-store";

import { useThemeStore } from "@/stores/use-theme-store";

import { isLocalH3Model, LOCAL_H3_DURATIONS, LOCAL_H3_PROFILES, normalizeLocalH3Parameters, readLocalH3Status, type LocalH3WorkerStatus } from "@/services/api/local-h3";

const resolutionOptions = [
    { value: "480", label: "480p" },

    { value: "720", label: "720p" },

    { value: "1080", label: "1080p" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));

export const videoSizeOptions = videoRatioOptions.map((item) => ({
    value: item.value,
    get label() {
        return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value;
    },
}));

export const videoSecondOptions = Array.from({ length: VIDEO_SECONDS_MAX - VIDEO_SECONDS_MIN + 1 }, (_, index) => String(index + VIDEO_SECONDS_MIN));

type VideoSettingsPanelProps = {
    config: AiConfig;

    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoReferenceMode" | "videoOutputFormat", value: string) => void;

    theme: CanvasTheme;

    showTitle?: boolean;

    className?: string;

    persistNormalizationOnMount?: boolean;
};

export function VideoReferenceModeBar({
    config,
    onConfigChange,
    className = "",
    persistNormalizationOnMount = true,
}: Pick<VideoSettingsPanelProps, "config" | "onConfigChange" | "persistNormalizationOnMount"> & { className?: string }) {
    const { t } = useTranslation();

    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const model = config.videoModel || config.model;

    const localH3 = isLocalH3Model(model);

    const profile = modelProfileOf(config, model);

    const grokCapabilities = profile?.grokVideoCapabilities || grokApimartVideoCapabilitiesFor(model);

    const runningHubGrokCapabilities = profile?.runningHubGrokCapabilities || runningHubGrokCapabilitiesFor(model);

    const h3Capabilities = profile?.h3Capabilities || miniMaxH3CapabilitiesFor(model);

    const seedanceCapabilities = profile?.videoCapabilities || seedanceCapabilitiesFor(model);

    const genericModes: SeedanceReferenceMode[] = ["first_frame", "first_last_frame", "omni"];

    const modes = h3Capabilities?.modes || (seedanceCapabilities ? enabledSeedanceReferenceModes(seedanceCapabilities) : genericModes);

    const settings = {
        referenceMode: (config.videoReferenceMode || "omni") as SeedanceReferenceMode,

        resolution: normalizeResolutionToken(config.vquality),

        ratio: normalizeSeedanceRatio(config.size),

        duration: Number(config.videoSeconds),
    };

    const normalized = h3Capabilities
        ? normalizeMiniMaxH3Settings({ ...settings, resolution: config.vquality })
        : seedanceCapabilities
          ? normalizeSeedanceSettings(seedanceCapabilities, settings)
          : { ...settings, referenceMode: genericModes.includes(settings.referenceMode) ? settings.referenceMode : ("omni" as SeedanceReferenceMode) };

    const normalizedMode = normalized?.referenceMode;

    const normalizedResolution = normalized?.resolution;

    const normalizedRatio = normalized?.ratio;

    const normalizedDuration = normalized?.duration;

    useEffect(() => {
        if (localH3 || !persistNormalizationOnMount) return;

        if (!normalizedMode || !normalizedResolution || !normalizedRatio || normalizedDuration === undefined) return;

        if (config.videoReferenceMode !== normalizedMode) onConfigChange("videoReferenceMode", normalizedMode);

        if (config.vquality !== normalizedResolution) onConfigChange("vquality", normalizedResolution);

        if (config.size !== normalizedRatio) onConfigChange("size", normalizedRatio);

        if (config.videoSeconds !== String(normalizedDuration)) onConfigChange("videoSeconds", String(normalizedDuration));
    }, [
        config.size,
        config.videoReferenceMode,
        config.videoSeconds,
        config.vquality,
        localH3,
        normalizedDuration,
        normalizedMode,
        normalizedRatio,
        normalizedResolution,
        onConfigChange,
        persistNormalizationOnMount,
    ]);

    if (localH3 || apimartGrokOfficialVideoCapabilitiesFor(model) || grokCapabilities || runningHubGrokCapabilities || !normalized || !modes.length) return null;

    return (
        <div className={`thin-scrollbar min-w-0 overflow-x-auto ${className}`} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            <Segmented
                size="small"

                className="!w-max !min-w-full"

                value={normalizedMode}

                options={modes.map((value) => ({ value, label: t(`settingsPanels.video.modes.${value}`) }))}

                onChange={(value) => onConfigChange("videoReferenceMode", String(value))}
            />
        </div>
    );
}

export function VideoSettingsPanel({
    config,
    onConfigChange,
    theme,
    showTitle = true,
    className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5",
    persistNormalizationOnMount = true,
}: VideoSettingsPanelProps) {
    useBackendModelContracts();

    const { t } = useTranslation();

    const profile = modelProfileOf(config, config.videoModel || config.model);

    const supports = (parameter: ModelParameter) => !profile?.parameters || profile.parameters.includes(parameter);

    if (isLocalH3Model(config.videoModel || config.model)) {
        return (
            <LocalH3VideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    if (!isModelBackendSupported(config.videoModel || config.model))
        return (
            <p className="text-xs leading-5" role="status">
                此历史型号的后台合同尚未确认；设置保持只读，请切换已支持模型。
            </p>
        );

    if (apimartGrokOfficialVideoCapabilitiesFor(config.videoModel || config.model)) {
        return (
            <GrokOfficialVideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    if (profile?.grokVideoCapabilities || grokApimartVideoCapabilitiesFor(config.videoModel || config.model)) {
        return (
            <GrokApimartVideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    if (profile?.runningHubGrokCapabilities || runningHubGrokCapabilitiesFor(config.videoModel || config.model)) {
        return (
            <RunningHubGrokVideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    if (profile?.h3Capabilities || miniMaxH3CapabilitiesFor(config.videoModel || config.model)) {
        return (
            <MiniMaxH3VideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    if ((config.videoModel || config.model).startsWith("888api::")) {
        return (
            <Api888VideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    if (isSeedanceVideoConfig(config)) {
        return (
            <SeedanceVideoSettingsPanel
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        );
    }

    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6"));

    const resolution = parseVideoResolution(config.vquality);

    const selectedRatio = inferVideoRatio(config.size || "auto");

    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);

    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);

        onConfigChange("size", computeVideoSize(nextResolution, ratio));
    };

    const selectResolution = (nextResolution: string) => (selectedRatio === "auto" ? onConfigChange("vquality", nextResolution) : applySize(nextResolution, selectedRatio));

    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));

        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}

                {supports("size") ? (
                    <SettingGroup title="长宽比 / 预设尺寸" color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {videoRatioOptions.map((item) => (
                                <button
                                    key={item.value}

                                    type="button"

                                    className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"

                                    style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}

                                    onMouseDown={(event) => event.stopPropagation()}

                                    onClick={() => applySize(resolution, item.value)}
                                >
                                    <SizePreview width={item.width} height={item.height} color={theme.node.text} />

                                    <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                                </button>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}

                {supports("resolution") ? (
                    <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {resolutionOptions.map((item) => (
                                <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => selectResolution(item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}

                            <ResolutionInput value={resolution} theme={theme} onChange={selectResolution} />
                        </div>
                    </SettingGroup>
                ) : null}

                {supports("size") ? (
                    <SettingGroup title="自定义宽高" color={theme.node.muted}>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                            <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />

                            <span className="text-lg opacity-45">↔</span>

                            <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                        </div>
                    </SettingGroup>
                ) : null}

                {supports("duration") ? (
                    <SettingGroup title={t("settingsPanels.video.duration")} color={theme.node.muted}>
                        <div className="flex items-center gap-3">
                            <Slider
                                className="min-w-0 flex-1"
                                min={VIDEO_SECONDS_MIN}
                                max={VIDEO_SECONDS_MAX}
                                step={1}
                                value={seconds}
                                onChange={(value) => onConfigChange("videoSeconds", String(value))}
                            />

                            <NumberInput
                                value={String(seconds)}
                                min={VIDEO_SECONDS_MIN}
                                max={VIDEO_SECONDS_MAX}
                                theme={theme}
                                onChange={(value) => onConfigChange("videoSeconds", clampVideoSeconds(value))}
                            />

                            <span className="text-sm" style={{ color: theme.node.muted }}>
                                s
                            </span>
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function Api888VideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, persistNormalizationOnMount }: VideoSettingsPanelProps) {
    const model = config.videoModel || config.model;

    const { economy, seconds, ratio } = normalize888ApiVideoSettings(model, config.size, config.videoSeconds);

    const ratios = economy ? ["16:9", "9:16", "1:1"] : ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

    useEffect(() => {
        if (!persistNormalizationOnMount) return;

        if (config.size !== ratio) onConfigChange("size", ratio);

        if (config.videoSeconds !== String(seconds)) onConfigChange("videoSeconds", String(seconds));
    }, [config.size, config.videoSeconds, onConfigChange, persistNormalizationOnMount, ratio, seconds]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">888API 视频设置</div> : null}

                <SettingGroup title="长宽比" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {ratios.map((value) => (
                            <button
                                key={value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", value)}
                            >
                                <SizePreview width={ratioPreview(value).width} height={ratioPreview(value).height} color={theme.node.text} />
                                <span>{value === "adaptive" ? "自适应" : value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>

                <SettingGroup title={`时长 · ${seconds} 秒`} color={theme.node.muted}>
                    {economy ? (
                        <div className="text-sm">该型号固定 15 秒</div>
                    ) : (
                        <Slider min={2} max={30} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                    )}
                </SettingGroup>

                <SettingGroup title="参考与计费说明" color={theme.node.muted}>
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        可在同一生成节点添加图片、视频或音频参考。公开价格快照：{economy ? "¥5 / 次" : "¥0.22 / 秒"}；实际扣费以供应商账单为准。
                    </p>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function useLocalH3WorkerStatus() {
    const [status, setStatus] = useState<LocalH3WorkerStatus | null>(null);

    const [statusUnavailable, setStatusUnavailable] = useState(false);

    useEffect(() => {
        let active = true;

        let controller: AbortController | undefined;

        const refresh = async () => {
            controller?.abort();

            controller = new AbortController();

            try {
                const next = await readLocalH3Status(controller.signal);

                if (active) {
                    setStatus(next);

                    setStatusUnavailable(false);
                }
            } catch (error) {
                if (active && !(error instanceof DOMException && error.name === "AbortError")) setStatusUnavailable(true);
            }
        };

        void refresh();

        const timer = globalThis.setInterval(() => void refresh(), 15_000);

        return () => {
            active = false;

            controller?.abort();

            globalThis.clearInterval(timer);
        };
    }, []);

    return { status, statusUnavailable };
}

function localH3WorkerStatusText(status: LocalH3WorkerStatus | null, statusUnavailable: boolean, verbose = false) {
    const text = statusUnavailable
        ? "工作机状态未知"
        : !status
          ? "正在读取工作机…"
          : !status.online
            ? verbose
                ? "工作机离线 · 任务可排队，在线后自动处理"
                : "工作机离线 · 可排队"
            : status.state === "busy"
              ? "工作机在线 · 正在生成"
              : "工作机在线 · 空闲";

    return `${text}${status && status.queueDepth > 0 ? ` · 队列 ${status.queueDepth}` : ""}`;
}

export function LocalH3WorkerBadge({ className = "" }: { className?: string }) {
    const { status, statusUnavailable } = useLocalH3WorkerStatus();

    const tone = statusUnavailable || !status || !status.online ? "#f59e0b" : status.state === "busy" ? "#60a5fa" : "#34d399";

    return (
        <div className={`mb-2 inline-flex items-center gap-1.5 rounded-full border border-current/20 px-2.5 py-1 text-[11px] ${className}`} role="status">
            <span className="size-1.5 rounded-full" style={{ background: tone }} />

            <span>{localH3WorkerStatusText(status, statusUnavailable)}</span>
        </div>
    );
}

function LocalH3VideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, persistNormalizationOnMount = true }: VideoSettingsPanelProps) {
    const { status, statusUnavailable } = useLocalH3WorkerStatus();

    const parameters = normalizeLocalH3Parameters({
        duration: Number(config.videoSeconds) as 5 | 10,
        resolution: config.vquality as "864x480" | "480x864" | "640x640",
        aspectRatio: config.size as "16:9" | "9:16" | "1:1",
        referenceMode: config.videoReferenceMode as "text_to_video" | "first_frame" | "first_last_frame",
    });

    useEffect(() => {
        if (!persistNormalizationOnMount) return;

        const fixed: Array<[Parameters<VideoSettingsPanelProps["onConfigChange"]>[0], string]> = [
            ["vquality", parameters.resolution],

            ["size", parameters.aspectRatio],

            ["videoSeconds", String(parameters.duration)],

            ["videoGenerateAudio", "true"],

            ["videoWatermark", "false"],

            ["videoOutputFormat", parameters.outputFormat],
        ];

        fixed.forEach(([key, value]) => {
            if (config[key] !== value) onConfigChange(key, value);
        });
    }, [config, onConfigChange, parameters.aspectRatio, parameters.duration, parameters.outputFormat, parameters.resolution, persistNormalizationOnMount]);

    const statusText = localH3WorkerStatusText(status, statusUnavailable, true);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">MiniMax H3 Base · 本机免费</div> : null}

                <div className="rounded-xl border p-3 text-sm leading-6" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                    <div className="font-medium">
                        {parameters.resolution.replace("x", "×")} · 约{parameters.duration}秒 · 画面 + 同步音频
                    </div>

                    <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                        {statusText}
                    </div>
                </div>

                <SettingGroup title="画面比例与分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2">
                        {LOCAL_H3_PROFILES.map((profile) => (
                            <button
                                key={profile.resolution}
                                type="button"
                                className="flex h-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: parameters.resolution === profile.resolution ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => {
                                    onConfigChange("vquality", profile.resolution);
                                    onConfigChange("size", profile.aspectRatio);
                                }}
                            >
                                <SizePreview width={profile.width} height={profile.height} color={theme.node.text} />
                                <span>{profile.label}</span>
                                <span className="text-[11px] opacity-55">{profile.resolution.replace("x", "×")}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>

                <SettingGroup title="时长" color={theme.node.muted}>
                    <Segmented
                        block
                        value={parameters.duration}
                        options={LOCAL_H3_DURATIONS.map((item) => ({ value: item.duration, label: item.label }))}
                        onChange={(value) => onConfigChange("videoSeconds", String(value))}
                    />
                </SettingGroup>

                <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                    可不接图片直接文生视频；接 1 张图片时作为首帧，接 2 张时按画布顺序作为首帧和尾帧。视频或音频参考暂不支持。
                </div>

                <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                    中文提示词原文会保留。后台只使用已验收白名单工作流，不会切换到付费云模型。
                </div>

                <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                    任务状态：排队 → 生成 → 上传 → 验证 → 完成；异常时会显示失败或待核对，并可取消。
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

function GrokOfficialVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, persistNormalizationOnMount }: VideoSettingsPanelProps) {
    const model = config.videoModel || config.model;

    const capability = apimartGrokOfficialVideoCapabilitiesFor(model)!;

    const normalized = normalizeApimartGrokOfficialVideoSettings(model, { resolution: config.vquality, ratio: config.size, duration: Number(config.videoSeconds) })!;

    const pricing = useBackendModelContracts((state) => state.pricing);

    useEffect(() => {
        if (!persistNormalizationOnMount || capability.workflow === "video_edit") return;

        if (config.vquality !== normalized.resolution) onConfigChange("vquality", normalized.resolution);

        if (config.size !== normalized.ratio) onConfigChange("size", normalized.ratio);

        if (config.videoSeconds !== String(normalized.duration)) onConfigChange("videoSeconds", String(normalized.duration));
    }, [capability.workflow, config.size, config.videoSeconds, config.vquality, normalized.duration, normalized.ratio, normalized.resolution, onConfigChange, persistNormalizationOnMount]);

    const rates = pricing?.models[capability.requestModel];

    const edit = capability.workflow === "video_edit";

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}

                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                    {edit ? "编辑一段原片；输出时长和比例由原片决定，不提供生成参数。" : "添加图片后为参考图生成；没有图片时为文生视频。"}
                </p>

                {!edit ? (
                    <>
                        <SettingGroup title="分辨率" color={theme.node.muted}>
                            <div className="grid grid-cols-3 gap-2.5">
                                {capability.resolutions.map((value) => (
                                    <OptionPill key={value} selected={normalized.resolution === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>
                                        {value}
                                    </OptionPill>
                                ))}
                            </div>
                        </SettingGroup>

                        <SettingGroup title="输出比例" color={theme.node.muted}>
                            <div className="grid grid-cols-4 gap-2">
                                {capability.ratios.map((value) => (
                                    <OptionPill key={value} selected={normalized.ratio === value} theme={theme} onClick={() => onConfigChange("size", value)}>
                                        {value === "auto" ? "自动" : value}
                                    </OptionPill>
                                ))}
                            </div>
                        </SettingGroup>

                        <SettingGroup title={`时长 · ${normalized.duration}秒`} color={theme.node.muted}>
                            <Slider
                                min={1}
                                max={15}
                                step={1}
                                marks={{ 1: "1", 5: "5", 10: "10", 15: "15" }}
                                value={normalized.duration}
                                onChange={(value) => onConfigChange("videoSeconds", String(value))}
                            />
                        </SettingGroup>
                    </>
                ) : null}

                <SettingGroup title="费用" color={theme.node.muted}>
                    <div className="text-xs leading-5" role="status">
                        {edit && pricing && pricing.editSourceRelayAvailable !== true ? <p>当前未配置公网素材中继，视频编辑暂不可提交。</p> : null}

                        {pricing?.status === "verified" && rates ? (
                            <>
                                <p>
                                    {edit
                                        ? `按原片时长计价：输出与源视频合计 $${((rates.rates["720p"] || 0) + (rates.videoMicrousd || 0)) / 1_000_000}/秒。`
                                        : `输出 $${(rates.rates[normalized.resolution] || 0) / 1_000_000}/秒；参考图 $${(rates.imageMicrousd || 0) / 1_000_000}/张。`}
                                </p>

                                <p style={{ color: theme.node.muted }}>{"提交前校验供应商价格，实际费用以供应商账单为准。"}</p>
                            </>
                        ) : (
                            <p>{pricing?.message || (pricing ? "价格尚未验证，暂不能提交付费任务。" : "正在验证价格；验证前不能提交付费任务。")}</p>
                        )}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function RunningHubGrokVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, persistNormalizationOnMount }: VideoSettingsPanelProps) {
    const { t } = useTranslation();

    const model = config.videoModel || config.model;

    const capabilities = modelProfileOf(config, model)?.runningHubGrokCapabilities || runningHubGrokCapabilitiesFor(model);

    const normalized = normalizeRunningHubGrokSettings(model, {
        resolution: normalizeResolutionToken(config.vquality),
        ratio: normalizeSeedanceRatio(config.size),
        duration: Number(config.videoSeconds),
    });

    useEffect(() => {
        if (!persistNormalizationOnMount) return;

        if (!capabilities || !normalized) return;

        if (config.videoReferenceMode !== normalized.referenceMode) onConfigChange("videoReferenceMode", normalized.referenceMode);

        if (capabilities.resolutions.length && config.vquality !== normalized.resolution) onConfigChange("vquality", normalized.resolution);

        if (capabilities.ratios.length && config.size !== normalized.ratio) onConfigChange("size", normalized.ratio);

        if (capabilities.workflow !== "video_edit" && config.videoSeconds !== String(normalized.duration)) onConfigChange("videoSeconds", String(normalized.duration));
    }, [
        capabilities,
        config.size,
        config.videoReferenceMode,
        config.videoSeconds,
        config.vquality,
        normalized?.duration,
        normalized?.ratio,
        normalized?.referenceMode,
        normalized?.resolution,
        onConfigChange,
        persistNormalizationOnMount,
    ]);

    if (!capabilities || !normalized) return null;

    const durationMarks = capabilities.duration.values
        ? Object.fromEntries(capabilities.duration.values.map((value) => [value, String(value)]))
        : Object.fromEntries([1, 3, 6, 9, 12, 15].map((value) => [value, String(value)]));

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}

                <SettingGroup title={t("settingsPanels.video.workflow")} color={theme.node.muted}>
                    <div className="rounded-xl border p-2.5 text-sm" style={{ borderColor: theme.node.stroke }}>
                        {t(`settingsPanels.video.runningHubGrokWorkflows.${capabilities.workflow}`)}
                    </div>
                </SettingGroup>

                {capabilities.resolutions.length ? (
                    <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                        <div className={`grid gap-2.5 ${capabilities.resolutions.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                            {capabilities.resolutions.map((resolution) => (
                                <OptionPill key={resolution} selected={normalized.resolution === resolution} theme={theme} onClick={() => onConfigChange("vquality", resolution)}>
                                    {resolution}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}

                {capabilities.ratios.length ? (
                    <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {capabilities.ratios.map((ratio) => (
                                <button
                                    key={ratio}
                                    type="button"
                                    className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                    style={{ borderColor: normalized.ratio === ratio ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", ratio)}
                                >
                                    <SizePreview width={ratioPreview(ratio).width} height={ratioPreview(ratio).height} color={theme.node.text} />
                                    <span>{ratio}</span>
                                </button>
                            ))}
                        </div>
                    </SettingGroup>
                ) : capabilities.workflow === "first_frame" ? (
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.video.runningHubGrokImageRatioHint")}
                    </div>
                ) : null}

                {capabilities.workflow !== "video_edit" ? (
                    <SettingGroup title={`${t("settingsPanels.video.duration")} · ${normalized.duration}s`} color={theme.node.muted}>
                        {capabilities.duration.values ? (
                            <Segmented
                                block
                                value={normalized.duration}
                                options={capabilities.duration.values.map((value) => ({ value, label: `${value}s` }))}
                                onChange={(value) => onConfigChange("videoSeconds", String(value))}
                            />
                        ) : (
                            <Slider
                                min={capabilities.duration.min}
                                max={capabilities.duration.max}
                                step={1}
                                marks={durationMarks}
                                value={normalized.duration}
                                onChange={(value) => onConfigChange("videoSeconds", String(value))}
                            />
                        )}
                    </SettingGroup>
                ) : null}

                <SettingGroup title={t("settingsPanels.video.price")} color={theme.node.muted}>
                    <div className="rounded-xl border p-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke }} title={capabilities.pricing.source}>
                        {runningHubGrokPriceText(capabilities)}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function runningHubGrokPriceText(capabilities: RunningHubGrokVideoCapabilities) {
    const { workflow, pricing } = capabilities;

    if (workflow === "video_extend") return `RunningHub ${pricing.checkedAt}：6 秒 ￥${pricing.rmb["6"].toFixed(2)}/次 · 10 秒 ￥${pricing.rmb["10"].toFixed(2)}/次`;

    if (workflow === "video_edit") return `RunningHub ${pricing.checkedAt}：￥${pricing.rmb.input.toFixed(2)}/输入视频秒（1-8 秒）`;

    const resolutions = Object.entries(pricing.rmb)
        .map(([resolution, price]) => `${resolution} ￥${price.toFixed(2)}/秒`)
        .join(" · ");

    return `RunningHub ${pricing.checkedAt}：${resolutions}${pricing.imageRmb === undefined ? "" : ` · 参考图 ￥${pricing.imageRmb.toFixed(2)}/张`}`;
}

function GrokApimartVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, persistNormalizationOnMount }: VideoSettingsPanelProps) {
    const { t } = useTranslation();

    const model = config.videoModel || config.model;

    const profile = modelProfileOf(config, model);

    const capabilities = profile?.grokVideoCapabilities || grokApimartVideoCapabilitiesFor(model);

    const normalized = normalizeGrokApimartVideoSettings({ resolution: normalizeResolutionToken(config.vquality), ratio: config.size, duration: Number(config.videoSeconds) });

    const marks = Object.fromEntries([6, 8, 10, 12, 14, 15].map((value) => [value, String(value)]));

    useEffect(() => {
        if (!persistNormalizationOnMount) return;

        if (config.vquality !== normalized.resolution) onConfigChange("vquality", normalized.resolution);

        if (config.size !== normalized.ratio) onConfigChange("size", normalized.ratio);

        if (config.videoSeconds !== String(normalized.duration)) onConfigChange("videoSeconds", String(normalized.duration));
    }, [config.size, config.videoSeconds, config.vquality, normalized.duration, normalized.ratio, normalized.resolution, onConfigChange, persistNormalizationOnMount]);

    if (!capabilities) return null;

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}

                <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {capabilities.resolutions.map((resolution) => (
                            <OptionPill key={resolution} selected={normalized.resolution === resolution} theme={theme} onClick={() => onConfigChange("vquality", resolution)}>
                                {resolution}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>

                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {capabilities.ratios.map((ratio) => (
                            <button
                                key={ratio}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: normalized.ratio === ratio ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", ratio)}
                            >
                                <SizePreview width={ratioPreview(ratio).width} height={ratioPreview(ratio).height} color={theme.node.text} />

                                <span>{ratio}</span>
                            </button>
                        ))}
                    </div>

                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.video.grokReferenceRatioHint")}
                    </div>
                </SettingGroup>

                <SettingGroup title={`${t("settingsPanels.video.duration")} · ${normalized.duration}s`} color={theme.node.muted}>
                    <Slider
                        min={capabilities.duration.min}
                        max={capabilities.duration.max}
                        step={1}
                        marks={marks}
                        value={normalized.duration}
                        onChange={(value) => onConfigChange("videoSeconds", String(value))}
                    />
                </SettingGroup>

                <SettingGroup title={t("settingsPanels.video.price")} color={theme.node.muted}>
                    <div className="rounded-xl border p-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke }} title={capabilities.pricing.source}>
                        {t("settingsPanels.video.grokPriceSnapshot", { date: capabilities.pricing.checkedAt, rate: capabilities.pricing.exchangeRate.toFixed(2), p480: "0.07", p720: "0.14" })}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function MiniMaxH3VideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, persistNormalizationOnMount }: VideoSettingsPanelProps) {
    const { t } = useTranslation();

    const model = config.videoModel || config.model;

    const profile = modelProfileOf(config, model);

    const capabilities = profile?.h3Capabilities || miniMaxH3CapabilitiesFor(model);

    const normalized = normalizeMiniMaxH3Settings({
        referenceMode: (config.videoReferenceMode || "text_to_video") as SeedanceReferenceMode,

        resolution: config.vquality,

        ratio: normalizeSeedanceRatio(config.size),

        duration: Number(config.videoSeconds),
    });

    const frameMode = ["first_frame", "last_frame", "first_last_frame"].includes(normalized.referenceMode);

    const ratios = capabilities?.ratios.filter((ratio) => (frameMode ? ratio === "adaptive" : normalized.referenceMode === "text_to_video" ? ratio !== "adaptive" : true)) || [];

    const marks = Object.fromEntries([4, 6, 8, 10, 12, 14, 15].map((value) => [value, String(value)]));

    useEffect(() => {
        if (!persistNormalizationOnMount) return;

        if (config.videoReferenceMode !== normalized.referenceMode) onConfigChange("videoReferenceMode", normalized.referenceMode);

        if (config.vquality !== normalized.resolution) onConfigChange("vquality", normalized.resolution);

        if (config.size !== normalized.ratio) onConfigChange("size", normalized.ratio);

        if (config.videoSeconds !== String(normalized.duration)) onConfigChange("videoSeconds", String(normalized.duration));
    }, [
        config.size,
        config.videoReferenceMode,
        config.videoSeconds,
        config.vquality,
        normalized.duration,
        normalized.ratio,
        normalized.referenceMode,
        normalized.resolution,
        onConfigChange,
        persistNormalizationOnMount,
    ]);

    if (!capabilities) return null;

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}

                <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {capabilities.resolutions.map((resolution) => (
                            <OptionPill key={resolution} selected={normalized.resolution === resolution} theme={theme} onClick={() => onConfigChange("vquality", resolution)}>
                                {resolution}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>

                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {ratios.map((ratio) => (
                            <button
                                key={ratio}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: normalized.ratio === ratio ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", ratio)}
                            >
                                <SizePreview width={ratioPreview(ratio).width} height={ratioPreview(ratio).height} color={theme.node.text} />

                                <span>{ratio === "adaptive" ? t("settingsPanels.video.adaptive") : ratio}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>

                <SettingGroup title={`${t("settingsPanels.video.duration")} · ${normalized.duration}s`} color={theme.node.muted}>
                    <Slider
                        min={capabilities.duration.min}
                        max={capabilities.duration.max}
                        step={1}
                        marks={marks}
                        value={normalized.duration}
                        onChange={(value) => onConfigChange("videoSeconds", String(value))}
                    />
                </SettingGroup>

                <SettingGroup title={t("settingsPanels.video.price")} color={theme.node.muted}>
                    <div className="rounded-xl border p-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke }} title={capabilities.pricing.source}>
                        {t("settingsPanels.video.h3PriceSnapshot", { date: capabilities.pricing.checkedAt, rate: "7.30", p768: "0.52", p2k: "0.83" })}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const { t } = useTranslation();

    const model = config.videoModel || config.model;

    const profile = modelProfileOf(config, model);

    const capabilities = profile?.videoCapabilities || seedanceCapabilitiesFor(model);

    const supports = (parameter: ModelParameter) => !profile?.parameters || profile.parameters.includes(parameter);

    const normalized = capabilities
        ? normalizeSeedanceSettings(capabilities, {
              referenceMode: (config.videoReferenceMode || "omni") as SeedanceReferenceMode,

              resolution: normalizeResolutionToken(config.vquality),

              ratio: normalizeSeedanceRatio(config.size),

              duration: Number(config.videoSeconds),
          })
        : null;

    const resolution = normalized?.resolution || normalizeResolutionToken(config.vquality);

    const ratio = normalized?.ratio || normalizeSeedanceRatio(config.size);

    const referenceMode = normalized?.referenceMode || ((config.videoReferenceMode || "omni") as SeedanceReferenceMode);

    const duration = normalized?.duration ?? Number(config.videoSeconds || 5);

    const generateAudio = boolConfig(config.videoGenerateAudio, true);

    const watermark = boolConfig(config.videoWatermark, false);

    const resolutionOptions = seedanceResolutionOptions.filter((item) => capabilities?.resolutions.includes(item.value));

    const constraints = capabilities ? seedanceModeConstraints(capabilities, referenceMode) : { forceAdaptiveRatio: false, forceSmartDuration: false };

    const ratioOptions = seedanceRatioOptions.filter((item) => capabilities?.ratios.includes(item.value) && (!constraints.forceAdaptiveRatio || item.value === "adaptive"));

    const durationSlider = capabilities ? seedanceDurationSlider(capabilities) : { min: 4, max: 15, step: 1, marks: [4, 6, 8, 10, 12, 14, 15] };

    const durationMarks = Object.fromEntries(durationSlider.marks.map((value) => [value, String(value)]));

    const outputFormatOptions = (capabilities?.outputFormats || []).map((value) => ({ value, label: value.toUpperCase() }));

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}

                {supports("resolution") ? (
                    <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            {resolutionOptions.map((item) => (
                                <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}

                {supports("size") ? (
                    <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {ratioOptions.map((item) => (
                                <button
                                    key={item.value}

                                    type="button"

                                    className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"

                                    style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}

                                    onMouseDown={(event) => event.stopPropagation()}

                                    onClick={() => onConfigChange("size", item.value)}
                                >
                                    <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />

                                    <span>{item.value === "adaptive" ? t("settingsPanels.video.adaptive") : item.value}</span>

                                    <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                                </button>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}

                {supports("duration") ? (
                    <SettingGroup title={`${t("settingsPanels.video.duration")} · ${constraints.forceSmartDuration ? t("settingsPanels.video.smart") : `${duration}s`}`} color={theme.node.muted}>
                        {constraints.forceSmartDuration ? (
                            <div className="text-sm">-1 · {t("settingsPanels.video.smart")}</div>
                        ) : (
                            <Slider
                                min={durationSlider.min}
                                max={durationSlider.max}
                                step={durationSlider.step}
                                marks={durationMarks}
                                value={duration}
                                onChange={(value) => onConfigChange("videoSeconds", String(value))}
                            />
                        )}
                    </SettingGroup>
                ) : null}

                {supports("generateAudio") || supports("watermark") || outputFormatOptions.length ? (
                    <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            {outputFormatOptions.length ? (
                                <Segmented
                                    size="small"
                                    block
                                    value={outputFormatOptions.some((item) => item.value === config.videoOutputFormat) ? config.videoOutputFormat : outputFormatOptions[0].value}
                                    options={outputFormatOptions}
                                    onChange={(value) => onConfigChange("videoOutputFormat", String(value))}
                                />
                            ) : null}

                            {supports("generateAudio") ? (
                                <SwitchRow
                                    label={t("settingsPanels.video.generateAudio")}
                                    checked={generateAudio}
                                    theme={theme}
                                    onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))}
                                />
                            ) : null}

                            {supports("watermark") ? (
                                <SwitchRow label={t("settingsPanels.video.watermark")} checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                            ) : null}
                        </div>
                    </SettingGroup>
                ) : null}

                {capabilities?.pricing.status === "pending_sync" ? (
                    <SettingGroup title={t("settingsPanels.video.price")} color={theme.node.muted}>
                        <div className="text-sm">{t("settingsPanels.video.pricePendingDetail")}</div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    if (/^2k$/i.test(String(value).trim())) return "2K";

    if (/^768p?$/i.test(String(value).trim())) return "768P";

    const resolution = normalizeResolutionToken(value);

    return resolution === "4k" ? "4K" : resolution;
}

export function videoSizeLabel(value: string) {
    const normalizedRatio = normalizeSeedanceRatio(value);

    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");

    if (normalizedRatio === value) return normalizedRatio;

    const ratio = inferVideoRatio(value);

    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");

    return `${value || "6"}s`;
}

export function videoSettingsSummary(config: Pick<AiConfig, "vquality" | "size" | "videoSeconds" | "videoOutputFormat">, model?: string) {
    if (isLocalH3Model(model)) {
        const parameters = normalizeLocalH3Parameters({
            duration: Number(config.videoSeconds) as 5 | 10,
            resolution: config.vquality as "864x480" | "480x864" | "640x640",
            aspectRatio: config.size as "16:9" | "9:16" | "1:1",
        });

        return `${parameters.resolution.replace("x", "×")} · 约${parameters.duration}秒 · 有声 MP4`;
    }

    if (!isModelBackendSupported(model)) return "历史型号 · 当前后台未接入";

    if (model?.startsWith("888api::")) {
        const settings = normalize888ApiVideoSettings(model, config.size, config.videoSeconds);

        return `${settings.ratio} · ${settings.seconds}s · MP4`;
    }

    const official = apimartGrokOfficialVideoCapabilitiesFor(model);

    if (official?.workflow === "video_edit") return "原片编辑 · MP4";

    const runningHubGrok = runningHubGrokCapabilitiesFor(model);

    if (runningHubGrok) {
        return [
            runningHubGrok.resolutions.length ? videoResolutionLabel(config.vquality) : "",

            runningHubGrok.ratios.length ? videoSizeLabel(config.size) : "",

            runningHubGrok.workflow !== "video_edit" ? videoSecondsLabel(config.videoSeconds) : "",

            (config.videoOutputFormat || "mp4").toUpperCase(),
        ]
            .filter(Boolean)
            .join(" · ");
    }

    return `${videoResolutionLabel(config.vquality)} · ${videoSizeLabel(config.size)} · ${videoSecondsLabel(config.videoSeconds)} · ${(config.videoOutputFormat || "mp4").toUpperCase()}`;
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";

    if (/^\d+x\d+$/.test(value || "")) return value;

    const ratio = inferVideoRatio(value);

    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <section className="space-y-2.5 rounded-xl border p-3" style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}>
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>

            {children}
        </section>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />

            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>

            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <input
            type="number"
            min={min}
            max={max}
            className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
        />
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;

    const longSide = Math.max(width, height);

    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));

    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));

    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };

    if (ratio === "2:3") return { width: 2, height: 3 };

    if (ratio === "1:1") return { width: 1, height: 1 };

    if (ratio === "3:2") return { width: 3, height: 2 };

    if (ratio === "4:3") return { width: 4, height: 3 };

    if (ratio === "3:4") return { width: 3, height: 4 };

    if (ratio === "21:9") return { width: 21, height: 9 };

    if (ratio === "adaptive") return { width: 0, height: 0 };

    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>

            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}
