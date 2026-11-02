import {
    BookmarkPlus,
    ChevronDown,
    Clock3,
    Download,
    FolderPlus,
    Image as ImageIcon,
    Info,
    MessageSquare,
    Minus,
    Music2,
    Pencil,
    Plus,
    RefreshCw,
    ScanLine,
    Settings2,
    ShieldCheck,
    Trash2,
    Upload,
} from "lucide-react";
import { Dropdown, Modal, Segmented, Tooltip } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, theme as antdTheme, type MenuProps } from "antd";

import { Video } from "lucide-react";

import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

import { getNodeDefinition } from "@/lib/canvas/node-registry";

import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";

import { useCopyText } from "@/hooks/use-copy-text";

import { useThemeStore } from "@/stores/use-theme-store";

import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";

import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";

import { buildImageToolbarTools } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;

    viewport: ViewportTransform;

    onKeep: (nodeId: string) => void;

    onLeave: () => void;

    onInfo: (node: CanvasNodeData) => void;

    onEditText: (node: CanvasNodeData) => void;

    onDecreaseFont: (node: CanvasNodeData) => void;

    onIncreaseFont: (node: CanvasNodeData) => void;

    onToggleDialog: (node: CanvasNodeData) => void;

    onGenerateImage: (node: CanvasNodeData) => void;

    onUpload: (node: CanvasNodeData) => void;

    onDownload: (node: CanvasNodeData) => void;

    onSaveAsset: (node: CanvasNodeData) => void;

    onSavePrompt?: (node: CanvasNodeData) => void;

    onMaskEdit: (node: CanvasNodeData) => void;

    onCrop: (node: CanvasNodeData) => void;

    onSplit: (node: CanvasNodeData) => void;

    onUpscale: (node: CanvasNodeData) => void;

    onSuperResolve: (node: CanvasNodeData) => void;

    onAngle: (node: CanvasNodeData) => void;

    onViewImage: (node: CanvasNodeData) => void;

    onReversePrompt: (node: CanvasNodeData) => void;

    onRetry: (node: CanvasNodeData) => void;

    onOpenVideoHistory: (node: CanvasNodeData) => void;

    onCaptureVideoFrame?: (node: CanvasNodeData, position: VideoFramePosition) => void;

    onToggleFreeResize: (node: CanvasNodeData) => void;

    assetValidationLabel?: string;

    assetValidationActive?: boolean;

    assetValidationTone?: "success" | "error" | "processing" | "warning" | "default";

    onValidateAsset?: (node: CanvasNodeData) => void;

    onDelete: (node: CanvasNodeData) => void;

    extraTools?: CanvasNodeToolbarItem[];
};

type ToolbarTool = {
    id: string;

    title: string;

    label: string;

    icon: ReactNode;

    onClick: () => void;

    active?: boolean;

    danger?: boolean;

    disabled?: boolean;
};

type ToolbarSection = "basic" | "edit" | "generate" | "extension" | "danger";

const EDIT_TOOL_IDS = new Set(["editText", "decreaseFont", "increaseFont", "uploadImage", "uploadVideo", "uploadAudio", "replace", "resize", "maskEdit", "crop", "split"]);

const GENERATE_TOOL_IDS = new Set(["retry", "generateImage", "reversePrompt", "upscale", "superResolve", "angle"]);

