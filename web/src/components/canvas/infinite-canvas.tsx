import React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";

import { canvasWheelViewport } from "@/lib/canvas/canvas-interaction-commands";

import { bindCanvasWheelEvents } from "@/lib/canvas/canvas-browser-events";

import { useThemeStore } from "@/stores/use-theme-store";

import type { ViewportTransform } from "@/types/canvas";

import { CANVAS_PAN_DIAGNOSTIC_EVENT, type CanvasPanDiagnosticKind } from "./canvas-pan-diagnostics";

import type { CanvasWebglPanSessionHandle } from "@/lib/canvas/canvas-webgl-pan-engine";

const VIEWPORT_SETTLE_MS = 120;

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;

    viewport: ViewportTransform;

    tool: "select" | "pan";

    backgroundMode?: CanvasBackgroundMode;

    interactionLocked?: boolean;

    animateViewport?: boolean;

    onViewportChange: (viewport: ViewportTransform) => void;

    onViewportPreview?: (viewport: ViewportTransform) => void;

    onViewportInteractionChange?: (interacting: boolean) => void;

    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;

    onCanvasDeselect?: () => void;

    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;

    onContextMenu?: (event: React.MouseEvent) => void;

    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;

    viewportUnderlay?: React.ReactNode;

    interactionSurface?: React.ReactNode;

    streamingPanSurface?: React.ReactNode;

    streamingPanSessionRef?: React.RefObject<CanvasWebglPanSessionHandle | null>;

    preferStreamingPan?: boolean;

    onPanFallbackViewport?: (viewport: ViewportTransform) => void;

    interactionCommitToken?: number;

    children: React.ReactNode;
};

type CanvasPanMetrics = Record<CanvasPanDiagnosticKind, number> & {
    pointerMoves: number;

    rafFrames: number;

    transformWrites: number;

    cameraUpdatesDuringGesture: number;

    cameraUpdatesAfterPointerUp: number;

    firstFrameMs: number | null;
};

const emptyPanMetrics = (): CanvasPanMetrics => ({
    pointerMoves: 0,

    rafFrames: 0,

    transformWrites: 0,

    cameraUpdatesDuringGesture: 0,

    cameraUpdatesAfterPointerUp: 0,

    firstFrameMs: null,

    previewBuild: 0,

    canvasDraw: 0,

    canvasResize: 0,

    offscreenCanvas: 0,

    mediaLoad: 0,

    visibleScan: 0,

    relationshipScan: 0,

    webglDraw: 0,

    spatialQuery: 0,

    relationBufferBuild: 0,

    atlasBuild: 0,

    proxyDecode: 0,

    generationSwap: 0,
});

