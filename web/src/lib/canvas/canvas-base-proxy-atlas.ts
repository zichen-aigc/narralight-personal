import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const CANVAS_BASE_PROXY_LONG_EDGE = 192;
export const CANVAS_BASE_PROXY_GUTTER = 2;
export const CANVAS_BASE_PROXY_SLOT_EDGE = CANVAS_BASE_PROXY_LONG_EDGE + CANVAS_BASE_PROXY_GUTTER * 2;
export const CANVAS_BASE_PROXY_PAGE_SIZE = 2048;
export const CANVAS_BASE_PROXY_MAX_PAGES = 6;
export const CANVAS_BASE_PROXY_SLOTS_PER_ROW = Math.floor(CANVAS_BASE_PROXY_PAGE_SIZE / CANVAS_BASE_PROXY_SLOT_EDGE);
export const CANVAS_BASE_PROXY_SLOTS_PER_PAGE = CANVAS_BASE_PROXY_SLOTS_PER_ROW * CANVAS_BASE_PROXY_SLOTS_PER_ROW;
export const CANVAS_BASE_PROXY_MAX_SLOTS = CANVAS_BASE_PROXY_SLOTS_PER_PAGE * CANVAS_BASE_PROXY_MAX_PAGES;
export const CANVAS_BASE_PROXY_BUDGET_BYTES = CANVAS_BASE_PROXY_MAX_PAGES * CANVAS_BASE_PROXY_PAGE_SIZE * CANVAS_BASE_PROXY_PAGE_SIZE * 4;
export const CANVAS_BASE_PROXY_BUILD_CONCURRENCY = 2;
export const CANVAS_BASE_PROXY_PENDING_BITMAP_LIMIT = 8;

export type CanvasBaseProxyKind = "image" | "video-poster" | "video-frame";
export type CanvasBaseProxyPriority = 0 | 1 | 2;

export type CanvasBaseProxySource = {
    key: string;
    nodeId: string;
    nodeIds: string[];
    kind: CanvasBaseProxyKind;
    source: string;
    width: number;
    height: number;
    residencyEligible: boolean;
};

export type CanvasBaseProxySlot = CanvasBaseProxySource & {
    slotIndex: number;
    page: number;
    x: number;
    y: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
};

export type CanvasBaseProxyPlan = {
    sources: CanvasBaseProxySource[];
    missingImageNodeIds: Set<string>;
    unsupportedNodeIds: Set<string>;
};

export type CanvasBaseProxyResidencyRequest = {
    nodeId: string;
    priority: CanvasBaseProxyPriority;
};

export type CanvasBaseProxyResidencyDiagnostics = {
    pageCount: number;
    gpuBytes: number;
    capacity: number;
    resident: number;
    pinned: number;
    requested: number;
    decoding: number;
    decodedPendingUpload: number;
    evictions: number;
    uploads: number;
    decodeFailures: number;
    panActive: boolean;
};

type DecodedProxy = { bitmap: ImageBitmap; priority: CanvasBaseProxyPriority };

export class CanvasBaseProxyBuildError extends Error {
    constructor(
        public readonly reason: "cross-origin" | "decode-failed" | "context-lost" | "unsupported-browser",
        message: string,
    ) {
        super(message);
        this.name = "CanvasBaseProxyBuildError";
    }
}

export class CanvasBaseProxyLruSlots {
    private readonly slotByKey = new Map<string, number>();
    private readonly lastUsedByKey = new Map<string, number>();
    private readonly freeSlots: number[];
    private tick = 0;

    constructor(public readonly capacity = CANVAS_BASE_PROXY_MAX_SLOTS) {
        this.freeSlots = Array.from({ length: capacity }, (_, index) => capacity - index - 1);
    }

    get size() {
        return this.slotByKey.size;
    }

    has(key: string) {
        return this.slotByKey.has(key);
    }

    slotFor(key: string) {
        return this.slotByKey.get(key);
    }

    touch(key: string) {
        if (this.slotByKey.has(key)) this.lastUsedByKey.set(key, ++this.tick);
    }

