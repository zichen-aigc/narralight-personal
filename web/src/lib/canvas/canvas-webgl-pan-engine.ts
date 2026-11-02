import { canvasConnectionCurve } from "@/lib/canvas/canvas-connection-geometry";
import {
    CANVAS_AMBIENT_CONNECTION_LIMIT,
    CANVAS_FOCUS_CONNECTION_LIMIT,
    canvasViewportPadding,
    queryCanvasSpatialIndex,
    type CanvasGraphIndex,
    type CanvasRenderMode,
    type CanvasSpatialIndex,
} from "@/lib/canvas/canvas-performance";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasBaseProxyResidencyPool, CanvasBaseProxyResidencyRequest, CanvasBaseProxySlot } from "./canvas-base-proxy-atlas";

export type CanvasWebglPanDiagnostics = {
    draws: number;
    spatialQueries: number;
    relationBufferBuilds: number;
    activeNodeIds: string[];
    drawnBaseProxyNodeIds: string[];
    expectedVisibleValidMediaNodeIds: string[];
    baseProxyMiss: number;
    residencyRevision: number;
    queryRevision: number;
};

export type CanvasWebglFrameManifest = {
    viewport: ViewportTransform;
    activeNodes: CanvasNodeData[];
    expectedVisibleValidMediaNodeIds: string[];
    drawnResidentMediaNodeIds: string[];
    queryRevision: number;
    residencyRevision: number;
};

export type CanvasWebglPanSessionHandle = {
    begin: (viewport: ViewportTransform) => boolean;
    draw: (viewport: ViewportTransform) => boolean;
    end: () => void;
    release: () => void;
    diagnostics: () => CanvasWebglPanDiagnostics;
};

export type CanvasWebglQueryEnvelope = { left: number; top: number; right: number; bottom: number };

type EngineInput = {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    residency: CanvasBaseProxyResidencyPool;
    spatialIndex: CanvasSpatialIndex;
    graphIndex: CanvasGraphIndex;
    selectedNodeIds: ReadonlySet<string>;
    viewportSize: { width: number; height: number };
    renderMode: Exclude<CanvasRenderMode, "overview">;
    colors: { text: string; muted: string; active: string; background: string };
    onSpatialQuery?: () => void;
    onDraw?: () => void;
    onRelationBufferBuild?: () => void;
};

type BufferSet = { buffer: WebGLBuffer; count: number };
type TextureBufferSet = BufferSet & { texture: WebGLTexture };

export class CanvasWebglPanEngine {
    private readonly canvas: HTMLCanvasElement;
    private readonly gl: WebGL2RenderingContext;
    private readonly residency: CanvasBaseProxyResidencyPool;
    private readonly spatialIndex: CanvasSpatialIndex;
    private readonly graphIndex: CanvasGraphIndex;
    private selectedNodeIds: ReadonlySet<string>;
    private readonly viewportSize: { width: number; height: number };
    private readonly renderMode: Exclude<CanvasRenderMode, "overview">;
    private readonly colors: EngineInput["colors"];
    private readonly onSpatialQuery?: () => void;
    private readonly onDraw?: () => void;
    private readonly onRelationBufferBuild?: () => void;
    private readonly solidProgram: WebGLProgram;
    private readonly textureProgram: WebGLProgram;
    private readonly solidCamera: WebGLUniformLocation;
    private readonly solidViewport: WebGLUniformLocation;
    private readonly textureCamera: WebGLUniformLocation;
    private readonly textureViewport: WebGLUniformLocation;
    private solidBuffer: BufferSet | null = null;
    private overlayBuffer: BufferSet | null = null;
    private relationBuffer: BufferSet | null = null;
    private textureBuffers: TextureBufferSet[] = [];
    private envelope: CanvasWebglQueryEnvelope | null = null;
    private activeNodes: CanvasNodeData[] = [];
    private activeNodeIds: string[] = [];
    private drawnBaseProxyNodeIds: string[] = [];
    private baseProxyMiss = 0;
    private residencyRevision = -1;
    private queryRevision = 0;
    private lastQueryViewport: ViewportTransform | null = null;
    private lastQueryAt = 0;
    private draws = 0;
    private spatialQueries = 0;
    private relationBufferBuilds = 0;
    private disposed = false;

