import { Video } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { prepareLocalVideoPlayback, type VideoPlaybackSource } from "@/services/video-playback";

type Props = VideoPlaybackSource & {
    className?: string;

    eager?: boolean;

    controls?: boolean;

    dataCanvasNoZoom?: boolean;

    dataCanvasVideo?: string;

    onMetadata?: (metadata: { width: number; height: number; durationMs: number }) => void;
};

export function DeferredCanvasVideo({ src, storageKey, mimeType, bytes, className, eager = false, controls = true, dataCanvasNoZoom = false, dataCanvasVideo, onMetadata }: Props) {
    const hostRef = useRef<HTMLDivElement>(null);

    const videoRef = useRef<HTMLVideoElement>(null);

    const manualPlaybackRequestedRef = useRef(false);

    const playbackPointerStartRef = useRef<CanvasVideoPointerSample | null>(null);

    const [visible, setVisible] = useState(eager);

    const [playbackSrc, setPlaybackSrc] = useState("");

    useEffect(() => {
        if (eager) {
            setVisible(true);

            return;
        }

        const host = hostRef.current;

        if (!host || typeof IntersectionObserver === "undefined") {
            setVisible(true);

            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                setVisible(Boolean(entry?.isIntersecting));
            },

            { rootMargin: "360px" },
        );

        observer.observe(host);

        return () => observer.disconnect();
    }, [eager]);

    useEffect(() => {
        if (!visible) {
            releaseVideoElement(videoRef.current);

            setPlaybackSrc("");

            return;
        }

        const controller = new AbortController();

        setPlaybackSrc("");

        void prepareLocalVideoPlayback(
            { src, storageKey, mimeType, bytes },

            { priority: () => distanceFromViewportCenter(hostRef.current), signal: controller.signal },
        ).then(
            (prepared) => setPlaybackSrc(prepared.src),
            () => undefined,
        );

        return () => {
            controller.abort();

            releaseVideoElement(videoRef.current);
        };
    }, [bytes, mimeType, src, storageKey, visible]);

    useLayoutEffect(() => {
        manualPlaybackRequestedRef.current = false;

        ensureCanvasVideoPaused(videoRef.current);
    }, [playbackSrc]);

    return (
        <div ref={hostRef} className={`relative h-full w-full overflow-hidden bg-black ${className || ""}`}>
            {playbackSrc ? (
                <video
                    ref={videoRef}

                    src={playbackSrc}

                    controls={controls}

                    autoPlay={false}

                    preload="metadata"

                    playsInline

                    className="h-full w-full object-contain"

                    data-canvas-no-zoom={dataCanvasNoZoom || undefined}

                    data-canvas-video={dataCanvasVideo}

                    onPointerDownCapture={(event) => {
                        manualPlaybackRequestedRef.current = false;

                        playbackPointerStartRef.current = event.isPrimary && event.button === 0 ? { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY } : null;
                    }}

                    onPointerUpCapture={(event) => {
                        manualPlaybackRequestedRef.current = isCanvasVideoManualPointerIntent(playbackPointerStartRef.current, {
                            pointerId: event.pointerId,

                            clientX: event.clientX,

                            clientY: event.clientY,

                            button: event.button,

                            isPrimary: event.isPrimary,
                        });

                        playbackPointerStartRef.current = null;
                    }}

                    onPointerCancelCapture={() => {
                        playbackPointerStartRef.current = null;

                        manualPlaybackRequestedRef.current = false;
                    }}

                    onKeyDownCapture={(event) => {
                        if (event.key === "Enter" || event.key === " ") manualPlaybackRequestedRef.current = true;
                    }}

                    onLoadedMetadata={(event) => {
                        if (!manualPlaybackRequestedRef.current) ensureCanvasVideoPaused(event.currentTarget);

                        const media = event.currentTarget;

                        if (media.videoWidth > 0 && media.videoHeight > 0 && Number.isFinite(media.duration) && media.duration > 0) {
                            onMetadata?.({ width: media.videoWidth, height: media.videoHeight, durationMs: Math.round(media.duration * 1000) });
                        }
                    }}

                    onPlay={(event) => {
                        pauseUnexpectedCanvasVideoPlayback(event.currentTarget, manualPlaybackRequestedRef.current);

                        manualPlaybackRequestedRef.current = false;
                    }}

                    onPause={() => {
                        manualPlaybackRequestedRef.current = false;
                    }}
                />
            ) : (
                <VideoPlaceholder />
            )}
        </div>
    );
}

export function distanceFromViewportCenter(element: Pick<HTMLElement, "getBoundingClientRect"> | null) {
    if (!element || typeof window === "undefined") return 0;

    const rect = element.getBoundingClientRect();

    return Math.hypot(rect.left + rect.width / 2 - window.innerWidth / 2, rect.top + rect.height / 2 - window.innerHeight / 2);
}

export function releaseVideoElement(video: Pick<HTMLVideoElement, "pause" | "removeAttribute" | "load"> | null) {
    if (!video) return;

    video.pause();

    video.removeAttribute("src");

    video.load();
}

export function ensureCanvasVideoPaused(video: Pick<HTMLVideoElement, "autoplay" | "pause"> | null) {
    if (!video) return;

    video.autoplay = false;

    video.pause();
}

export function pauseUnexpectedCanvasVideoPlayback(video: Pick<HTMLVideoElement, "pause">, manualPlaybackRequested: boolean) {
    if (manualPlaybackRequested) return false;

    video.pause();

    return true;
}

type CanvasVideoPointerSample = {
    pointerId: number;

    clientX: number;

    clientY: number;
};

export function isCanvasVideoManualPointerIntent(
    start: CanvasVideoPointerSample | null,

    end: CanvasVideoPointerSample & { button: number; isPrimary: boolean },

    movementTolerance = 6,
) {
    if (!start || !end.isPrimary || end.button !== 0 || start.pointerId !== end.pointerId) return false;

    return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) <= movementTolerance;
}

function VideoPlaceholder() {
    return (
        <div className="flex h-full w-full items-center justify-center bg-black/90 text-white/45" aria-label="视频将在进入视口后加载">
            <Video className="size-7" />
        </div>
    );
}