    ensure(key: string, pinnedKeys: ReadonlySet<string>): { slotIndex: number; evictedKey: string | null } | null {
        const existing = this.slotByKey.get(key);
        if (existing !== undefined) {
            this.touch(key);
            return { slotIndex: existing, evictedKey: null };
        }
        const free = this.freeSlots.pop();
        if (free !== undefined) {
            this.slotByKey.set(key, free);
            this.lastUsedByKey.set(key, ++this.tick);
            return { slotIndex: free, evictedKey: null };
        }
        let evictedKey: string | null = null;
        let oldest = Number.POSITIVE_INFINITY;
        for (const [candidate, usedAt] of this.lastUsedByKey) {
            if (pinnedKeys.has(candidate) || usedAt >= oldest) continue;
            oldest = usedAt;
            evictedKey = candidate;
        }
        if (!evictedKey) return null;
        const slotIndex = this.slotByKey.get(evictedKey);
        if (slotIndex === undefined) return null;
        this.slotByKey.delete(evictedKey);
        this.lastUsedByKey.delete(evictedKey);
        this.slotByKey.set(key, slotIndex);
        this.lastUsedByKey.set(key, ++this.tick);
        return { slotIndex, evictedKey };
    }

    delete(key: string) {
        const slotIndex = this.slotByKey.get(key);
        if (slotIndex === undefined) return;
        this.slotByKey.delete(key);
        this.lastUsedByKey.delete(key);
        this.freeSlots.push(slotIndex);
    }
}

export class CanvasBaseProxyResidencyPool {
    readonly textures: WebGLTexture[] = [];
    readonly slotsByNodeId = new Map<string, CanvasBaseProxySlot>();
    readonly missingImageNodeIds = new Set<string>();
    readonly pageCount = CANVAS_BASE_PROXY_MAX_PAGES;
    readonly gpuBytes = CANVAS_BASE_PROXY_BUDGET_BYTES;
    readonly capacity = CANVAS_BASE_PROXY_MAX_SLOTS;
    revision = 0;

    private readonly lru = new CanvasBaseProxyLruSlots();
    private readonly sourceByNodeId = new Map<string, CanvasBaseProxySource>();
    private readonly sourceByKey = new Map<string, CanvasBaseProxySource>();
    private readonly residentByKey = new Map<string, CanvasBaseProxySlot>();
    private readonly demandByKey = new Map<string, CanvasBaseProxyPriority>();
    private readonly pinnedKeys = new Set<string>();
    private readonly failedKeys = new Set<string>();
    private readonly inFlight = new Map<string, AbortController>();
    private readonly decoded = new Map<string, DecodedProxy>();
    private uploadFrame: number | null = null;
    private panActive = false;
    private disposed = false;
    private evictions = 0;
    private uploads = 0;
    private decodeFailures = 0;

