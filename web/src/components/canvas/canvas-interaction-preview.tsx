import { memo, useEffect, useMemo, useRef } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasInteractionPreviewPlan, type CanvasRenderMode } from "@/lib/canvas/canvas-performance";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { reportCanvasPanDiagnostic } from "./canvas-pan-diagnostics";

const PREVIEW_IMAGE_CACHE_LIMIT = 80;
const PREVIEW_MEDIA_WAIT_MS = 1800;

type PreviewImageEntry = {
    image: HTMLImageElement | null;
    promise: Promise<HTMLImageElement | null>;
};

const previewImageCache = new Map<string, PreviewImageEntry>();

type Props = {
    nodes: CanvasNodeData[];
    mode: Exclude<CanvasRenderMode, "overview">;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    posterByNodeId: ReadonlyMap<string, string>;
    selectedNodeIds: ReadonlySet<string>;
    relatedNodeIds: ReadonlySet<string>;
    interactionLocked: boolean;
    snapshotRevision: number;
    onReady: (mode: Exclude<CanvasRenderMode, "overview">) => void;
};

export const CanvasInteractionPreview = memo(function CanvasInteractionPreview({ nodes, mode, viewport, viewportSize, posterByNodeId, selectedNodeIds, relatedNodeIds, interactionLocked, snapshotRevision, onReady }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const snapshot = useMemo(() => ({ viewport, plan: canvasInteractionPreviewPlan(viewport, viewportSize, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, mode) }), [mode, snapshotRevision, viewportSize.height, viewportSize.width]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof document === "undefined") return;
        const isInteractionLocked = () => interactionLocked || Boolean(canvas.closest("[data-canvas-pan-session]"));
        if (isInteractionLocked()) {
            canvas.dataset.canvasSnapshotPending = "true";
            return;
        }
        let active = true;
        let timeoutId: number | null = null;
        const sources = [...new Set(nodes.map((node) => canvasPreviewMediaSource(node, posterByNodeId)).filter((source): source is string => Boolean(source)))];
        const pending = sources.map((source) => loadPreviewImage(source, () => reportCanvasPanDiagnostic(canvas, "mediaLoad")));

        const draw = () => {
            if (!active || isInteractionLocked()) {
                canvas.dataset.canvasSnapshotPending = "true";
                return;
            }
            reportCanvasPanDiagnostic(canvas, "previewBuild");
            reportCanvasPanDiagnostic(canvas, "offscreenCanvas");
            const buffer = document.createElement("canvas");
            buffer.width = snapshot.plan.pixelWidth;
            buffer.height = snapshot.plan.pixelHeight;
            const context = buffer.getContext("2d", { alpha: true });
            if (!context) return;
            context.setTransform(snapshot.plan.pixelScale, 0, 0, snapshot.plan.pixelScale, -snapshot.plan.bounds.left * snapshot.plan.pixelScale, -snapshot.plan.bounds.top * snapshot.plan.pixelScale);
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "medium";
            drawPreviewNodes(context, nodes, mode, snapshot.viewport.k, posterByNodeId, selectedNodeIds, relatedNodeIds, theme);

            reportCanvasPanDiagnostic(canvas, "canvasResize");
            canvas.width = snapshot.plan.pixelWidth;
            canvas.height = snapshot.plan.pixelHeight;
            reportCanvasPanDiagnostic(canvas, "canvasDraw");
            canvas.getContext("2d")?.drawImage(buffer, 0, 0);
            buffer.width = 1;
            buffer.height = 1;
            canvas.dataset.canvasSnapshotReady = "true";
            delete canvas.dataset.canvasSnapshotPending;
            onReady(mode);
        };

        if (!pending.length || sources.every((source) => Boolean(previewImageCache.get(source)?.image))) {
            draw();
        } else {
            let firstDrawn = false;
            let timedOut = false;
            const firstDraw = () => {
                if (firstDrawn) return;
                firstDrawn = true;
                draw();
            };
            const all = Promise.allSettled(pending).then(() => undefined);
            const timeout = new Promise<void>((resolve) => {
                timeoutId = window.setTimeout(() => {
                    timedOut = true;
                    resolve();
                }, PREVIEW_MEDIA_WAIT_MS);
            });
            void Promise.race([all, timeout]).then(firstDraw);
            void all.then(() => {
                if (timeoutId !== null) {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (firstDrawn && timedOut) draw();
                else firstDraw();
            });
        }

        return () => {
            active = false;
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [interactionLocked, mode, nodes, onReady, posterByNodeId, relatedNodeIds, selectedNodeIds, snapshot, theme]);

    return (
        <canvas
            ref={canvasRef}
            data-canvas-interaction-preview={mode}
            className="pointer-events-none absolute"
            style={{ left: snapshot.plan.bounds.left, top: snapshot.plan.bounds.top, width: snapshot.plan.bounds.width, height: snapshot.plan.bounds.height }}
            aria-hidden="true"
        />
    );
});

export function canvasPreviewMediaSource(node: CanvasNodeData, posterByNodeId: ReadonlyMap<string, string>) {
    if (node.type === CanvasNodeType.Image) return node.metadata?.content || "";
    if (node.type === CanvasNodeType.Video) return posterByNodeId.get(node.id) || "";
    return "";
}

function loadPreviewImage(source: string, onStart?: () => void) {
    const existing = previewImageCache.get(source);
    if (existing) {
        previewImageCache.delete(source);
        previewImageCache.set(source, existing);
        return existing.promise;
    }
    if (typeof Image === "undefined") return Promise.resolve(null);
    onStart?.();
    const entry: PreviewImageEntry = { image: null, promise: Promise.resolve(null) };
    entry.promise = new Promise<HTMLImageElement | null>((resolve) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            entry.image = image;
            resolve(image);
        };
        image.onerror = () => resolve(null);
        image.src = source;
    });
    previewImageCache.set(source, entry);
    while (previewImageCache.size > PREVIEW_IMAGE_CACHE_LIMIT) previewImageCache.delete(previewImageCache.keys().next().value as string);
    return entry.promise;
}

