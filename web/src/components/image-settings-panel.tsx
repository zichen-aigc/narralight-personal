import { ConfigProvider, Switch } from "antd";
import { type ReactNode, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import i18n from "@/i18n";

import { imageSizePresets, inferMediaScale, inferMediaRatio, mediaScaleOptions } from "@/lib/media-size";

import { type CanvasTheme } from "@/lib/canvas-theme";

import { effectiveImageGenerationCount } from "@/lib/image-generation-settings";

import { modelProfileOf, resolveModelChannel, type AiConfig, type ModelParameter } from "@/stores/use-config-store";

import { api888ImageSizeOptions, resolve888ApiImageSize } from "@/services/api/888api-image";

const qualityOptions = [
    { value: "auto", labelKey: "auto" },

    { value: "high", labelKey: "high" },

    { value: "medium", labelKey: "medium" },

    { value: "low", labelKey: "low" },
];

const DIMENSION_STEP = 16;

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },

    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },

    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },

    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },

    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },

    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },

    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },

    { value: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },

    { value: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },

    { value: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },

    { value: "16:9-4k", label: "16:9(4k)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape" },

    { value: "9:16-4k", label: "9:16(4k)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait" },

    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

// Retain legacy standard sizes and add every local resolution/ratio preset.

for (const [scale, presets] of Object.entries(imageSizePresets)) {
    for (const [ratio, size] of Object.entries(presets)) {
        if (aspectOptions.some((option) => option.size === size)) continue;

        const [width, height] = size.split("x").map(Number);

        aspectOptions.push({ value: size, label: `${ratio}(${scale})`, size, width, height, icon: width === height ? "square" : width > height ? "landscape" : "portrait" });
    }
}

export const imageScaleOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? i18n.t("settingsPanels.common.auto") : value.toUpperCase() }));

const api888AspectOptions = api888ImageSizeOptions.map((item) => ({
    value: item.size,
    label: item.label,
    size: item.size,
    width: item.width,
    height: item.height,
    icon: item.width === item.height ? "square" : item.width > item.height ? "landscape" : "portrait",
}));

type SizePreset = (typeof aspectOptions)[number] | (typeof api888AspectOptions)[number];

type SizeTier = "standard" | "1K" | "2K" | "4K";

function presetRatio(option: SizePreset) {
    return option.value === "auto" ? "auto" : option.label.split(/[ (·]/)[0];
}

function presetTier(option: SizePreset): SizeTier {
    return /4k/i.test(option.label) ? "4K" : /2k/i.test(option.label) ? "2K" : /\(1k\)/i.test(option.label) ? "1K" : "standard";
}

export function imagePresetSize(is888ApiImage: boolean, ratio: string, tier: SizeTier, fallbackToStandard = false) {
    const options = is888ApiImage ? api888AspectOptions : aspectOptions;

    const option =
        options.find((item) => presetRatio(item) === ratio && presetTier(item) === tier) ||
        (fallbackToStandard
            ? options.find((item) => presetRatio(item) === ratio && presetTier(item) === "standard") ||
              (!is888ApiImage ? options.find((item) => presetRatio(item) === ratio && presetTier(item) === "1K") : undefined)
            : undefined);

    return option?.size || option?.value;
}

export const imageQualityOptions = qualityOptions.map((item) => ({
    value: item.value,
    get label() {
        return i18n.t(`settingsPanels.common.${item.labelKey}`);
    },
}));

export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.size || item.value, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;

    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;

    theme: CanvasTheme;

    showTitle?: boolean;

    className?: string;

    maxCount?: number;

    quickCount?: number;
};

