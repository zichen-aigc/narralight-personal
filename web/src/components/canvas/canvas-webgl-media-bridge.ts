import type { ViewportTransform } from "@/types/canvas";

export type CanvasWebglMediaBridgeItem = {
    nodeId: string;
    kind: "image" | "video";
    source: string;
    fallbackSource?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    selected: boolean;
};

export class CanvasWebglMediaBridge {
    private readonly entries = new Map<string, { signature: string; element: HTMLDivElement }>();
    private cameraWrites = 0;
    private syncs = 0;
    private mediaLoads = 0;

    constructor(
        private readonly root: HTMLDivElement,
        private readonly onMediaLoad?: () => void,
    ) {}

    updateCamera(viewport: ViewportTransform) {
        this.root.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`;
        this.cameraWrites += 1;
    }

    sync(items: CanvasWebglMediaBridgeItem[]) {
        const nextIds = new Set(items.map((item) => item.nodeId));
        for (const [nodeId, entry] of this.entries) {
            if (nextIds.has(nodeId)) continue;
            this.releaseElement(entry.element);
            entry.element.remove();
            this.entries.delete(nodeId);
        }
        for (const item of items) {
            const signature = [item.kind, item.source, item.fallbackSource || "", item.x, item.y, item.width, item.height, item.selected ? 1 : 0].join("|");
            const current = this.entries.get(item.nodeId);
            if (current?.signature === signature) continue;
            if (current) {
                this.releaseElement(current.element);
                current.element.remove();
            }
            const element = this.createElement(item);
            this.root.appendChild(element);
            this.entries.set(item.nodeId, { signature, element });
        }
        this.syncs += 1;
    }

    nodeIds() {
        return [...this.entries.keys()];
    }

    diagnostics() {
        return { nodeIds: this.nodeIds(), cameraWrites: this.cameraWrites, syncs: this.syncs, mediaLoads: this.mediaLoads };
    }

    dispose() {
        this.entries.forEach((entry) => this.releaseElement(entry.element));
        this.entries.clear();
        this.root.replaceChildren();
    }

    private createElement(item: CanvasWebglMediaBridgeItem) {
        const frame = document.createElement("div");
        frame.dataset.canvasWebglBridgeNode = item.nodeId;
        frame.style.position = "absolute";
        frame.style.left = `${item.x}px`;
        frame.style.top = `${item.y}px`;
        frame.style.width = `${Math.max(item.width, 1)}px`;
        frame.style.height = `${Math.max(item.height, 1)}px`;
        frame.style.overflow = "hidden";
        frame.style.boxSizing = "border-box";
        frame.style.background = "transparent";
        frame.style.outline = item.selected ? "3px solid var(--canvas-active-stroke, #d4a72c)" : "none";
        frame.style.outlineOffset = "-3px";
        frame.appendChild(item.kind === "video" ? this.createVideo(item.source) : this.createImage(item.source, item.fallbackSource));
        return frame;
    }

    private createImage(source: string, fallbackSource?: string) {
        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        image.loading = "eager";
        image.draggable = false;
        this.styleMedia(image);
        image.addEventListener(
            "load",
            () => {
                this.mediaLoads += 1;
                this.onMediaLoad?.();
            },
            { once: true },
        );
        if (fallbackSource) {
            image.addEventListener(
                "error",
                () => {
                    const video = this.createVideo(fallbackSource);
                    image.replaceWith(video);
                },
                { once: true },
            );
        }
        image.src = source;
        return image;
    }

    private createVideo(source: string) {
        const video = document.createElement("video");
        video.autoplay = false;
        video.controls = false;
        video.loop = false;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.disablePictureInPicture = true;
        this.styleMedia(video);
        const pause = () => {
            video.pause();
            this.mediaLoads += 1;
            this.onMediaLoad?.();
        };
        video.addEventListener("loadeddata", pause, { once: true });
        video.addEventListener("play", () => video.pause());
        video.src = source;
        video.load();
        return video;
    }

    private styleMedia(media: HTMLImageElement | HTMLVideoElement) {
        media.style.display = "block";
        media.style.width = "100%";
        media.style.height = "100%";
        media.style.objectFit = "contain";
        media.style.pointerEvents = "none";
        media.style.userSelect = "none";
    }

    private releaseElement(element: HTMLDivElement) {
        element.querySelectorAll("video").forEach((video) => {
            video.pause();
            video.removeAttribute("src");
            video.load();
        });
    }
}