    constructor(input: EngineInput) {
        this.canvas = input.canvas;
        this.gl = input.gl;
        this.residency = input.residency;
        this.spatialIndex = input.spatialIndex;
        this.graphIndex = input.graphIndex;
        this.selectedNodeIds = input.selectedNodeIds;
        this.viewportSize = input.viewportSize;
        this.renderMode = input.renderMode;
        this.colors = input.colors;
        this.onSpatialQuery = input.onSpatialQuery;
        this.onDraw = input.onDraw;
        this.onRelationBufferBuild = input.onRelationBufferBuild;
        this.solidProgram = createProgram(this.gl, SOLID_VERTEX_SHADER, SOLID_FRAGMENT_SHADER);
        this.textureProgram = createProgram(this.gl, TEXTURE_VERTEX_SHADER, TEXTURE_FRAGMENT_SHADER);
        this.solidCamera = requiredUniform(this.gl, this.solidProgram, "uCamera");
        this.solidViewport = requiredUniform(this.gl, this.solidProgram, "uViewport");
        this.textureCamera = requiredUniform(this.gl, this.textureProgram, "uCamera");
        this.textureViewport = requiredUniform(this.gl, this.textureProgram, "uViewport");
        this.gl.disable(this.gl.DEPTH_TEST);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    }

    draw(viewport: ViewportTransform): CanvasWebglFrameManifest | null {
        if (this.disposed || this.gl.isContextLost()) return null;
        if (canvasWebglPanNeedsQuery(this.envelope, viewport, this.viewportSize)) this.rebuildActiveBuffers(viewport);
        if (this.residencyRevision !== this.residency.revision) this.rebuildNodeBuffers();
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        const background = parseCssColor(this.colors.background, [0.02, 0.025, 0.02, 1]);
        this.gl.clearColor(background[0], background[1], background[2], background[3]);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.drawSolid(viewport, this.relationBuffer);
        this.drawSolid(viewport, this.solidBuffer);
        this.drawTextures(viewport);
        this.drawSolid(viewport, this.overlayBuffer);
        this.draws += 1;
        this.onDraw?.();
        return this.frameManifest(viewport);
    }

    diagnostics(): CanvasWebglPanDiagnostics {
        return {
            draws: this.draws,
            spatialQueries: this.spatialQueries,
            relationBufferBuilds: this.relationBufferBuilds,
            activeNodeIds: [...this.activeNodeIds],
            drawnBaseProxyNodeIds: [...this.drawnBaseProxyNodeIds],
            expectedVisibleValidMediaNodeIds: this.activeNodes.filter((node) => this.residency.sourceForNodeId(node.id)).map((node) => node.id),
            baseProxyMiss: this.baseProxyMiss,
            residencyRevision: this.residencyRevision,
            queryRevision: this.queryRevision,
        };
    }

    updateSelection(selectedNodeIds: ReadonlySet<string>) {
        this.selectedNodeIds = selectedNodeIds;
        this.envelope = null;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.deleteBuffer(this.solidBuffer);
        this.deleteBuffer(this.overlayBuffer);
        this.deleteBuffer(this.relationBuffer);
        this.textureBuffers.forEach((entry) => this.gl.deleteBuffer(entry.buffer));
        this.textureBuffers = [];
        this.gl.deleteProgram(this.solidProgram);
        this.gl.deleteProgram(this.textureProgram);
    }

    private rebuildActiveBuffers(viewport: ViewportTransform) {
        const padding = canvasWebglPanGuardPadding(viewport, this.viewportSize, this.renderMode);
        const predictedViewport = canvasWebglPredictedViewport(this.lastQueryViewport, viewport, this.viewportSize, this.lastQueryAt, performance.now());
        const predictionPadding = padding + (Math.max(this.viewportSize.width, this.viewportSize.height) * 2) / Math.max(viewport.k, 0.05);
        const candidates = queryCanvasSpatialIndex(this.spatialIndex, viewport, this.viewportSize, predictionPadding);
        const residencyPlan = canvasWebglResidencyPlan(candidates, viewport, predictedViewport, this.viewportSize, padding);
        this.activeNodes = residencyPlan.activeNodes;
        this.envelope = canvasWebglPanEnvelope(viewport, this.viewportSize, padding);
        this.activeNodeIds = this.activeNodes.map((node) => node.id);
        this.residency.updateDemand(residencyPlan.requests, residencyPlan.pinnedNodeIds);
        this.lastQueryViewport = { ...viewport };
        this.lastQueryAt = performance.now();
        this.queryRevision += 1;
        this.spatialQueries += 1;
        this.onSpatialQuery?.();
        this.rebuildNodeBuffers();
        this.rebuildRelationBuffer(viewport.k);
    }

