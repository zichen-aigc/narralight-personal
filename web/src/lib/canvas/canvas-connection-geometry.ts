import type { CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

export type CanvasConnectionCurve = {
    start: Position;
    control1: Position;
    control2: Position;
    end: Position;
};

export type CanvasConnectionCurveBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export function canvasConnectionCurve(from: CanvasNodeData, to: CanvasNodeData): CanvasConnectionCurve {
    const start = { x: from.position.x + from.width, y: from.position.y + from.height / 2 };
    const end = { x: to.position.x, y: to.position.y + to.height / 2 };
    const curvature = Math.max(Math.abs(end.x - start.x) * 0.5, 50);
    return {
        start,
        control1: { x: start.x + curvature, y: start.y },
        control2: { x: end.x - curvature, y: end.y },
        end,
    };
}

export function canvasConnectionPathData(curve: CanvasConnectionCurve) {
    return `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`;
}

export function canvasConnectionScreenCurve(from: CanvasNodeData, to: CanvasNodeData, viewport: ViewportTransform): CanvasConnectionCurve {
    const curve = canvasConnectionCurve(from, to);
    const toScreen = (position: Position) => ({ x: position.x * viewport.k + viewport.x, y: position.y * viewport.k + viewport.y });
    return {
        start: toScreen(curve.start),
        control1: toScreen(curve.control1),
        control2: toScreen(curve.control2),
        end: toScreen(curve.end),
    };
}

export function canvasConnectionCurveIntersectsViewport(curve: CanvasConnectionCurve, viewportSize: { width: number; height: number }, margin = 48) {
    const { left, top, right, bottom } = canvasConnectionCurveBounds(curve);
    return right >= -margin && bottom >= -margin && left <= viewportSize.width + margin && top <= viewportSize.height + margin;
}

export function canvasConnectionCurveBounds(curve: CanvasConnectionCurve): CanvasConnectionCurveBounds {
    return {
        left: Math.min(curve.start.x, curve.control1.x, curve.control2.x, curve.end.x),
        top: Math.min(curve.start.y, curve.control1.y, curve.control2.y, curve.end.y),
        right: Math.max(curve.start.x, curve.control1.x, curve.control2.x, curve.end.x),
        bottom: Math.max(curve.start.y, curve.control1.y, curve.control2.y, curve.end.y),
    };
}

export function canvasConnectionCurveBoundsIntersectsViewport(bounds: CanvasConnectionCurveBounds, viewport: ViewportTransform, viewportSize: { width: number; height: number }, margin = 48) {
    const scale = Math.max(viewport.k, 0.05);
    const left = (-viewport.x - margin) / scale;
    const top = (-viewport.y - margin) / scale;
    const right = (viewportSize.width - viewport.x + margin) / scale;
    const bottom = (viewportSize.height - viewport.y + margin) / scale;
    return bounds.right >= left && bounds.bottom >= top && bounds.left <= right && bounds.top <= bottom;
}

export function canvasAmbientBitmapTransform(base: ViewportTransform, next: ViewportTransform, overscan: number) {
    const scale = next.k / Math.max(base.k, 0.05);
    return {
        x: next.x - scale * base.x - overscan * (scale - 1),
        y: next.y - scale * base.y - overscan * (scale - 1),
        scale,
    };
}

export function canvasAmbientBitmapCanTransform(base: ViewportTransform, next: ViewportTransform, viewportSize: { width: number; height: number }, overscan: number) {
    const transform = canvasAmbientBitmapTransform(base, next, overscan);
    const translationGuard = Math.max(32, overscan * 0.55);
    const scaleGuard = Math.min(0.08, (overscan / Math.max(viewportSize.width, viewportSize.height, 1)) * 0.5);
    return Math.abs(transform.x) <= translationGuard && Math.abs(transform.y) <= translationGuard && Math.abs(transform.scale - 1) <= scaleGuard;
}