export function ImageSettingsPanel({
    config,
    onConfigChange,
    theme,
    showTitle = true,
    className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5",
    maxCount = 15,
    quickCount = 10,
}: ImageSettingsPanelProps) {
    const { t } = useTranslation();

    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);

    const quality = config.quality || "auto";

    const requestedCount = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));

    const imageModel = config.imageModel || config.model;

    const is888ApiImage = resolveModelChannel(config, imageModel).provider === "888api";

    const count = effectiveImageGenerationCount(config, imageModel, maxCount);

    const visibleAspectOptions = is888ApiImage ? api888AspectOptions : aspectOptions;

    const activeSize = is888ApiImage ? resolve888ApiImageSize(config.size || "auto") || config.size : config.size || "auto";

    const transparentBackground = config.background === "transparent";

    const profile = modelProfileOf(config, imageModel);

    const supports = (parameter: ModelParameter) => !profile?.parameters || profile.parameters.includes(parameter);

    const selectedAspect = visibleAspectOptions.find((item) => (item.size || item.value) === activeSize || item.value === activeSize);

    const selectedRatio = selectedAspect ? presetRatio(selectedAspect) : inferMediaRatio(activeSize);

    const selectedTier =
        selectedAspect && selectedRatio !== "auto" ? presetTier(selectedAspect) : inferMediaScale(activeSize) === "4k" ? "4K" : inferMediaScale(activeSize) === "2k" ? "2K" : "standard";

    const ratioOptions = visibleAspectOptions.filter((item, index, options) => options.findIndex((candidate) => presetRatio(candidate) === presetRatio(item)) === index);

    const tierOptions: { value: SizeTier; label: string }[] = [
        { value: "standard", label: is888ApiImage ? "1K" : "标准" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
    ];

    if (!is888ApiImage) tierOptions.splice(1, 0, { value: "1K", label: "1K" });

    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0]);

    const selectRatio = (ratio: string) => {
        const size = imagePresetSize(is888ApiImage, ratio, selectedTier || "standard", true);

        if (size) onConfigChange("size", size);
    };

    const selectTier = (tier: SizeTier) => {
        const size = imagePresetSize(is888ApiImage, selectedRatio, tier);

        if (size) onConfigChange("size", size);
    };

    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));

        const width = key === "width" ? next : dimensions.width;

        const height = key === "height" ? next : dimensions.height;

        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    useEffect(() => {
        if (is888ApiImage && requestedCount !== 1) onConfigChange("count", "1");
    }, [requestedCount, is888ApiImage, onConfigChange]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}

                style={{ color: theme.node.text }}

                onMouseDown={(event) => {
                    event.stopPropagation();

                    if (event.target instanceof HTMLInputElement) return;

                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : null}

                {supports("quality") || (supports("size") && !is888ApiImage) ? (
                    <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                        {supports("quality") ? (
                            <div className="space-y-2.5">
                                <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.quality")}</SettingTitle>

                                <div className="grid grid-cols-4 gap-2.5">
                                    {qualityOptions.map((item) => (
                                        <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                            {t(`settingsPanels.common.${item.labelKey}`)}
                                        </OptionPill>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {supports("size") && !is888ApiImage ? (
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between gap-3">
                                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.size")}</SettingTitle>

                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                            {t("settingsPanels.image.align16")}
                                        </span>

                                        <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                            <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                    <DimensionInput
                                        prefix="W"
                                        value={dimensions.width}
                                        disabled={activeSize === "auto"}
                                        theme={theme}
                                        alignToStep={snapDimensionToStep}
                                        onChange={(value) => updateDimension("width", value)}
                                    />

                                    <span className="text-lg opacity-45">↔</span>

                                    <DimensionInput
                                        prefix="H"
                                        value={dimensions.height}
                                        disabled={activeSize === "auto"}
                                        theme={theme}
                                        alignToStep={snapDimensionToStep}
                                        onChange={(value) => updateDimension("height", value)}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {supports("size") ? (
                    <div className="space-y-2.5 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.aspectRatio")}</SettingTitle>

                        <div className="grid grid-cols-4 gap-2.5">
                            {ratioOptions.map((item) => (
                                <button
                                    key={item.value}

                                    type="button"

                                    className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"

                                    style={{ borderColor: selectedRatio === presetRatio(item) ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}

                                    onMouseDown={(event) => event.stopPropagation()}

                                    onClick={() => selectRatio(presetRatio(item))}
                                >
                                    <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />

                                    <span>{presetRatio(item) === "auto" ? t("settingsPanels.common.auto") : presetRatio(item)}</span>
                                </button>
                            ))}
                        </div>

                        {!selectedAspect ? (
                            <div className="text-xs" style={{ color: theme.node.muted }}>
                                {is888ApiImage ? "当前保存的尺寸不受 888API 支持，请选择比例和清晰度。" : `当前为自定义尺寸 ${activeSize}，选择比例后切换到预设尺寸。`}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {supports("size") ? (
                    <div className="space-y-2.5 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                        <SettingTitle color={theme.node.muted}>分辨率 / 尺寸档</SettingTitle>

                        <div className="grid grid-cols-3 gap-2.5">
                            {tierOptions.map((item) => {
                                const available = visibleAspectOptions.some((option) => presetRatio(option) === selectedRatio && presetTier(option) === item.value);

                                return (
                                    <button
                                        key={item.value}
                                        type="button"
                                        disabled={!available}
                                        className="h-9 rounded-full border text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
                                        style={{ borderColor: selectedTier === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => selectTier(item.value)}
                                    >
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>

                        {selectedAspect && selectedRatio !== "auto" ? (
                            <div className="text-xs" style={{ color: theme.node.muted }}>
                                实际尺寸：{dimensions.width} × {dimensions.height}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {supports("background") ? (
                    <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.transparent")}</SettingTitle>

                            <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                {t("settingsPanels.image.transparentHint")}
                            </div>
                        </div>

                        <span onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                        </span>
                    </div>
                ) : null}

                {supports("count") ? (
                    <div className="space-y-2.5 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.count")}</SettingTitle>

                        <div className="grid grid-cols-4 gap-2.5">
                            {Array.from({ length: is888ApiImage ? 1 : quickCount }, (_, index) => index + 1).map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {t("settingsPanels.image.images", { count: value })}
                                </OptionPill>
                            ))}

                            {!is888ApiImage ? <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} /> : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: {
                    colorBgContainer: theme.toolbar.panel,
                    colorBgElevated: theme.toolbar.panel,
                    colorBorder: theme.node.stroke,
                    colorPrimary: theme.node.activeStroke,
                    colorText: theme.node.text,
                    colorTextLightSolid: theme.node.panel,
                },

                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ["auto", "high", "medium", "low"].includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}

export function imageSizeLabel(size: string) {
    return api888ImageSizeOptions.find((item) => item.size === size)?.label || aspectOptions.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"

            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"

            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}

            onMouseDown={(event) => event.stopPropagation()}

            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({
    prefix,
    value,
    disabled,
    theme,
    alignToStep,
    onChange,
}: {
    prefix: string;
    value: number;
    disabled: boolean;
    theme: CanvasTheme;
    alignToStep: boolean;
    onChange: (value: number | null) => void;
}) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);

        input.value = String(next);

        onChange(next);
    };

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

                defaultValue={value || ""}

                key={`${prefix}-${value}`}

                onBlur={(event) => commit(event.currentTarget)}

                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}

                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"

                min={1}

                max={max}

                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}

                value={value || ""}

                onChange={(event) => onChange(Number(event.target.value) || null)}

                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;

    const ratio = width / Math.max(1, height);

    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);

    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;

    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);

    return {
        width: match ? Number(match[1]) : fallback.width,

        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
