import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { buildCanvasBaseProxyPlan, CanvasBaseProxyResidencyPool, type CanvasBaseProxyBuildError } from "@/lib/canvas/canvas-base-proxy-atlas";
import { CanvasWebglPanEngine, type CanvasWebglFrameManifest, type CanvasWebglPanSessionHandle } from "@/lib/canvas/canvas-webgl-pan-engine";
import type { CanvasGraphIndex, CanvasRenderMode, CanvasSpatialIndex } from "@/lib/canvas/canvas-performance";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { reportCanvasPanDiagnostic } from "./canvas-pan-diagnostics";
import { CanvasWebglMediaBridge, type CanvasWebglMediaBridgeItem } from "./canvas-webgl-media-bridge";

type Props = {
    enabled: boolean;
    nodes: CanvasNodeData[];
    spatialIndex: CanvasSpatialIndex;
    graphIndex: CanvasGraphIndex;
    posterByNodeId: ReadonlyMap<string, string>;
    selectedNodeIds: ReadonlySet<string>;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    renderMode: Exclude<CanvasRenderMode, "overview">;
};

type StreamStatus = "disabled" | "stream-ready" | "fallback";

export const CanvasWebglInteractionLayer = memo(
    forwardRef<CanvasWebglPanSessionHandle, Props>(function CanvasWebglInteractionLayer(props, ref) {
        const surfaceRef = useRef<HTMLDivElement>(null);
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const bridgeRootRef = useRef<HTMLDivElement>(null);
        const engineRef = useRef<CanvasWebglPanEngine | null>(null);
        const residencyRef = useRef<CanvasBaseProxyResidencyPool | null>(null);
        const bridgeRef = useRef<CanvasWebglMediaBridge | null>(null);
        const glRef = useRef<WebGL2RenderingContext | null>(null);
        const statusRef = useRef<StreamStatus>("disabled");
        const activeRef = useRef(false);
        const pendingPlanRef = useRef(false);
        const pendingEngineRef = useRef(false);
        const residencyDrawFrameRef = useRef<number | null>(null);
        const lastBridgeRevisionRef = useRef("");
        const plannedNodesRef = useRef<CanvasNodeData[] | null>(null);
        const plannedPostersRef = useRef<ReadonlyMap<string, string> | null>(null);
        const skipNextSelectionEffectRef = useRef(false);
        const skipNextStructuralEffectRef = useRef(false);
        const theme = canvasThemes[useThemeStore((state) => state.theme)];
        const latestRef = useRef({ ...props, theme });
        const installEngineRef = useRef<() => void>(() => undefined);
        const replacePlanRef = useRef<() => void>(() => undefined);
        const scheduleResidencyDrawRef = useRef<() => void>(() => undefined);
        latestRef.current = { ...props, theme };

        const exposeDiagnostics = () => {
            const canvas = canvasRef.current;
            const engine = engineRef.current?.diagnostics();
            const residency = residencyRef.current?.diagnostics();
            const bridge = bridgeRef.current?.diagnostics();
            if (!canvas || !engine || !residency || !bridge) return;
            canvas.dataset.canvasWebglDraws = String(engine.draws);
            canvas.dataset.canvasWebglSpatialQueries = String(engine.spatialQueries);
            canvas.dataset.canvasWebglRelationBufferBuilds = String(engine.relationBufferBuilds);
            canvas.dataset.canvasWebglActiveNodeIds = JSON.stringify(engine.activeNodeIds);
            canvas.dataset.canvasWebglDrawnBaseProxyNodeIds = JSON.stringify(engine.drawnBaseProxyNodeIds);
            canvas.dataset.canvasWebglBaseProxyMiss = String(engine.baseProxyMiss);
            canvas.dataset.canvasWebglAtlasPages = String(residency.pageCount);
            canvas.dataset.canvasWebglAtlasBytes = String(residency.gpuBytes);
            canvas.dataset.canvasWebglResidentSlots = String(residency.resident);
            canvas.dataset.canvasWebglPinnedSlots = String(residency.pinned);
            canvas.dataset.canvasWebglRequestedSlots = String(residency.requested);
            canvas.dataset.canvasWebglAtlasEvictions = String(residency.evictions);
            canvas.dataset.canvasWebglBridgeNodeIds = JSON.stringify(bridge.nodeIds);
            canvas.dataset.canvasWebglBridgeCount = String(bridge.nodeIds.length);
            canvas.dataset.canvasWebglBridgeCameraWrites = String(bridge.cameraWrites);
            canvas.dataset.canvasWebglBridgeSyncs = String(bridge.syncs);
            canvas.dataset.canvasWebglBridgeMediaLoads = String(bridge.mediaLoads);
        };

        const enterFallback = (reason: string) => {
            statusRef.current = "fallback";
            activeRef.current = false;
            residencyRef.current?.setPanActive(false);
            const canvas = canvasRef.current;
            const surface = surfaceRef.current;
            if (surface) surface.style.visibility = "hidden";
            if (!canvas) return;
            canvas.dataset.canvasWebglStatus = "fallback";
            canvas.dataset.canvasWebglFallbackReason = reason;
            canvas.dispatchEvent(new CustomEvent("canvas-webgl-pan-fallback", { bubbles: true, detail: reason }));
        };

        const resizeBackingStore = () => {
            const canvas = canvasRef.current;
            if (!canvas || activeRef.current) {
                pendingEngineRef.current = true;
                return;
            }
            const { viewportSize } = latestRef.current;
            const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
            const width = Math.max(1, Math.round(viewportSize.width * dpr));
            const height = Math.max(1, Math.round(viewportSize.height * dpr));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            canvas.style.width = `${viewportSize.width}px`;
            canvas.style.height = `${viewportSize.height}px`;
            canvas.dataset.canvasWebglBackingDpr = dpr.toFixed(3);
        };

        const bridgeItem = (node: CanvasNodeData): CanvasWebglMediaBridgeItem | null => {
            const source = residencyRef.current?.sourceForNodeId(node.id);
            if (!source) return null;
            return {
                nodeId: node.id,
                kind: source.kind === "video-frame" ? "video" : "image",
                source: source.source,
                fallbackSource: source.kind === "video-poster" ? node.metadata?.content || undefined : undefined,
                x: node.position.x,
                y: node.position.y,
                width: node.width,
                height: node.height,
                selected: latestRef.current.selectedNodeIds.has(node.id),
            };
        };

        const syncFrame = (frame: CanvasWebglFrameManifest) => {
            const canvas = canvasRef.current;
            const bridge = bridgeRef.current;
            if (!canvas || !bridge) return;
            bridge.updateCamera(frame.viewport);
            const frameRevision = `${frame.queryRevision}:${frame.residencyRevision}`;
            if (lastBridgeRevisionRef.current === frameRevision) return;
            lastBridgeRevisionRef.current = frameRevision;
            const residentIds = new Set(frame.drawnResidentMediaNodeIds);
            const bridgeItems = frame.activeNodes.flatMap((node) => {
                if (residentIds.has(node.id)) return [];
                const item = bridgeItem(node);
                return item ? [item] : [];
            });
            bridge.sync(bridgeItems);
            const expected = new Set(frame.expectedVisibleValidMediaNodeIds);
            const bridged = new Set(bridge.nodeIds());
            const union = new Set([...residentIds, ...bridged]);
            const complete = expected.size === union.size && [...expected].every((nodeId) => union.has(nodeId));
            canvas.dataset.canvasWebglExpectedVisibleMediaIds = JSON.stringify([...expected]);
            canvas.dataset.canvasWebglDrawnResidentMediaIds = JSON.stringify([...residentIds]);
            canvas.dataset.canvasWebglDrawnBridgeMediaIds = JSON.stringify([...bridged]);
            canvas.dataset.canvasWebglVisibleMediaCoverage = complete ? "complete" : "incomplete";
            if (!complete) {
                enterFallback("visible-media-coverage-incomplete");
                return;
            }
            exposeDiagnostics();
        };

        scheduleResidencyDrawRef.current = () => {
            if (activeRef.current || residencyDrawFrameRef.current !== null || statusRef.current !== "stream-ready") return;
            residencyDrawFrameRef.current = requestAnimationFrame(() => {
                residencyDrawFrameRef.current = null;
                const engine = engineRef.current;
                if (!engine) return;
                const frame = engine.draw(latestRef.current.viewport);
                if (!frame) enterFallback("context-lost");
                else syncFrame(frame);
            });
        };

        installEngineRef.current = () => {
            const canvas = canvasRef.current;
            const gl = glRef.current;
            const residency = residencyRef.current;
            if (!canvas || !gl || !residency || gl.isContextLost() || statusRef.current === "fallback") return;
            if (activeRef.current) {
                pendingEngineRef.current = true;
                canvas.dataset.canvasWebglPendingGeneration = "true";
                return;
            }
            resizeBackingStore();
            const { spatialIndex, graphIndex, selectedNodeIds, viewportSize, renderMode, viewport, theme: latestTheme } = latestRef.current;
            engineRef.current?.dispose();
            engineRef.current = new CanvasWebglPanEngine({
                canvas,
                gl,
                residency,
                spatialIndex,
                graphIndex,
                selectedNodeIds,
                viewportSize,
                renderMode,
                colors: { text: latestTheme.node.text, muted: latestTheme.node.muted, active: latestTheme.node.activeStroke, background: latestTheme.canvas.background },
                onSpatialQuery: () => reportCanvasPanDiagnostic(canvas, "spatialQuery"),
                onDraw: () => reportCanvasPanDiagnostic(canvas, "webglDraw"),
                onRelationBufferBuild: () => reportCanvasPanDiagnostic(canvas, "relationBufferBuild"),
            });
            const frame = engineRef.current.draw(viewport);
            if (!frame) {
                enterFallback("context-lost");
                return;
            }
            statusRef.current = "stream-ready";
            canvas.dataset.canvasWebglStatus = "stream-ready";
            canvas.dataset.canvasWebglStreamReady = "true";
            pendingEngineRef.current = false;
            delete canvas.dataset.canvasWebglPendingGeneration;
            reportCanvasPanDiagnostic(canvas, "generationSwap");
            syncFrame(frame);
        };

        replacePlanRef.current = () => {
            const canvas = canvasRef.current;
            const residency = residencyRef.current;
            if (!canvas || !residency || statusRef.current === "fallback") return;
            if (activeRef.current) {
                pendingPlanRef.current = true;
                canvas.dataset.canvasWebglPendingGeneration = "true";
                return;
            }
            const plan = buildCanvasBaseProxyPlan(latestRef.current.nodes, latestRef.current.posterByNodeId);
            residency.replacePlan(plan);
            plannedNodesRef.current = latestRef.current.nodes;
            plannedPostersRef.current = latestRef.current.posterByNodeId;
            pendingPlanRef.current = false;
            canvas.dataset.canvasWebglBaseProxyTarget = String(plan.sources.length);
            canvas.dataset.canvasWebglMissingImageCards = String(plan.missingImageNodeIds.size);
            canvas.dataset.canvasWebglUnsupportedNodes = String(plan.unsupportedNodeIds.size);
            installEngineRef.current();
        };

        const applyPending = () => {
            if (pendingPlanRef.current) replacePlanRef.current();
            else if (pendingEngineRef.current) installEngineRef.current();
        };

        useImperativeHandle(
            ref,
            () => ({
                begin(nextViewport) {
                    const canvas = canvasRef.current;
                    const engine = engineRef.current;
                    const residency = residencyRef.current;
                    const surface = surfaceRef.current;
                    if (!latestRef.current.enabled || statusRef.current !== "stream-ready" || !canvas || !engine || !residency || !surface) return false;
                    if (glRef.current?.isContextLost()) {
                        enterFallback("context-lost");
                        return false;
                    }
                    activeRef.current = true;
                    residency.setPanActive(true);
                    bridgeRef.current?.updateCamera(nextViewport);
                    surface.style.visibility = "visible";
                    canvas.dataset.canvasWebglSession = "active";
                    return true;
                },
                draw(nextViewport) {
                    const engine = engineRef.current;
                    if (!activeRef.current || statusRef.current !== "stream-ready" || !engine) return false;
                    const frame = engine.draw(nextViewport);
                    if (!frame) {
                        enterFallback("context-lost");
                        return false;
                    }
                    syncFrame(frame);
                    return true;
                },
                end() {
                    activeRef.current = false;
                    residencyRef.current?.setPanActive(false);
                    exposeDiagnostics();
                    if (canvasRef.current) canvasRef.current.dataset.canvasWebglSession = "handoff";
                },
                release() {
                    activeRef.current = false;
                    residencyRef.current?.setPanActive(false);
                    exposeDiagnostics();
                    const canvas = canvasRef.current;
                    const surface = surfaceRef.current;
                    if (surface) surface.style.visibility = "hidden";
                    if (canvas) delete canvas.dataset.canvasWebglSession;
                    queueMicrotask(applyPending);
                },
                diagnostics() {
                    return (
                        engineRef.current?.diagnostics() || {
                            draws: 0,
                            spatialQueries: 0,
                            relationBufferBuilds: 0,
                            activeNodeIds: [],
                            drawnBaseProxyNodeIds: [],
                            expectedVisibleValidMediaNodeIds: [],
                            baseProxyMiss: 0,
                            residencyRevision: 0,
                            queryRevision: 0,
                        }
                    );
                },
            }),
            [],
        );

        useEffect(() => {
            const canvas = canvasRef.current;
            const bridgeRoot = bridgeRootRef.current;
            if (!canvas || !bridgeRoot || !props.enabled) {
                statusRef.current = "disabled";
                return;
            }
            resizeBackingStore();
            const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
            if (!gl) {
                enterFallback("webgl2-unavailable");
                return;
            }
            glRef.current = gl;
            bridgeRef.current = new CanvasWebglMediaBridge(bridgeRoot, () => reportCanvasPanDiagnostic(canvas, "mediaLoad"));
            try {
                residencyRef.current = new CanvasBaseProxyResidencyPool(
                    gl,
                    () => scheduleResidencyDrawRef.current(),
                    () => reportCanvasPanDiagnostic(canvas, "proxyDecode"),
                );
            } catch (error: unknown) {
                enterFallback((error as CanvasBaseProxyBuildError)?.reason || "residency-pool-failed");
                return;
            }
            statusRef.current = "stream-ready";
            skipNextSelectionEffectRef.current = true;
            skipNextStructuralEffectRef.current = true;
            const onContextLost = (event: Event) => {
                event.preventDefault();
                enterFallback("context-lost");
            };
            canvas.addEventListener("webglcontextlost", onContextLost);
            replacePlanRef.current();
            return () => {
                if (residencyDrawFrameRef.current !== null) cancelAnimationFrame(residencyDrawFrameRef.current);
                residencyDrawFrameRef.current = null;
                canvas.removeEventListener("webglcontextlost", onContextLost);
                engineRef.current?.dispose();
                engineRef.current = null;
                residencyRef.current?.dispose();
                residencyRef.current = null;
                bridgeRef.current?.dispose();
                bridgeRef.current = null;
                glRef.current = null;
                statusRef.current = "disabled";
            };
        }, [props.enabled]);

        useEffect(() => {
            if (!props.enabled || !residencyRef.current) return;
            if (plannedNodesRef.current === props.nodes && plannedPostersRef.current === props.posterByNodeId) return;
            replacePlanRef.current();
        }, [props.enabled, props.nodes, props.posterByNodeId]);

        useEffect(() => {
            const engine = engineRef.current;
            if (!props.enabled || !engine || statusRef.current !== "stream-ready") return;
            if (skipNextSelectionEffectRef.current) {
                skipNextSelectionEffectRef.current = false;
                return;
            }
            if (activeRef.current) {
                pendingEngineRef.current = true;
                return;
            }
            engine.updateSelection(props.selectedNodeIds);
            const frame = engine.draw(props.viewport);
            if (frame) syncFrame(frame);
        }, [props.enabled, props.selectedNodeIds, props.viewport]);

        useEffect(() => {
            if (!props.enabled || !residencyRef.current || statusRef.current !== "stream-ready") return;
            if (skipNextStructuralEffectRef.current) {
                skipNextStructuralEffectRef.current = false;
                return;
            }
            installEngineRef.current();
        }, [props.enabled, props.graphIndex, props.renderMode, props.spatialIndex, props.viewportSize.height, props.viewportSize.width, theme.canvas.background, theme.node.activeStroke, theme.node.muted, theme.node.text]);

        return (
            <div ref={surfaceRef} data-canvas-webgl-stream-layer aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ visibility: "hidden" }}>
                <canvas ref={canvasRef} data-canvas-webgl-pan-layer className="absolute left-0 top-0" />
                <div ref={bridgeRootRef} data-canvas-webgl-media-bridge className="absolute left-0 top-0 origin-top-left" />
            </div>
        );
    }),
);