export function InfiniteCanvas({
    containerRef,

    viewport,

    tool,

    backgroundMode = "lines",

    interactionLocked = false,

    animateViewport = false,

    onViewportChange,

    onViewportPreview,

    onViewportInteractionChange,

    onCanvasMouseDown,

    onCanvasDeselect,

    onCanvasDoubleClick,

    onContextMenu,

    onDrop,

    viewportUnderlay,

    interactionSurface,

    streamingPanSurface,

    streamingPanSessionRef,

    preferStreamingPan = false,

    onPanFallbackViewport,

    interactionCommitToken = 0,

    children,
}: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const detailLayerRef = useRef<HTMLDivElement>(null);

    const panSurfaceRef = useRef<HTMLDivElement>(null);

    const panWorldLayerRef = useRef<HTMLDivElement>(null);

    const gridLayerRef = useRef<HTMLDivElement>(null);

    const panState = useRef({
        isPanning: false,

        startX: 0,

        startY: 0,

        initialX: 0,

        initialY: 0,

        hasMoved: false,

        startedOnBackground: false,

        pointerId: null as number | null,

        useSnapshot: false,

        useWebgl: false,

        initialSurfaceX: 0,

        initialSurfaceY: 0,
    });

    const viewportRef = useRef(viewport);

    const scaleRef = useRef(viewport.k);

    const frameRef = useRef<number | null>(null);

    const nextViewportRef = useRef<ViewportTransform | null>(null);

    const nextViewportIsPanRef = useRef(false);

    const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const viewportInteractingRef = useRef(false);

    const pendingPanHandoffRef = useRef(false);

    const panSurfaceOffsetRef = useRef({ x: 0, y: 0 });

    const panCommitTokenRef = useRef(interactionCommitToken);

    const panStartedAtRef = useRef(0);

    const panMetricsRef = useRef<CanvasPanMetrics>(emptyPanMetrics());

    const [isSpacePressed, setIsSpacePressed] = useState(false);

    const [isControlPressed, setIsControlPressed] = useState(false);

    const writeLayerTransform = useCallback((element: HTMLElement | null, next: ViewportTransform) => {
        if (element) element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.k})`;
    }, []);

    const writeViewportToLayers = useCallback(
        (next: ViewportTransform, notifyPreview = true) => {
            viewportRef.current = next;

            scaleRef.current = next.k;

            writeLayerTransform(detailLayerRef.current, next);

            writeLayerTransform(panWorldLayerRef.current, next);

            if (gridLayerRef.current) Object.assign(gridLayerRef.current.style, canvasGridStyle(next, backgroundMode, theme.canvas.line, theme.canvas.dot));

            if (notifyPreview) onViewportPreview?.(next);
        },

        [backgroundMode, onViewportPreview, theme.canvas.dot, theme.canvas.line, writeLayerTransform],
    );

    const writePanViewport = useCallback(
        (next: ViewportTransform) => {
            viewportRef.current = next;

            scaleRef.current = next.k;

            const state = panState.current;

            const dx = next.x - state.initialX;

            const dy = next.y - state.initialY;

            if (state.useWebgl) {
                const drawn = streamingPanSessionRef?.current?.draw(next) || false;

                if (!drawn) {
                    state.useWebgl = false;

                    if (containerRef.current) containerRef.current.dataset.canvasPanSession = "fallback";

                    writeLayerTransform(detailLayerRef.current, next);

                    panMetricsRef.current.transformWrites += 1;

                    onPanFallbackViewport?.(next);
                }
            } else if (state.useSnapshot && panSurfaceRef.current) {
                const x = state.initialSurfaceX + dx;

                const y = state.initialSurfaceY + dy;

                panSurfaceOffsetRef.current = { x, y };

                panSurfaceRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;

                panMetricsRef.current.transformWrites += 1;
            } else {
                writeLayerTransform(detailLayerRef.current, next);

                panMetricsRef.current.transformWrites += 1;

                if (preferStreamingPan) onPanFallbackViewport?.(next);
            }

            const metrics = panMetricsRef.current;

            metrics.rafFrames += 1;

            if (metrics.firstFrameMs === null) metrics.firstFrameMs = Math.max(0, performance.now() - panStartedAtRef.current);
        },

        [containerRef, onPanFallbackViewport, preferStreamingPan, streamingPanSessionRef, writeLayerTransform],
    );

    const flushViewportFrame = useCallback(() => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);

            frameRef.current = null;
        }

        const next = nextViewportRef.current;

        const panOnly = nextViewportIsPanRef.current;

        nextViewportRef.current = null;

        nextViewportIsPanRef.current = false;

        if (next) panOnly ? writePanViewport(next) : writeViewportToLayers(next);
    }, [writePanViewport, writeViewportToLayers]);

    const queueViewportPreview = useCallback(
        (next: ViewportTransform) => {
            viewportRef.current = next;

            scaleRef.current = next.k;

            nextViewportRef.current = next;

            nextViewportIsPanRef.current = false;

            if (frameRef.current !== null) return;

            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;

                const queued = nextViewportRef.current;

                const panOnly = nextViewportIsPanRef.current;

                nextViewportRef.current = null;

                nextViewportIsPanRef.current = false;

                if (queued) panOnly ? writePanViewport(queued) : writeViewportToLayers(queued);
            });
        },

        [writePanViewport, writeViewportToLayers],
    );

    const queuePanViewport = useCallback(
        (next: ViewportTransform) => {
            nextViewportRef.current = next;

            nextViewportIsPanRef.current = true;

            if (frameRef.current !== null) return;

            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;

                const queued = nextViewportRef.current;

                const panOnly = nextViewportIsPanRef.current;

                nextViewportRef.current = null;

                nextViewportIsPanRef.current = false;

                if (queued) panOnly ? writePanViewport(queued) : writeViewportToLayers(queued);
            });
        },

        [writePanViewport, writeViewportToLayers],
    );

    const releasePanHandoff = useCallback(
        (notifyPreview = true) => {
            const next = viewportRef.current;

            writeLayerTransform(detailLayerRef.current, next);

            writeLayerTransform(panWorldLayerRef.current, next);

            if (panSurfaceRef.current) panSurfaceRef.current.style.transform = "translate3d(0px, 0px, 0)";

            streamingPanSessionRef?.current?.release();

            panSurfaceOffsetRef.current = { x: 0, y: 0 };

            pendingPanHandoffRef.current = false;

            if (containerRef.current) delete containerRef.current.dataset.canvasPanSession;

            if (notifyPreview) onViewportPreview?.(next);
        },

        [containerRef, onViewportPreview, streamingPanSessionRef, writeLayerTransform],
    );

    const beginViewportInteraction = useCallback(() => {
        if (interactionTimerRef.current) {
            clearTimeout(interactionTimerRef.current);

            interactionTimerRef.current = null;
        }

        if (viewportInteractingRef.current) return;

        viewportInteractingRef.current = true;

        if (detailLayerRef.current) detailLayerRef.current.style.pointerEvents = "none";

        detailLayerRef.current?.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => media.pause());

        if (containerRef.current) {
            containerRef.current.dataset.canvasInteracting = "true";

            delete containerRef.current.dataset.canvasIdleSince;
        }

        onViewportInteractionChange?.(true);
    }, [containerRef, onViewportInteractionChange]);

    const commitViewportInteraction = useCallback(() => {
        if (interactionTimerRef.current) {
            clearTimeout(interactionTimerRef.current);

            interactionTimerRef.current = null;
        }

        flushViewportFrame();

        if (!viewportInteractingRef.current) return;

        viewportInteractingRef.current = false;

        const committed = viewportRef.current;

        const panWasActive = Boolean(containerRef.current?.dataset.canvasPanSession);

        if (panWasActive) pendingPanHandoffRef.current = true;

        if (panState.current.useWebgl) streamingPanSessionRef?.current?.end();

        onViewportChange(committed);

        if (panWasActive) panMetricsRef.current.cameraUpdatesAfterPointerUp += 1;

        onViewportInteractionChange?.(false);

        if (panWasActive && containerRef.current) containerRef.current.dataset.canvasPanLastMetrics = JSON.stringify(panMetricsRef.current);
    }, [containerRef, flushViewportFrame, onViewportChange, onViewportInteractionChange, streamingPanSessionRef]);

    const settleViewportInteraction = useCallback(() => {
        if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);

        interactionTimerRef.current = setTimeout(commitViewportInteraction, VIEWPORT_SETTLE_MS);
    }, [commitViewportInteraction]);

    useLayoutEffect(() => {
        if (viewportInteractingRef.current) return;

        if (pendingPanHandoffRef.current) {
            viewportRef.current = viewport;

            scaleRef.current = viewport.k;

            writeLayerTransform(detailLayerRef.current, viewport);

            if (gridLayerRef.current) Object.assign(gridLayerRef.current.style, canvasGridStyle(viewport, backgroundMode, theme.canvas.line, theme.canvas.dot));

            return;
        }

        writeViewportToLayers(viewport, false);
    }, [backgroundMode, theme.canvas.dot, theme.canvas.line, viewport, writeLayerTransform, writeViewportToLayers]);

    useLayoutEffect(() => {
        if (panCommitTokenRef.current === interactionCommitToken) return;

        panCommitTokenRef.current = interactionCommitToken;

        if (!pendingPanHandoffRef.current || panState.current.isPanning) return;

        releasePanHandoff();
    }, [interactionCommitToken, releasePanHandoff]);

    useLayoutEffect(() => {
        const container = containerRef.current;

        if (!container) return;

        const locked = interactionLocked || viewportInteractingRef.current;

        if (detailLayerRef.current) detailLayerRef.current.style.pointerEvents = locked ? "none" : "";

        if (locked) {
            container.dataset.canvasInteracting = "true";

            delete container.dataset.canvasIdleSince;
        } else if (!viewportInteractingRef.current) {
            delete container.dataset.canvasInteracting;

            container.dataset.canvasIdleSince = String(performance.now());
        }
    }, [containerRef, interactionLocked]);

    useEffect(
        () => () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

            if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);

            if (detailLayerRef.current) detailLayerRef.current.style.pointerEvents = "";

            if (panSurfaceRef.current) panSurfaceRef.current.style.transform = "";

            streamingPanSessionRef?.current?.release();

            if (containerRef.current) {
                delete containerRef.current.dataset.canvasInteracting;

                delete containerRef.current.dataset.canvasIdleSince;

                delete containerRef.current.dataset.canvasPanSession;
            }
        },

        [containerRef, streamingPanSessionRef],
    );

    useEffect(() => {
        const container = containerRef.current;

        if (!container) return;

        const recordDiagnostic = (event: Event) => {
            const kind = (event as CustomEvent<CanvasPanDiagnosticKind>).detail;

            if (kind in panMetricsRef.current) panMetricsRef.current[kind] += 1;
        };

        container.addEventListener(CANVAS_PAN_DIAGNOSTIC_EVENT, recordDiagnostic);

        return () => container.removeEventListener(CANVAS_PAN_DIAGNOSTIC_EVENT, recordDiagnostic);
    }, [containerRef]);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) return;

        const handleWebglFallback = () => {
            if (!panState.current.isPanning || !panState.current.useWebgl) return;

            panState.current.useWebgl = false;

            container.dataset.canvasPanSession = "fallback";

            writeLayerTransform(detailLayerRef.current, viewportRef.current);

            onPanFallbackViewport?.(viewportRef.current);
        };

        container.addEventListener("canvas-webgl-pan-fallback", handleWebglFallback);

        return () => container.removeEventListener("canvas-webgl-pan-fallback", handleWebglFallback);
    }, [containerRef, onPanFallbackViewport, writeLayerTransform]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") setIsControlPressed(true);

            if (event.code !== "Space") return;

            const target = event.target instanceof Element ? event.target : null;

            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']"))
                return;

            event.preventDefault();

            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                const target = event.target instanceof Element ? event.target : null;

                if (!(
                    event.target instanceof HTMLInputElement ||
                    event.target instanceof HTMLTextAreaElement ||
                    event.target instanceof HTMLSelectElement ||
                    target?.closest("[contenteditable='true']")
                ))
                    event.preventDefault();

                setIsSpacePressed(false);
            }

            if (event.key === "Control") setIsControlPressed(false);
        };

        const handleBlur = () => {
            setIsSpacePressed(false);

            setIsControlPressed(false);

            panState.current.isPanning = false;

            panState.current.pointerId = null;

            document.body.style.cursor = "";

            commitViewportInteraction();
        };

        window.addEventListener("keydown", handleKeyDown);

        window.addEventListener("keyup", handleKeyUp);

        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);

            window.removeEventListener("keyup", handleKeyUp);

            window.removeEventListener("blur", handleBlur);
        };
    }, [commitViewportInteraction]);

    const handleWheel = (event: WheelEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();

        if (!rect) return;

        if (pendingPanHandoffRef.current && !panState.current.isPanning) releasePanHandoff();

        beginViewportInteraction();

        const next = canvasWheelViewport(viewportRef.current, {
            deltaX: event.deltaX,

            deltaY: event.deltaY,

            deltaMode: event.deltaMode,

            clientX: event.clientX,

            clientY: event.clientY,

            rectLeft: rect.left,

            rectTop: rect.top,

            rectWidth: rect.width,

            rectHeight: rect.height,

            zoom: event.ctrlKey || event.metaKey,

            shiftKey: event.shiftKey,
        });

        queueViewportPreview(next);

        settleViewportInteraction();
    };

    const wheelHandlerRef = useRef(handleWheel);

    useLayoutEffect(() => {
        wheelHandlerRef.current = handleWheel;
    });

    const beginPan = (event: React.PointerEvent<HTMLDivElement>, startedOnBackground: boolean) => {
        event.preventDefault();

        event.currentTarget.setPointerCapture(event.pointerId);

        const renderMode = containerRef.current?.closest<HTMLElement>("[data-canvas-render-mode]")?.dataset.canvasRenderMode;

        const webglReady = Boolean(preferStreamingPan && renderMode && renderMode !== "overview" && streamingPanSessionRef?.current?.begin(viewportRef.current));

        const snapshotReady = Boolean(
            !preferStreamingPan &&
            renderMode &&
            renderMode !== "overview" &&
            panSurfaceRef.current?.querySelector(`[data-canvas-interaction-preview="${renderMode}"][data-canvas-snapshot-ready="true"]`),
        );

        const surfaceOffset = panSurfaceOffsetRef.current;

        panState.current = {
            isPanning: true,

            startX: event.clientX,

            startY: event.clientY,

            initialX: viewportRef.current.x,

            initialY: viewportRef.current.y,

            hasMoved: false,

            startedOnBackground,

            pointerId: event.pointerId,

            useSnapshot: snapshotReady,

            useWebgl: webglReady,

            initialSurfaceX: surfaceOffset.x,

            initialSurfaceY: surfaceOffset.y,
        };

        panStartedAtRef.current = 0;

        panMetricsRef.current = emptyPanMetrics();

        if (containerRef.current) containerRef.current.dataset.canvasPanSession = webglReady ? "webgl" : snapshotReady ? "snapshot" : "fallback";

        beginViewportInteraction();

        document.body.style.cursor = "grabbing";
    };

    const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 1) return;

        const target = event.target instanceof Element ? event.target : null;

        event.stopPropagation();

        beginPan(event, !target?.closest("[data-node-id],[data-connection-id]"));
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;

        if (target?.closest("[data-canvas-no-zoom]")) return;

        if (target?.closest("[data-connection-create-menu]")) return;

        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        const temporaryTool = event.ctrlKey || isSpacePressed;

        const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;

        const shouldPan = event.button === 0 && activeTool === "pan";

        if (shouldPan) {
            beginPan(event, isBackgroundClick);

            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();

            event.currentTarget.setPointerCapture(event.pointerId);

            onCanvasMouseDown?.(event);
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;

        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;

        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            if (panMetricsRef.current.pointerMoves === 0) panStartedAtRef.current = performance.now();

            panMetricsRef.current.pointerMoves += 1;

            const dx = event.clientX - panState.current.startX;

            const dy = event.clientY - panState.current.startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            queuePanViewport({
                x: panState.current.initialX + dx,

                y: panState.current.initialY + dy,

                k: scaleRef.current,
            });
        };

        const handlePointerUp = (event?: PointerEvent) => {
            if (!panState.current.isPanning) return;

            if (event && panState.current.pointerId !== null && event.pointerId !== panState.current.pointerId) return;

            if (!panState.current.hasMoved && panState.current.startedOnBackground) {
                onCanvasDeselect?.();
            }

            panState.current.isPanning = false;

            panState.current.pointerId = null;

            document.body.style.cursor = "";

            commitViewportInteraction();
        };

        window.addEventListener("pointermove", handlePointerMove);

        window.addEventListener("pointerup", handlePointerUp);

        window.addEventListener("pointercancel", handlePointerUp);

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);

            window.removeEventListener("pointerup", handlePointerUp);

            window.removeEventListener("pointercancel", handlePointerUp);

            document.body.style.cursor = "";
        };
    }, [commitViewportInteraction, onCanvasDeselect, queuePanViewport]);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) return;

        return bindCanvasWheelEvents(container, (event) => wheelHandlerRef.current(event));
    }, [containerRef]);

    const temporaryTool = isControlPressed || isSpacePressed;

    const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;

    const cursor = activeTool === "pan" ? "grab" : undefined;

    return (
        <div
            ref={containerRef}

            className="relative h-full w-full select-none overflow-hidden"

            style={{ background: theme.canvas.background, cursor }}

            onPointerDownCapture={handlePointerDownCapture}

            onPointerDown={handlePointerDown}

            onLostPointerCapture={() => {
                if (!panState.current.isPanning) return;

                panState.current.isPanning = false;

                panState.current.pointerId = null;

                document.body.style.cursor = "";

                commitViewportInteraction();
            }}

            onAuxClick={(event) => {
                if (event.button === 1) event.preventDefault();
            }}

            onDoubleClick={handleDoubleClick}

            onContextMenu={onContextMenu}

            onDragOver={(event) => event.preventDefault()}

            onDrop={onDrop}
        >
            {backgroundMode === "blank" ? null : (
                <div
                    ref={gridLayerRef}

                    className="pointer-events-none absolute inset-0 opacity-40"

                    style={{
                        ...canvasGridStyle(viewport, backgroundMode, theme.canvas.line, theme.canvas.dot),

                        transition: animateViewport ? "background-position 450ms cubic-bezier(0.22, 1, 0.36, 1), background-size 450ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
                    }}
                />
            )}

            <div ref={panSurfaceRef} data-canvas-pan-surface className="pointer-events-none absolute inset-0" style={{ transform: "translate3d(0px, 0px, 0)", willChange: "transform" }}>
                {streamingPanSurface}

                {viewportUnderlay}

                <div ref={panWorldLayerRef} className="absolute origin-top-left" style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`, transformOrigin: "0 0" }}>
                    {interactionSurface}
                </div>
            </div>

            <div
                ref={detailLayerRef}

                data-canvas-detail-surface

                className="absolute origin-top-left"

                style={{
                    transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`,

                    willChange: "transform",

                    pointerEvents: interactionLocked ? "none" : undefined,

                    transition: animateViewport ? "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function canvasGridStyle(viewport: ViewportTransform, mode: CanvasBackgroundMode, lineColor: string, dotColor: string): React.CSSProperties {
    const gridSize = 48 * viewport.k;

    const x = viewport.x % gridSize;

    const y = viewport.y % gridSize;

    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;

    return {
        backgroundImage:
            mode === "dots"
                ? `radial-gradient(circle, ${dotColor} ${dotSize}px, transparent ${dotSize + 0.2}px)`
                : `linear-gradient(${lineColor} 1px, transparent 1px), linear-gradient(90deg, ${lineColor} 1px, transparent 1px)`,

        backgroundSize: `${gridSize}px ${gridSize}px`,

        backgroundPosition: `${x}px ${y}px`,
    };
}