function drawPreviewNodes(
    context: CanvasRenderingContext2D,
    nodes: CanvasNodeData[],
    mode: Exclude<CanvasRenderMode, "overview">,
    viewportScale: number,
    posterByNodeId: ReadonlyMap<string, string>,
    selectedNodeIds: ReadonlySet<string>,
    relatedNodeIds: ReadonlySet<string>,
    theme: (typeof canvasThemes)[keyof typeof canvasThemes],
) {
    const safeScale = Math.max(viewportScale, 0.05);
    const orderedNodes = [...nodes].sort((left, right) => Number(left.type !== CanvasNodeType.Group) - Number(right.type !== CanvasNodeType.Group));
    orderedNodes.forEach((node) => {
        const color = getNodeDefinition(node.type)?.minimapColor || theme.node.muted;
        if (node.type === CanvasNodeType.Group) {
            context.save();
            context.globalAlpha = selectedNodeIds.has(node.id) ? 0.9 : 0.45;
            context.strokeStyle = selectedNodeIds.has(node.id) ? theme.node.activeStroke : color;
            context.lineWidth = (selectedNodeIds.has(node.id) ? 2 : 1) / safeScale;
            context.setLineDash([10 / safeScale, 7 / safeScale]);
            roundedRect(context, node.position.x, node.position.y, node.width, node.height, 12 / safeScale);
            context.stroke();
            context.restore();
            return;
        }

        const x = node.position.x;
        const y = node.position.y;
        const width = Math.max(node.width, 1);
        const height = Math.max(node.height, 1);
        const radius = 12 / safeScale;
        const selected = selectedNodeIds.has(node.id);
        const related = relatedNodeIds.has(node.id);
        context.save();
        roundedRect(context, x, y, width, height, radius);
        context.clip();
        context.globalAlpha = 0.18;
        context.fillStyle = color;
        context.fillRect(x, y, width, height);
        context.globalAlpha = 1;

        const mediaSource = canvasPreviewMediaSource(node, posterByNodeId);
        const image = mediaSource ? previewImageCache.get(mediaSource)?.image : null;
        if (image) drawImageCover(context, image, x, y, width, height);
        else drawPreviewBody(context, node, mode, x, y, width, height, safeScale, color, theme.node.text);

        if (node.type === CanvasNodeType.Video) drawPlayMark(context, x + width / 2, y + height / 2, Math.min(width, height) * 0.12, safeScale);
        drawPreviewTitle(context, node.title || getNodeDefinition(node.type)?.title || "未命名节点", x, y, width, height, safeScale, theme.node.text);
        context.restore();

        context.save();
        roundedRect(context, x, y, width, height, radius);
        context.strokeStyle = selected ? theme.node.activeStroke : related ? theme.node.muted : color;
        context.globalAlpha = selected ? 1 : related ? 0.86 : 0.62;
        context.lineWidth = (selected ? 2.5 : related ? 1.7 : 1) / safeScale;
        context.stroke();
        context.restore();
    });
}