    private rebuildNodeBuffers() {
        const solid: number[] = [];
        const overlay: number[] = [];
        const byPage = new Map<number, number[]>();
        const drawnBaseProxyNodeIds: string[] = [];
        let baseProxyMiss = 0;
        const ordered = [...this.activeNodes].sort((left, right) => Number(left.type !== CanvasNodeType.Group) - Number(right.type !== CanvasNodeType.Group));
        for (const node of ordered) {
            const selected = this.selectedNodeIds.has(node.id);
            const mediaSource = this.residency.sourceForNodeId(node.id);
            const mediaSlot = this.residency.slotForNodeId(node.id);
            const isMedia = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video;
            const isValidMedia = isMedia && Boolean(mediaSource);
            const isMissing = node.type === CanvasNodeType.Image && this.residency.missingImageNodeIds.has(node.id);
            const color = isMissing ? [0.7, 0.18, 0.16, 0.82] : selected ? parseCssColor(this.colors.active, [0.92, 0.72, 0.22, 0.88]) : semanticNodeColor(node.type);
            if (!isValidMedia || mediaSlot) appendRect(solid, node.position.x, node.position.y, node.width, node.height, color);
            if (node.type === CanvasNodeType.Group) appendRectOutline(overlay, node.position.x, node.position.y, node.width, node.height, selected ? 4 : 2, color);
            if (isMissing) appendMissingMark(overlay, node, [1, 0.82, 0.72, 0.95]);
            if (mediaSlot) {
                const page = byPage.get(mediaSlot.page) || [];
                appendTextureRect(page, node, mediaSlot);
                byPage.set(mediaSlot.page, page);
                drawnBaseProxyNodeIds.push(node.id);
            } else if (isValidMedia) {
                baseProxyMiss += 1;
            }
            appendNodeTypeMark(overlay, node, selected ? parseCssColor(this.colors.active, [0.92, 0.72, 0.22, 0.96]) : [0.94, 0.94, 0.88, 0.9]);
            if (selected && node.type !== CanvasNodeType.Group) appendRectOutline(overlay, node.position.x, node.position.y, node.width, node.height, 4, parseCssColor(this.colors.active, [0.92, 0.72, 0.22, 0.96]));
        }
        this.drawnBaseProxyNodeIds = drawnBaseProxyNodeIds;
        this.baseProxyMiss = baseProxyMiss;
        this.residencyRevision = this.residency.revision;
        this.deleteBuffer(this.solidBuffer);
        this.deleteBuffer(this.overlayBuffer);
        this.solidBuffer = createBuffer(this.gl, solid, 6);
        this.overlayBuffer = createBuffer(this.gl, overlay, 6);
        this.textureBuffers.forEach((entry) => this.gl.deleteBuffer(entry.buffer));
        this.textureBuffers = [...byPage.entries()].flatMap(([page, values]) => {
            const entry = createBuffer(this.gl, values, 4);
            return entry ? [{ ...entry, texture: this.residency.textures[page] }] : [];
        });
    }

    private frameManifest(viewport: ViewportTransform): CanvasWebglFrameManifest {
        return {
            viewport,
            activeNodes: this.activeNodes,
            expectedVisibleValidMediaNodeIds: this.activeNodes.filter((node) => this.residency.sourceForNodeId(node.id)).map((node) => node.id),
            drawnResidentMediaNodeIds: [...this.drawnBaseProxyNodeIds],
            queryRevision: this.queryRevision,
            residencyRevision: this.residencyRevision,
        };
    }