    constructor(
        private readonly gl: WebGL2RenderingContext,
        private readonly onResidencyChange?: () => void,
        private readonly onDecode?: () => void,
    ) {
        if (typeof createImageBitmap !== "function") throw new CanvasBaseProxyBuildError("unsupported-browser", "createImageBitmap is unavailable");
        if (Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) < CANVAS_BASE_PROXY_PAGE_SIZE) throw new CanvasBaseProxyBuildError("unsupported-browser", "WebGL texture pages exceed MAX_TEXTURE_SIZE");
        try {
            for (let index = 0; index < CANVAS_BASE_PROXY_MAX_PAGES; index += 1) {
                const texture = gl.createTexture();
                if (!texture || gl.isContextLost()) throw new CanvasBaseProxyBuildError("context-lost", "WebGL context was lost while allocating the Base Proxy residency pool");
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CANVAS_BASE_PROXY_PAGE_SIZE, CANVAS_BASE_PROXY_PAGE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                this.textures.push(texture);
            }
        } catch (error) {
            this.textures.forEach((texture) => gl.deleteTexture(texture));
            this.textures.length = 0;
            throw error;
        }
    }

    replacePlan(plan: CanvasBaseProxyPlan) {
        if (this.disposed) return;
        const nextKeys = new Set(plan.sources.map((source) => source.key));
        for (const [key, controller] of this.inFlight) if (!nextKeys.has(key)) controller.abort();
        for (const [key, pending] of this.decoded) {
            if (nextKeys.has(key)) continue;
            pending.bitmap.close();
            this.decoded.delete(key);
        }
        let changed = false;
        for (const key of this.residentByKey.keys()) {
            if (nextKeys.has(key)) continue;
            this.removeResident(key);
            this.lru.delete(key);
            changed = true;
        }
        this.sourceByNodeId.clear();
        this.sourceByKey.clear();
        plan.sources.forEach((source) => {
            this.sourceByKey.set(source.key, source);
            source.nodeIds.forEach((nodeId) => this.sourceByNodeId.set(nodeId, source));
        });
        this.missingImageNodeIds.clear();
        plan.missingImageNodeIds.forEach((nodeId) => this.missingImageNodeIds.add(nodeId));
        this.rebuildNodeSlots();
        this.updateDemand([], []);
        if (changed) this.bumpRevision();
    }

    sourceForNodeId(nodeId: string) {
        return this.sourceByNodeId.get(nodeId);
    }

    slotForNodeId(nodeId: string) {
        const slot = this.slotsByNodeId.get(nodeId);
        if (slot) this.lru.touch(slot.key);
        return slot;
    }

    setPanActive(active: boolean) {
        if (this.panActive === active) return;
        this.panActive = active;
        if (active && this.uploadFrame !== null) {
            cancelAnimationFrame(this.uploadFrame);
            this.uploadFrame = null;
        }
        if (!active) this.scheduleUpload();
    }

    updateDemand(requests: CanvasBaseProxyResidencyRequest[], pinnedNodeIds: Iterable<string>) {
        if (this.disposed) return;
        const nextDemand = new Map<string, CanvasBaseProxyPriority>();
        for (const request of requests) {
            const source = this.sourceByNodeId.get(request.nodeId);
            if (!source?.residencyEligible) continue;
            const current = nextDemand.get(source.key);
            if (current === undefined || request.priority < current) nextDemand.set(source.key, request.priority);
        }
        const nextPinned = new Set<string>();
        for (const nodeId of pinnedNodeIds) {
            const key = this.sourceByNodeId.get(nodeId)?.key;
            if (key) nextPinned.add(key);
        }
        for (const [key, controller] of this.inFlight) if (!nextDemand.has(key)) controller.abort();
        for (const [key, pending] of this.decoded) {
            if (nextDemand.has(key)) continue;
            pending.bitmap.close();
            this.decoded.delete(key);
        }
        this.failedKeys.clear();
        this.demandByKey.clear();
        nextDemand.forEach((priority, key) => this.demandByKey.set(key, priority));
        this.pinnedKeys.clear();
        nextPinned.forEach((key) => this.pinnedKeys.add(key));
        this.demandByKey.forEach((_priority, key) => this.lru.touch(key));
        this.pump();
        this.scheduleUpload();
    }

    diagnostics(): CanvasBaseProxyResidencyDiagnostics {
        return {
            pageCount: this.pageCount,
            gpuBytes: this.gpuBytes,
            capacity: this.capacity,
            resident: this.residentByKey.size,
            pinned: this.pinnedKeys.size,
            requested: this.demandByKey.size,
            decoding: this.inFlight.size,
            decodedPendingUpload: this.decoded.size,
            evictions: this.evictions,
            uploads: this.uploads,
            decodeFailures: this.decodeFailures,
            panActive: this.panActive,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.uploadFrame !== null) cancelAnimationFrame(this.uploadFrame);
        this.uploadFrame = null;
        this.inFlight.forEach((controller) => controller.abort());
        this.inFlight.clear();
        this.decoded.forEach(({ bitmap }) => bitmap.close());
        this.decoded.clear();
        this.textures.forEach((texture) => this.gl.deleteTexture(texture));
        this.textures.length = 0;
        this.slotsByNodeId.clear();
        this.residentByKey.clear();
    }

    private pump() {
        if (this.disposed || this.decoded.size >= CANVAS_BASE_PROXY_PENDING_BITMAP_LIMIT) return;
        while (this.inFlight.size < CANVAS_BASE_PROXY_BUILD_CONCURRENCY && this.decoded.size + this.inFlight.size < CANVAS_BASE_PROXY_PENDING_BITMAP_LIMIT) {
            const candidate = [...this.demandByKey.entries()]
                .filter(([key]) => !this.residentByKey.has(key) && !this.inFlight.has(key) && !this.decoded.has(key) && !this.failedKeys.has(key))
                .sort((left, right) => left[1] - right[1])[0];
            if (!candidate) break;
            const [key, priority] = candidate;
            const source = this.sourceByKey.get(key);
            if (!source) break;
            const controller = new AbortController();
            this.inFlight.set(key, controller);
            void loadCanvasBaseProxyBitmap(source, controller.signal)
                .then((bitmap) => {
                    if (controller.signal.aborted || this.disposed || !this.demandByKey.has(key)) {
                        bitmap.close();
                        return;
                    }
                    this.decoded.set(key, { bitmap, priority: this.demandByKey.get(key) ?? priority });
                    this.onDecode?.();
                    this.scheduleUpload();
                })
                .catch((error: unknown) => {
                    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                    this.failedKeys.add(key);
                    this.decodeFailures += 1;
                })
                .finally(() => {
                    this.inFlight.delete(key);
                    this.pump();
                });
        }
    }

    private scheduleUpload() {
        if (this.disposed || this.panActive || this.uploadFrame !== null || !this.decoded.size) return;
        this.uploadFrame = requestAnimationFrame(() => {
            this.uploadFrame = null;
            if (this.disposed || this.panActive) return;
            const candidate = [...this.decoded.entries()].sort((left, right) => left[1].priority - right[1].priority)[0];
            if (!candidate) return;
            const [key, pending] = candidate;
            this.decoded.delete(key);
            this.upload(key, pending.bitmap);
            this.pump();
            this.scheduleUpload();
        });
    }

    private upload(key: string, bitmap: ImageBitmap) {
        try {
            const source = this.sourceByKey.get(key);
            if (!source || !this.demandByKey.has(key)) return;
            const allocation = this.lru.ensure(key, this.pinnedKeys);
            if (!allocation) {
                this.failedKeys.add(key);
                return;
            }
            if (allocation.evictedKey) {
                this.removeResident(allocation.evictedKey);
                this.evictions += 1;
            }
            const slot = canvasBaseProxySlot(source, allocation.slotIndex);
            if (this.gl.isContextLost()) throw new CanvasBaseProxyBuildError("context-lost", "WebGL context was lost while uploading a Base Proxy");
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[slot.page]);
            this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, slot.x, slot.y, this.gl.RGBA, this.gl.UNSIGNED_BYTE, bitmap);
            this.residentByKey.set(key, slot);
            source.nodeIds.forEach((nodeId) => this.slotsByNodeId.set(nodeId, slot));
            this.uploads += 1;
            this.bumpRevision();
        } finally {
            bitmap.close();
        }
    }

    private removeResident(key: string) {
        const slot = this.residentByKey.get(key);
        if (!slot) return;
        slot.nodeIds.forEach((nodeId) => this.slotsByNodeId.delete(nodeId));
        this.residentByKey.delete(key);
    }

    private rebuildNodeSlots() {
        this.slotsByNodeId.clear();
        for (const [key, existing] of this.residentByKey) {
            const source = this.sourceByKey.get(key);
            if (!source) continue;
            const slot = { ...existing, ...source };
            this.residentByKey.set(key, slot);
            source.nodeIds.forEach((nodeId) => this.slotsByNodeId.set(nodeId, slot));
        }
    }

    private bumpRevision() {
        this.revision += 1;
        this.onResidencyChange?.();
    }
}

