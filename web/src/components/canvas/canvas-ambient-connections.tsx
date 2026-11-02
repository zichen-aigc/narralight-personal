import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasAmbientBitmapCanTransform, canvasAmbientBitmapTransform, canvasConnectionCurve, canvasConnectionCurveBounds, canvasConnectionCurveBoundsIntersectsViewport } from "@/lib/canvas/canvas-connection-geometry";
import type { CanvasRenderMode } from "@/lib/canvas/canvas-performance";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { reportCanvasPanDiagnostic } from "./canvas-pan-diagnostics";

const MAX_BACKING_PIXELS = 12_000_000;

export type CanvasAmbientConnectionsHandle = {
    updateViewport: (viewport: ViewportTransform) => void;
};

export const CanvasAmbientConnections = memo(
    forwardRef<
        CanvasAmbientConnectionsHandle,
        {
            connections: CanvasConnection[];
            nodeById: ReadonlyMap<string, CanvasNodeData>;
            viewport: ViewportTransform;
            viewportSize: { width: number; height: number };
            renderMode: CanvasRenderMode;
        }
    >(function CanvasAmbientConnections({ connections, nodeById, viewport, viewportSize, renderMode }, ref) {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const drawnViewportRef = useRef<ViewportTransform | null>(null);
        const theme = canvasThemes[useThemeStore((state) => state.theme)];
        const overscan = Math.min(512, Math.max(192, Math.round(Math.min(viewportSize.width, viewportSize.height) * 0.12)));
        const canvasSize = { width: viewportSize.width + overscan * 2, height: viewportSize.height + overscan * 2 };
        const curves = useMemo(
            () =>
                connections.flatMap((connection) => {
                    const from = nodeById.get(connection.fromNodeId);
                    const to = nodeById.get(connection.toNodeId);
                    if (!from || !to) return [];
                    const curve = canvasConnectionCurve(from, to);
                    return [{ curve, bounds: canvasConnectionCurveBounds(curve) }];
                }),
            [connections, nodeById],
        );

        const drawViewport = useCallback(
            (nextViewport: ViewportTransform) => {
                const canvas = canvasRef.current;
                if (!canvas || viewportSize.width <= 0 || viewportSize.height <= 0) return;
                const requestedDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
                const pixelBudgetDpr = Math.sqrt(MAX_BACKING_PIXELS / Math.max(canvasSize.width * canvasSize.height, 1));
                const dpr = Math.max(1, Math.min(requestedDpr, pixelBudgetDpr));
                const pixelWidth = Math.max(1, Math.round(canvasSize.width * dpr));
                const pixelHeight = Math.max(1, Math.round(canvasSize.height * dpr));
                if (canvas.width !== pixelWidth) {
                    reportCanvasPanDiagnostic(canvas, "canvasResize");
                    canvas.width = pixelWidth;
                }
                if (canvas.height !== pixelHeight) {
                    reportCanvasPanDiagnostic(canvas, "canvasResize");
                    canvas.height = pixelHeight;
                }
                const context = canvas.getContext("2d");
                if (!context) return;

                reportCanvasPanDiagnostic(canvas, "canvasDraw");
                reportCanvasPanDiagnostic(canvas, "relationshipScan");
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, pixelWidth, pixelHeight);
                context.setTransform(dpr * nextViewport.k, 0, 0, dpr * nextViewport.k, dpr * (nextViewport.x + overscan), dpr * (nextViewport.y + overscan));
                context.beginPath();
                let visibleCount = 0;
                curves.forEach(({ curve, bounds }) => {
                    if (!canvasConnectionCurveBoundsIntersectsViewport(bounds, nextViewport, viewportSize, overscan + 48)) return;
                    if (canvasConnectionCurveBoundsIntersectsViewport(bounds, nextViewport, viewportSize)) visibleCount += 1;
                    context.moveTo(curve.start.x, curve.start.y);
                    context.bezierCurveTo(curve.control1.x, curve.control1.y, curve.control2.x, curve.control2.y, curve.end.x, curve.end.y);
                });

                const baseOpacity = renderMode === "overview" ? 0.14 : renderMode === "thumbnail" ? 0.18 : 0.22;
                context.globalAlpha = Math.max(0.1, baseOpacity - Math.max(0, visibleCount - 180) * 0.00025);
                context.strokeStyle = theme.node.muted;
                context.lineWidth = (renderMode === "overview" ? 0.7 : renderMode === "thumbnail" ? 0.85 : 1) / Math.max(nextViewport.k, 0.05);
                context.stroke();
                context.globalAlpha = 1;
                canvas.dataset.canvasVisibleConnectionCount = String(visibleCount);
                canvas.dataset.canvasBackingDpr = dpr.toFixed(3);
                canvas.style.transform = "";
                drawnViewportRef.current = nextViewport;
            },
            [canvasSize.height, canvasSize.width, curves, overscan, renderMode, theme.node.muted, viewportSize],
        );

        useImperativeHandle(
            ref,
            () => ({
                updateViewport(nextViewport) {
                    const canvas = canvasRef.current;
                    const drawnViewport = drawnViewportRef.current;
                    if (!canvas || !drawnViewport || !canvasAmbientBitmapCanTransform(drawnViewport, nextViewport, viewportSize, overscan)) {
                        drawViewport(nextViewport);
                        return;
                    }
                    const transform = canvasAmbientBitmapTransform(drawnViewport, nextViewport, overscan);
                    canvas.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
                },
            }),
            [drawViewport, overscan, viewportSize],
        );

        useLayoutEffect(() => drawViewport(viewport), [drawViewport, viewport]);

        return (
            <canvas
                ref={canvasRef}
                aria-hidden="true"
                data-canvas-ambient-connections={connections.length}
                className="pointer-events-none absolute"
                style={{ left: -overscan, top: -overscan, width: canvasSize.width, height: canvasSize.height, transformOrigin: "0 0", willChange: "transform" }}
            />
        );
    }),
);