    private rebuildRelationBuffer(scale: number) {
        const values: number[] = [];
        const { ambient, focused } = canvasWebglRelationCandidates(this.activeNodes, this.graphIndex, this.selectedNodeIds);
        const muted = parseCssColor(this.colors.muted, [0.7, 0.72, 0.68, 0.2]);
        const active = parseCssColor(this.colors.active, [0.95, 0.74, 0.24, 0.92]);
        ambient.forEach((connection) => appendConnection(values, this.graphIndex, connection, 0.9 / Math.max(scale, 0.05), [muted[0], muted[1], muted[2], 0.22], false));
        focused.forEach((connection) => appendConnection(values, this.graphIndex, connection, 3 / Math.max(scale, 0.05), active, true));
        this.deleteBuffer(this.relationBuffer);
        this.relationBuffer = createBuffer(this.gl, values, 6);
        this.relationBufferBuilds += 1;
        this.onRelationBufferBuild?.();
    }

    private drawSolid(viewport: ViewportTransform, entry: BufferSet | null) {
        if (!entry?.count) return;
        const gl = this.gl;
        gl.useProgram(this.solidProgram);
        gl.uniform3f(this.solidCamera, viewport.x, viewport.y, viewport.k);
        gl.uniform2f(this.solidViewport, this.viewportSize.width, this.viewportSize.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
        const position = gl.getAttribLocation(this.solidProgram, "aPosition");
        const color = gl.getAttribLocation(this.solidProgram, "aColor");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 24, 8);
        gl.drawArrays(gl.TRIANGLES, 0, entry.count);
    }

    private drawTextures(viewport: ViewportTransform) {
        const gl = this.gl;
        gl.useProgram(this.textureProgram);
        gl.uniform3f(this.textureCamera, viewport.x, viewport.y, viewport.k);
        gl.uniform2f(this.textureViewport, this.viewportSize.width, this.viewportSize.height);
        const sampler = requiredUniform(gl, this.textureProgram, "uTexture");
        const position = gl.getAttribLocation(this.textureProgram, "aPosition");
        const uv = gl.getAttribLocation(this.textureProgram, "aUv");
        for (const entry of this.textureBuffers) {
            gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(uv);
            gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.uniform1i(sampler, 0);
            gl.drawArrays(gl.TRIANGLES, 0, entry.count);
        }
    }

    private deleteBuffer(entry: BufferSet | null) {
        if (entry) this.gl.deleteBuffer(entry.buffer);
    }
}

export function canvasWebglPanGuardPadding(viewport: ViewportTransform, viewportSize: { width: number; height: number }, mode: Exclude<CanvasRenderMode, "overview">) {
    const viewportWorldSpan = Math.max(viewportSize.width, viewportSize.height) / Math.max(viewport.k, 0.05);
    return Math.max(canvasViewportPadding(mode, viewport.k, viewportSize), viewportWorldSpan * 0.8);
}

export function canvasWebglPanEnvelope(viewport: ViewportTransform, viewportSize: { width: number; height: number }, padding: number): CanvasWebglQueryEnvelope {
    const scale = Math.max(viewport.k, 0.05);
    return {
        left: -viewport.x / scale - padding,
        top: -viewport.y / scale - padding,
        right: (viewportSize.width - viewport.x) / scale + padding,
        bottom: (viewportSize.height - viewport.y) / scale + padding,
    };
}

export function canvasWebglPanNeedsQuery(envelope: CanvasWebglQueryEnvelope | null, viewport: ViewportTransform, viewportSize: { width: number; height: number }) {
    if (!envelope) return true;
    const visible = canvasWebglPanEnvelope(viewport, viewportSize, 0);
    return visible.left < envelope.left || visible.top < envelope.top || visible.right > envelope.right || visible.bottom > envelope.bottom;
}

export function canvasWebglPredictedViewport(
    previous: ViewportTransform | null,
    current: ViewportTransform,
    viewportSize: { width: number; height: number },
    previousAt: number,
    now: number,
): ViewportTransform {
    if (!previous || previousAt <= 0) return current;
    const elapsed = Math.max(now - previousAt, 1);
    const projection = Math.min(500 / elapsed, 2);
    const maxX = viewportSize.width * 2;
    const maxY = viewportSize.height * 2;
    return {
        x: current.x + Math.max(-maxX, Math.min(maxX, (current.x - previous.x) * projection)),
        y: current.y + Math.max(-maxY, Math.min(maxY, (current.y - previous.y) * projection)),
        k: current.k,
    };
}