export function canvasWebglPanV1Requested(search: Pick<URLSearchParams, "get">) {
    return search.get("canvasWebglPanV1") !== "0";
}

export function buildCanvasBaseProxyPlan(nodes: CanvasNodeData[], posterByNodeId: ReadonlyMap<string, string>): CanvasBaseProxyPlan {
    const sourceByKey = new Map<string, CanvasBaseProxySource>();
    const missingImageNodeIds = new Set<string>();
    const unsupportedNodeIds = new Set<string>();
    const builtins = new Set<string>(Object.values(CanvasNodeType));

    for (const node of nodes) {
        if (!builtins.has(node.type)) unsupportedNodeIds.add(node.id);
        if (node.type === CanvasNodeType.Image) {
            const source = node.metadata?.content || "";
            if (!source) {
                missingImageNodeIds.add(node.id);
                continue;
            }
            appendBaseProxySource(sourceByKey, node, "image", source);
            continue;
        }
        if (node.type === CanvasNodeType.Video) {
            const poster = posterByNodeId.get(node.id) || "";
            const source = poster || node.metadata?.content || "";
            if (source) appendBaseProxySource(sourceByKey, node, poster ? "video-poster" : "video-frame", source);
        }
    }

    return { sources: [...sourceByKey.values()], missingImageNodeIds, unsupportedNodeIds };
}

export function isSameOriginCanvasProxySource(source: string, baseHref = typeof window === "undefined" ? "http://127.0.0.1/" : window.location.href) {
    try {
        const url = new URL(source, baseHref);
        const base = new URL(baseHref);
        return url.protocol === "blob:" || (url.protocol === base.protocol && url.origin === base.origin);
    } catch {
        return false;
    }
}