export function CanvasNodeHoverToolbar({
    node,

    viewport,

    onKeep,

    onLeave,

    onInfo,

    onEditText,

    onDecreaseFont,

    onIncreaseFont,

    onToggleDialog,

    onGenerateImage,

    onUpload,

    onDownload,

    onSaveAsset,

    onSavePrompt,

    onMaskEdit,

    onCrop,

    onSplit,

    onUpscale,

    onSuperResolve,

    onAngle,

    onViewImage,

    onReversePrompt,

    onRetry,

    onOpenVideoHistory,

    onCaptureVideoFrame,

    onToggleFreeResize,

    assetValidationLabel,

    assetValidationActive,

    assetValidationTone = "default",

    onValidateAsset,

    onDelete,

    extraTools = [],
}: CanvasNodeHoverToolbarProps) {
    const [toolMenuOpen, setToolMenuOpen] = useState(false);

    const [videoFrameMenuOpen, setVideoFrameMenuOpen] = useState(false);

    const { message } = App.useApp();

    const { t } = useTranslation();

    const copyText = useCopyText();

    const { token } = antdTheme.useToken();

    useEffect(() => {
        setToolMenuOpen(false);

        setVideoFrameMenuOpen(false);
    }, [node?.id]);

    if (!node) return null;

    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;

    const top = viewport.y + (node.position.y - 28) * viewport.k - 8;

    const isImage = node.type === CanvasNodeType.Image;

    const isVideo = node.type === CanvasNodeType.Video;

    const isAudio = node.type === CanvasNodeType.Audio;

    const hasImage = isImage && Boolean(node.metadata?.content);

    const hasVideo = isVideo && Boolean(node.metadata?.content || node.metadata?.storageKey);

    const hasAudio = isAudio && Boolean(node.metadata?.content);

    const isText = node.type === CanvasNodeType.Text;

    const isConfig = node.type === CanvasNodeType.Config;

    const canOpenDialog = isText || hasImage || isVideo;

    const canRetry = node.metadata?.status === "error";

    const retryLabel = isVideo
        ? node.metadata?.generationTask?.taskId
            ? t("canvas.node.continueOriginalTask")
            : node.metadata?.videoSubmissionState === "not_submitted"
              ? t("canvas.node.retryUnsubmitted")
              : t("canvas.node.newVideoTask")
        : t("canvas.node.retry");

    const hasVideoHistory =
        isVideo && Boolean(node.metadata?.videoTakeId || node.metadata?.activeVideoTakeId || node.metadata?.generationTask || (node.metadata?.prompt && node.metadata.status !== "idle"));

    const canSavePrompt = Boolean(onSavePrompt && (node.metadata?.composerContent?.trim() || node.metadata?.prompt?.trim() || (isText && node.metadata?.content?.trim())));

    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();

        if (!prompt) {
            message.warning(t("canvas.nodeToolbar.noPrompt"));

            return;
        }

        copyText(prompt, t("common.promptCopied"));
    };

    const imageTools = buildImageToolbarTools(node, {
        onUpload,
        onToggleFreeResize,
        onMaskEdit,
        onCrop,
        onSplit,
        onUpscale,
        onSuperResolve,
        onAngle,
        onViewImage,
        onCopyPrompt: copyImagePrompt,
        onReversePrompt,
    });

    const editTool: ToolbarTool | null =
        canOpenDialog || isConfig
            ? {
                  id: "edit",

                  title: t("common.edit"),

                  label: t("common.edit"),

                  icon: isConfig ? <Settings2 className="size-4" /> : <MessageSquare className="size-4" />,

                  onClick: () => onToggleDialog(node),
              }
            : null;

    const assetValidationTool: ToolbarTool | null =
        onValidateAsset && (hasImage || hasVideo || hasAudio)
            ? {
                  id: "assetValidation",

                  title: assetValidationLabel || t("assetValidation.validate"),

                  label: t("canvas.nodeToolbar.assetStatus"),

                  icon: <ShieldCheck className="size-4" />,

                  active: assetValidationActive,

                  onClick: () => onValidateAsset(node),
              }
            : null;

    const menuTools: ToolbarTool[] = [
        { id: "info", title: t("canvas.nodeToolbar.infoTitle"), label: t("canvas.nodeToolbar.info"), icon: <Info className="size-4" />, onClick: () => onInfo(node) },

        ...(canRetry ? [{ id: "retry", title: retryLabel, label: retryLabel, icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),

        ...(hasVideoHistory
            ? [
                  {
                      id: "videoHistory",
                      title: t("canvas.nodeToolbar.videoHistoryTitle"),
                      label: t("canvas.nodeToolbar.videoHistory"),
                      icon: <Clock3 className="size-4" />,
                      onClick: () => onOpenVideoHistory(node),
                  },
              ]
            : []),

        ...(hasImage || hasVideo || isText
            ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }]
            : []),

        ...(canSavePrompt ? [{ id: "savePrompt", title: "保存提示词", label: "收藏提示词", icon: <BookmarkPlus className="size-4" />, onClick: () => onSavePrompt?.(node) }] : []),

        ...(hasImage || hasVideo || hasAudio
            ? [
                  {
                      id: "download",
                      title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"),
                      label: t("common.download"),
                      icon: <Download className="size-4" />,
                      onClick: () => onDownload(node),
                  },
              ]
            : []),

        ...(isText
            ? [{ id: "editText", title: t("canvas.nodeToolbar.editTextTitle"), label: t("canvas.nodeToolbar.editText"), icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }]
            : []),

        ...(isText
            ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }]
            : []),

        ...(isText
            ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }]
            : []),

        ...(isText
            ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }]
            : []),

        ...(isImage && !hasImage
            ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }]
            : []),

        ...(isVideo
            ? [
                  {
                      id: "uploadVideo",
                      title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"),
                      label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"),
                      icon: <Video className="size-4" />,
                      onClick: () => onUpload(node),
                  },
              ]
            : []),

        ...(isAudio
            ? [
                  {
                      id: "uploadAudio",
                      title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"),
                      label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"),
                      icon: <Music2 className="size-4" />,
                      onClick: () => onUpload(node),
                  },
              ]
            : []),

        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),

        ...extraTools.map((tool) => ({ ...tool, id: `extension:${tool.id}` })),

        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];

    const sectionOrder: ToolbarSection[] = ["basic", "edit", "generate", "extension", "danger"];

    const menuItems: MenuProps["items"] = sectionOrder.flatMap((section) => {
        const tools = menuTools.filter((tool) => toolbarSection(tool.id) === section);

        if (!tools.length) return [];

        return [
            {
                key: `section:${section}`,

                type: "group" as const,

                label: t(`canvas.nodeToolbar.sections.${section}`),

                children: tools.map((tool) => ({
                    key: tool.id,

                    label: tool.label,

                    icon: tool.icon,

                    danger: tool.danger,

                    disabled: tool.disabled,

                    onClick: () => {
                        onKeep(node.id);

                        tool.onClick();

                        setToolMenuOpen(false);
                    },
                })),
            },
        ];
    });

    const videoFrameItems: MenuProps["items"] = [
        { key: "first", label: t("canvas.videoFrames.first"), icon: <ScanLine className="size-4" /> },

        { key: "last", label: t("canvas.videoFrames.last"), icon: <ScanLine className="size-4" /> },

        { key: "current", label: t("canvas.videoFrames.custom"), icon: <ScanLine className="size-4" /> },
    ];

    const validationDotColor =
        assetValidationTone === "success"
            ? token.colorSuccess
            : assetValidationTone === "error"
              ? token.colorError
              : ["processing", "warning"].includes(assetValidationTone)
                ? token.colorWarning
                : token.colorTextQuaternary;

    return (
        <div
            className="absolute z-[70] flex h-10 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-xl border px-1 text-sm"

            style={{ left, top, background: token.colorBgElevated, borderColor: token.colorBorderSecondary, color: token.colorText, boxShadow: token.boxShadowSecondary }}

            onMouseEnter={() => onKeep(node.id)}

            onMouseLeave={() => {
                if (!toolMenuOpen && !videoFrameMenuOpen) onLeave();
            }}

            onMouseDown={(event) => event.stopPropagation()}

            onPointerDown={(event) => event.stopPropagation()}
        >
            {editTool ? <ToolbarAction {...editTool} showLabel /> : null}

            {assetValidationTool ? (
                <ToolbarAction
                    {...assetValidationTool}

                    showLabel

                    trailing={<span className="size-1.5 rounded-full" style={{ background: validationDotColor }} />}
                />
            ) : null}

            {isVideo && hasVideo && onCaptureVideoFrame ? (
                <Dropdown
                    open={videoFrameMenuOpen}

                    trigger={["click"]}

                    placement="bottomRight"

                    menu={{
                        items: videoFrameItems,

                        selectable: false,

                        onClick: ({ key }) => {
                            onKeep(node.id);

                            onCaptureVideoFrame(node, key as VideoFramePosition);

                            setVideoFrameMenuOpen(false);
                        },
                    }}

                    onOpenChange={(open) => {
                        setVideoFrameMenuOpen(open);

                        if (open) onKeep(node.id);
                    }}
                >
                    <button
                        type="button"

                        className="group flex h-10 items-center px-1.5"

                        aria-label={t("canvas.videoFrames.capture")}

                        aria-expanded={videoFrameMenuOpen}

                        title={t("canvas.videoFrames.customHint")}

                        onClick={() => onKeep(node.id)}
                    >
                        <span
                            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 transition group-hover:bg-black/5 dark:group-hover:bg-white/10"
                            style={{ background: videoFrameMenuOpen ? token.colorFillSecondary : undefined }}
                        >
                            <ScanLine className="size-4" />

                            <span>{t("canvas.videoFrames.capture")}</span>

                            <ChevronDown className={`size-3.5 transition-transform ${videoFrameMenuOpen ? "rotate-180" : ""}`} />
                        </span>
                    </button>
                </Dropdown>
            ) : null}

            <Dropdown
                open={toolMenuOpen}

                trigger={["click"]}

                placement="bottomRight"

                menu={{ items: menuItems, selectable: false, style: { maxHeight: "min(70vh, 560px)", overflowY: "auto" } }}

                onOpenChange={(open) => {
                    setToolMenuOpen(open);

                    if (open) onKeep(node.id);
                }}
            >
                <button
                    type="button"

                    className="group flex h-10 items-center px-1.5"

                    aria-label={t("canvas.nodeToolbar.toolMenuTitle")}

                    aria-expanded={toolMenuOpen}

                    onClick={() => onKeep(node.id)}
                >
                    <span
                        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 transition group-hover:bg-black/5 dark:group-hover:bg-white/10"
                        style={{ background: toolMenuOpen ? token.colorFillSecondary : undefined }}
                    >
                        <Settings2 className="size-4" />

                        <span>{t("canvas.nodeToolbar.tools")}</span>

                        <ChevronDown className={`size-3.5 transition-transform ${toolMenuOpen ? "rotate-180" : ""}`} />
                    </span>
                </button>
            </Dropdown>
        </div>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const { t } = useTranslation();

    const [view, setView] = useState<"info" | "json">("info");

    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;

    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;

    const json = useMemo(() => {
        if (!node) return "";

        return JSON.stringify(
            node,

            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }

                return value;
            },

            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>{t("canvas.nodeToolbar.nodeInfo")}</span>

            <Segmented
                size="small"

                value={view}

                onChange={(value) => setView(value as "info" | "json")}

                options={[
                    { label: t("canvas.nodeToolbar.info"), value: "info" },

                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />

                            <InfoRow label={t("canvas.nodeToolbar.name")} value={node.title || t("canvas.node.untitled")} />

                            <InfoRow
                                label={t("canvas.nodeToolbar.type")}
                                value={
                                    node.type === CanvasNodeType.Group
                                        ? t("canvas.node.group")
                                        : node.type === CanvasNodeType.Config
                                          ? t("canvas.configNode.title")
                                          : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType)
                                            ? t(`assets.kinds.${node.type}`)
                                            : getNodeDefinition(node.type)?.title || node.type
                                }
                            />

                            <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />

                            <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />

                            <InfoRow label={t("canvas.nodeToolbar.status")} value={node.metadata?.status || "idle"} />

                            {batchCount > 1 ? <InfoRow label={t("canvas.nodeToolbar.imageGroup")} value={t("canvas.configNode.images", { count: batchCount })} /> : null}

                            {node.metadata?.prompt ? <InfoRow label={t("canvas.configNode.prompt")} value={node.metadata.prompt} /> : null}

                            {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} /> : null}

                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre
                            className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5"
                            style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                        >
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function toolbarSection(id: string): ToolbarSection {
    if (id === "delete") return "danger";

    if (id.startsWith("extension:")) return "extension";

    if (EDIT_TOOL_IDS.has(id)) return "edit";

    if (GENERATE_TOOL_IDS.has(id)) return "generate";

    return "basic";
}

function ToolbarAction({ title, label, icon, onClick, showLabel, active = false, danger = false, disabled = false, trailing }: ToolbarTool & { showLabel: boolean; trailing?: ReactNode }) {
    const { token } = antdTheme.useToken();

    const hasText = showLabel && Boolean(label);

    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button
                type="button"
                disabled={disabled}
                className="group relative flex h-10 items-center whitespace-nowrap px-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: danger ? token.colorError : undefined }}
                onClick={onClick}
                aria-label={title}
            >
                <span
                    className={`flex h-8 items-center ${hasText ? "gap-1.5 px-2.5" : "justify-center px-2"} rounded-lg transition group-hover:bg-black/5 dark:group-hover:bg-white/10`}
                    style={{ background: active ? token.colorFillSecondary : undefined }}
                >
                    {icon}

                    {hasText ? <span>{label}</span> : null}

                    {trailing}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>

            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