export function canvasWebglResidencyPlan(
    candidates: CanvasNodeData[],
    viewport: ViewportTransform,
    predictedViewport: ViewportTransform,
    viewportSize: { width: number; height: number },
    guardPadding: number,
): { activeNodes: CanvasNodeData[]; requests: CanvasBaseProxyResidencyRequest[]; pinnedNodeIds: string[] } {
    const visible = canvasWebglPanEnvelope(viewport, viewportSize, 0);
    const guard = canvasWebglPanEnvelope(viewport, viewportSize, guardPadding);
    const predicted = canvasWebglPanEnvelope(predictedViewport, viewportSize, guardPadding);
    const activeNodes: CanvasNodeData[] = [];
    const requests: CanvasBaseProxyResidencyRequest[] = [];
    const pinnedNodeIds: string[] = [];
    for (const node of candidates) {
        if (canvasNodeIntersectsEnvelope(node, guard)) activeNodes.push(node);
        const priority: 0 | 1 | 2 | null = canvasNodeIntersectsEnvelope(node, visible) ? 0 : canvasNodeIntersectsEnvelope(node, guard) ? 1 : canvasNodeIntersectsEnvelope(node, predicted) ? 2 : null;
        if (priority === null) continue;
        requests.push({ nodeId: node.id, priority });
        if (priority <= 1) pinnedNodeIds.push(node.id);
    }
    return { activeNodes, requests, pinnedNodeIds };
}

function canvasNodeIntersectsEnvelope(node: CanvasNodeData, envelope: CanvasWebglQueryEnvelope) {
    return node.position.x + Math.max(node.width, 1) > envelope.left && node.position.x < envelope.right && node.position.y + Math.max(node.height, 1) > envelope.top && node.position.y < envelope.bottom;
}

export function canvasWebglRelationCandidates(activeNodes: CanvasNodeData[], graphIndex: CanvasGraphIndex, selectedNodeIds: ReadonlySet<string>) {
    const activeIds = new Set(activeNodes.map((node) => node.id));
    const ambient = new Map<string, CanvasConnection>();
    const focused = new Map<string, CanvasConnection>();
    for (const node of activeNodes) {
        for (const connection of graphIndex.incomingByNodeId.get(node.id) || []) {
            if (activeIds.has(connection.fromNodeId) && ambient.size < CANVAS_AMBIENT_CONNECTION_LIMIT) ambient.set(connection.id, connection);
        }
        for (const connection of graphIndex.outgoingByNodeId.get(node.id) || []) {
            if (activeIds.has(connection.toNodeId) && ambient.size < CANVAS_AMBIENT_CONNECTION_LIMIT) ambient.set(connection.id, connection);
        }
        if (ambient.size >= CANVAS_AMBIENT_CONNECTION_LIMIT) break;
    }
    for (const nodeId of selectedNodeIds) {
        for (const connection of graphIndex.incomingByNodeId.get(nodeId) || []) {
            focused.set(connection.id, connection);
            if (focused.size >= CANVAS_FOCUS_CONNECTION_LIMIT) break;
        }
        for (const connection of graphIndex.outgoingByNodeId.get(nodeId) || []) {
            focused.set(connection.id, connection);
            if (focused.size >= CANVAS_FOCUS_CONNECTION_LIMIT) break;
        }
        if (focused.size >= CANVAS_FOCUS_CONNECTION_LIMIT) break;
    }
    focused.forEach((_connection, id) => ambient.delete(id));
    return { ambient: [...ambient.values()], focused: [...focused.values()].slice(0, CANVAS_FOCUS_CONNECTION_LIMIT) };
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate a WebGL program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || "WebGL program link failed";
        gl.deleteProgram(program);
        throw new Error(message);
    }
    return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate a WebGL shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || "WebGL shader compilation failed";
        gl.deleteShader(shader);
        throw new Error(message);
    }
    return shader;
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
    const location = gl.getUniformLocation(program, name);
    if (!location) throw new Error(`Missing WebGL uniform: ${name}`);
    return location;
}

function createBuffer(gl: WebGL2RenderingContext, values: number[], floatsPerVertex: number): BufferSet | null {
    if (!values.length) return null;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to allocate a WebGL buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    return { buffer, count: values.length / floatsPerVertex };
}

