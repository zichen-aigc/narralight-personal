export const CANVAS_PAN_DIAGNOSTIC_EVENT = "canvas-pan-diagnostic";

export type CanvasPanDiagnosticKind =
    | "previewBuild"
    | "canvasDraw"
    | "canvasResize"
    | "offscreenCanvas"
    | "mediaLoad"
    | "visibleScan"
    | "relationshipScan"
    | "webglDraw"
    | "spatialQuery"
    | "relationBufferBuild"
    | "atlasBuild"
    | "proxyDecode"
    | "generationSwap";

export function reportCanvasPanDiagnostic(element: Element | null | undefined, kind: CanvasPanDiagnosticKind) {
    const container = element?.closest<HTMLElement>("[data-canvas-pan-session]");
    if (!container || typeof CustomEvent === "undefined") return;
    container.dispatchEvent(new CustomEvent<CanvasPanDiagnosticKind>(CANVAS_PAN_DIAGNOSTIC_EVENT, { detail: kind }));
}