function drawPreviewBody(context: CanvasRenderingContext2D, node: CanvasNodeData, mode: Exclude<CanvasRenderMode, "overview">, x: number, y: number, width: number, height: number, scale: number, color: string, textColor: string) {
    const content = String(node.metadata?.content || node.metadata?.composerContent || node.metadata?.prompt || "").trim();
    context.save();
    context.globalAlpha = 0.22;
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    context.globalAlpha = 0.74;
    context.fillStyle = textColor;
    const fontSize = (mode === "work" ? 12 : 10) / scale;
    const lineHeight = fontSize * 1.45;
    context.font = `${mode === "work" ? 500 : 600} ${fontSize}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    drawWrappedText(context, content || getNodeDefinition(node.type)?.title || "内容", x + 12 / scale, y + 16 / scale, Math.max(width - 24 / scale, 1), lineHeight, mode === "work" ? 6 : 2);
    context.restore();
}

function drawPreviewTitle(context: CanvasRenderingContext2D, title: string, x: number, y: number, width: number, height: number, scale: number, textColor: string) {
    const fontSize = 11 / scale;
    const paddingX = 9 / scale;
    const paddingY = 7 / scale;
    const barHeight = fontSize + paddingY * 2;
    context.save();
    context.globalAlpha = 0.68;
    context.fillStyle = "#050605";
    context.fillRect(x, y + height - barHeight, width, barHeight);
    context.globalAlpha = 0.94;
    context.fillStyle = textColor;
    context.font = `650 ${fontSize}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    context.textBaseline = "middle";
    context.fillText(fitCanvasText(context, title, Math.max(width - paddingX * 2, 1)), x + paddingX, y + height - barHeight / 2);
    context.restore();
}

function drawImageCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
    const sourceWidth = Math.max(image.naturalWidth || image.width, 1);
    const sourceHeight = Math.max(image.naturalHeight || image.height, 1);
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const cropWidth = width / scale;
    const cropHeight = height / scale;
    context.drawImage(image, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
}

function drawPlayMark(context: CanvasRenderingContext2D, centerX: number, centerY: number, radius: number, scale: number) {
    const safeRadius = Math.max(radius, 12 / scale);
    context.save();
    context.globalAlpha = 0.76;
    context.fillStyle = "#050605";
    context.beginPath();
    context.arc(centerX, centerY, safeRadius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.92;
    context.fillStyle = "#f0eddc";
    context.beginPath();
    context.moveTo(centerX - safeRadius * 0.28, centerY - safeRadius * 0.42);
    context.lineTo(centerX + safeRadius * 0.48, centerY);
    context.lineTo(centerX - safeRadius * 0.28, centerY + safeRadius * 0.42);
    context.closePath();
    context.fill();
    context.restore();
}

function drawWrappedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
    const characters = [...text.slice(0, 320)];
    let line = "";
    let lineIndex = 0;
    for (const character of characters) {
        const next = line + character;
        if (line && context.measureText(next).width > maxWidth) {
            context.fillText(line, x, y + lineIndex * lineHeight);
            lineIndex += 1;
            if (lineIndex >= maxLines) return;
            line = character;
        } else {
            line = next;
        }
    }
    if (line && lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight);
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
    if (context.measureText(text).width <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
    return `${result}…`;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
}