function appendRect(target: number[], x: number, y: number, width: number, height: number, color: number[]) {
    const right = x + Math.max(width, 1);
    const bottom = y + Math.max(height, 1);
    appendSolidVertex(target, x, y, color);
    appendSolidVertex(target, right, y, color);
    appendSolidVertex(target, x, bottom, color);
    appendSolidVertex(target, x, bottom, color);
    appendSolidVertex(target, right, y, color);
    appendSolidVertex(target, right, bottom, color);
}

function appendRectOutline(target: number[], x: number, y: number, width: number, height: number, thickness: number, color: number[]) {
    appendRect(target, x, y, width, thickness, color);
    appendRect(target, x, y + height - thickness, width, thickness, color);
    appendRect(target, x, y, thickness, height, color);
    appendRect(target, x + width - thickness, y, thickness, height, color);
}

function appendMissingMark(target: number[], node: CanvasNodeData, color: number[]) {
    const thickness = Math.max(3, Math.min(node.width, node.height) * 0.025);
    appendLineSegment(target, node.position.x + node.width * 0.22, node.position.y + node.height * 0.22, node.position.x + node.width * 0.78, node.position.y + node.height * 0.78, thickness, color);
    appendLineSegment(target, node.position.x + node.width * 0.78, node.position.y + node.height * 0.22, node.position.x + node.width * 0.22, node.position.y + node.height * 0.78, thickness, color);
}

function appendNodeTypeMark(target: number[], node: CanvasNodeData, color: number[]) {
    const scale = Math.max(Math.min(node.width, node.height) / 180, 0.7);
    const left = node.position.x + 10 * scale;
    const top = node.position.y + 10 * scale;
    const size = 22 * scale;
    const background = [0.02, 0.025, 0.02, 0.74];
    appendRect(target, left, top, size, size, background);
    if (node.type === CanvasNodeType.Video) {
        appendSolidVertex(target, left + size * 0.36, top + size * 0.25, color);
        appendSolidVertex(target, left + size * 0.36, top + size * 0.75, color);
        appendSolidVertex(target, left + size * 0.76, top + size * 0.5, color);
        return;
    }
    if (node.type === CanvasNodeType.Image) {
        appendRectOutline(target, left + size * 0.2, top + size * 0.22, size * 0.6, size * 0.56, Math.max(1.5 * scale, 1), color);
        appendSolidVertex(target, left + size * 0.24, top + size * 0.7, color);
        appendSolidVertex(target, left + size * 0.46, top + size * 0.43, color);
        appendSolidVertex(target, left + size * 0.62, top + size * 0.7, color);
        return;
    }
    if (node.type === CanvasNodeType.Audio) {
        for (let index = 0; index < 4; index += 1) appendRect(target, left + size * (0.24 + index * 0.14), top + size * (index % 2 ? 0.28 : 0.4), Math.max(1.8 * scale, 1), size * (index % 2 ? 0.44 : 0.22), color);
        return;
    }
    if (node.type === CanvasNodeType.Text) {
        for (let index = 0; index < 3; index += 1) appendRect(target, left + size * 0.22, top + size * (0.28 + index * 0.18), size * (index === 2 ? 0.38 : 0.56), Math.max(1.5 * scale, 1), color);
        return;
    }
    if (node.type === CanvasNodeType.Config) {
        for (let index = 0; index < 3; index += 1) {
            const y = top + size * (0.28 + index * 0.2);
            appendRect(target, left + size * 0.2, y, size * 0.6, Math.max(1.2 * scale, 1), color);
            appendRect(target, left + size * (index % 2 ? 0.57 : 0.34), y - size * 0.06, size * 0.1, size * 0.12, color);
        }
        return;
    }
    appendRectOutline(target, left + size * 0.22, top + size * 0.22, size * 0.56, size * 0.56, Math.max(1.5 * scale, 1), color);
}

function appendSolidVertex(target: number[], x: number, y: number, color: number[]) {
    target.push(x, y, color[0], color[1], color[2], color[3]);
}