export function canvasBaseProxySlot(source: CanvasBaseProxySource, slotIndex: number): CanvasBaseProxySlot {
    const page = Math.floor(slotIndex / CANVAS_BASE_PROXY_SLOTS_PER_PAGE);
    const pageSlot = slotIndex % CANVAS_BASE_PROXY_SLOTS_PER_PAGE;
    const x = (pageSlot % CANVAS_BASE_PROXY_SLOTS_PER_ROW) * CANVAS_BASE_PROXY_SLOT_EDGE + CANVAS_BASE_PROXY_GUTTER;
    const y = Math.floor(pageSlot / CANVAS_BASE_PROXY_SLOTS_PER_ROW) * CANVAS_BASE_PROXY_SLOT_EDGE + CANVAS_BASE_PROXY_GUTTER;
    return {
        ...source,
        slotIndex,
        page,
        x,
        y,
        u0: (x + 0.5) / CANVAS_BASE_PROXY_PAGE_SIZE,
        v0: (y + 0.5) / CANVAS_BASE_PROXY_PAGE_SIZE,
        u1: (x + source.width - 0.5) / CANVAS_BASE_PROXY_PAGE_SIZE,
        v1: (y + source.height - 0.5) / CANVAS_BASE_PROXY_PAGE_SIZE,
    };
}

function appendBaseProxySource(sourceByKey: Map<string, CanvasBaseProxySource>, node: CanvasNodeData, kind: CanvasBaseProxyKind, source: string) {
    const dimensions = baseProxyDimensions(node);
    const normalized = normalizeCanvasProxySource(source);
    const key = `${kind === "video-frame" ? "video" : "image"}:${normalized}:${dimensions.width}x${dimensions.height}`;
    const existing = sourceByKey.get(key);
    if (existing) {
        existing.nodeIds.push(node.id);
        return;
    }
    sourceByKey.set(key, {
        key,
        nodeId: node.id,
        nodeIds: [node.id],
        kind,
        source,
        ...dimensions,
        residencyEligible: isSameOriginCanvasProxySource(source),
    });
}

function baseProxyDimensions(node: CanvasNodeData) {
    const naturalWidth = Math.max(node.metadata?.naturalWidth || node.width || 1, 1);
    const naturalHeight = Math.max(node.metadata?.naturalHeight || node.height || 1, 1);
    const scale = Math.min(1, CANVAS_BASE_PROXY_LONG_EDGE / Math.max(naturalWidth, naturalHeight));
    return { width: Math.max(8, Math.round(naturalWidth * scale)), height: Math.max(8, Math.round(naturalHeight * scale)) };
}

function normalizeCanvasProxySource(source: string, baseHref = typeof window === "undefined" ? "http://127.0.0.1/" : window.location.href) {
    try {
        const url = new URL(source, baseHref);
        url.hash = "";
        url.searchParams.sort();
        return url.href;
    } catch {
        return source;
    }
}

async function loadCanvasBaseProxyBitmap(source: CanvasBaseProxySource, signal: AbortSignal) {
    if (!source.residencyEligible) throw new CanvasBaseProxyBuildError("cross-origin", `Cross-origin Base Proxy: ${source.nodeId}`);
    const response = await fetch(source.source, { credentials: "same-origin", signal });
    if (!response.ok) throw new CanvasBaseProxyBuildError("decode-failed", `Base Proxy fetch failed (${response.status}): ${source.nodeId}`);
    const blob = await response.blob();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (source.kind !== "video-frame") return createImageBitmap(blob, { resizeWidth: source.width, resizeHeight: source.height, resizeQuality: "medium" });
    return extractPausedVideoFrame(blob, source, signal);
}

async function extractPausedVideoFrame(blob: Blob, source: CanvasBaseProxySource, signal: AbortSignal) {
    if (typeof document === "undefined") throw new CanvasBaseProxyBuildError("unsupported-browser", "Video frame extraction requires a document");
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.autoplay = false;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;
    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new CanvasBaseProxyBuildError("decode-failed", `Video frame timed out: ${source.nodeId}`)), 15_000);
            const cleanup = () => {
                window.clearTimeout(timeout);
                video.removeEventListener("loadeddata", loaded);
                video.removeEventListener("error", failed);
                signal.removeEventListener("abort", aborted);
            };
            const loaded = () => {
                cleanup();
                video.pause();
                resolve();
            };
            const failed = () => {
                cleanup();
                reject(new CanvasBaseProxyBuildError("decode-failed", `Video frame decode failed: ${source.nodeId}`));
            };
            const aborted = () => {
                cleanup();
                reject(new DOMException("Aborted", "AbortError"));
            };
            video.addEventListener("loadeddata", loaded, { once: true });
            video.addEventListener("error", failed, { once: true });
            signal.addEventListener("abort", aborted, { once: true });
            video.load();
        });
        video.pause();
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        if (!context) throw new CanvasBaseProxyBuildError("unsupported-browser", "2D video frame extraction is unavailable");
        context.drawImage(video, 0, 0, source.width, source.height);
        const bitmap = await createImageBitmap(canvas);
        canvas.width = 1;
        canvas.height = 1;
        return bitmap;
    } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
    }
}