function appendTextureRect(target: number[], node: CanvasNodeData, slot: CanvasBaseProxySlot) {
    const x = node.position.x;
    const y = node.position.y;
    const right = x + Math.max(node.width, 1);
    const bottom = y + Math.max(node.height, 1);
    target.push(x, y, slot.u0, slot.v0, right, y, slot.u1, slot.v0, x, bottom, slot.u0, slot.v1, x, bottom, slot.u0, slot.v1, right, y, slot.u1, slot.v0, right, bottom, slot.u1, slot.v1);
}

function appendConnection(target: number[], graphIndex: CanvasGraphIndex, connection: CanvasConnection, thickness: number, color: number[], arrow: boolean) {
    const from = graphIndex.nodeById.get(connection.fromNodeId);
    const to = graphIndex.nodeById.get(connection.toNodeId);
    if (!from || !to) return;
    const curve = canvasConnectionCurve(from, to);
    const start = curve.start;
    const end = curve.end;
    appendLineSegment(target, start.x, start.y, end.x, end.y, thickness, color);
    if (!arrow) return;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(Math.hypot(dx, dy), 1);
    const ux = dx / length;
    const uy = dy / length;
    const arrowLength = Math.max(thickness * 5, 12);
    const arrowWidth = arrowLength * 0.55;
    appendSolidVertex(target, end.x, end.y, color);
    appendSolidVertex(target, end.x - ux * arrowLength - uy * arrowWidth, end.y - uy * arrowLength + ux * arrowWidth, color);
    appendSolidVertex(target, end.x - ux * arrowLength + uy * arrowWidth, end.y - uy * arrowLength - ux * arrowWidth, color);
}

function appendLineSegment(target: number[], x1: number, y1: number, x2: number, y2: number, thickness: number, color: number[]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.max(Math.hypot(dx, dy), 1);
    const nx = (-dy / length) * (thickness / 2);
    const ny = (dx / length) * (thickness / 2);
    appendSolidVertex(target, x1 + nx, y1 + ny, color);
    appendSolidVertex(target, x2 + nx, y2 + ny, color);
    appendSolidVertex(target, x1 - nx, y1 - ny, color);
    appendSolidVertex(target, x1 - nx, y1 - ny, color);
    appendSolidVertex(target, x2 + nx, y2 + ny, color);
    appendSolidVertex(target, x2 - nx, y2 - ny, color);
}

function semanticNodeColor(type: string) {
    if (type === CanvasNodeType.Text) return [0.28, 0.42, 0.7, 0.78];
    if (type === CanvasNodeType.Audio) return [0.58, 0.34, 0.75, 0.78];
    if (type === CanvasNodeType.Config) return [0.76, 0.46, 0.18, 0.78];
    if (type === CanvasNodeType.Group) return [0.42, 0.48, 0.42, 0.18];
    return [0.18, 0.22, 0.2, 0.9];
}

function parseCssColor(value: string, fallback: [number, number, number, number]): [number, number, number, number] {
    const match = /^#([a-f0-9]{6})([a-f0-9]{2})?$/i.exec(value.trim());
    if (!match) return fallback;
    const rgb = match[1];
    return [Number.parseInt(rgb.slice(0, 2), 16) / 255, Number.parseInt(rgb.slice(2, 4), 16) / 255, Number.parseInt(rgb.slice(4, 6), 16) / 255, match[2] ? Number.parseInt(match[2], 16) / 255 : fallback[3]];
}

const SOLID_VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec4 aColor;
uniform vec3 uCamera;
uniform vec2 uViewport;
out vec4 vColor;
void main() {
    vec2 screen = aPosition * uCamera.z + uCamera.xy;
    vec2 clip = vec2((screen.x / uViewport.x) * 2.0 - 1.0, 1.0 - (screen.y / uViewport.y) * 2.0);
    gl_Position = vec4(clip, 0.0, 1.0);
    vColor = aColor;
}`;

const SOLID_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

const TEXTURE_VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec2 aUv;
uniform vec3 uCamera;
uniform vec2 uViewport;
out vec2 vUv;
void main() {
    vec2 screen = aPosition * uCamera.z + uCamera.xy;
    vec2 clip = vec2((screen.x / uViewport.x) * 2.0 - 1.0, 1.0 - (screen.y / uViewport.y) * 2.0);
    gl_Position = vec4(clip, 0.0, 1.0);
    vUv = aUv;
}`;

const TEXTURE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 outColor;
void main() { outColor = texture(uTexture, vUv); }`;
