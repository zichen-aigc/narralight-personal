import { ChevronLeft, ChevronRight, FastForward as SkipForward, Pause, Play, Plus, SkipBack, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme as antdTheme } from "antd";

import { useTranslation } from "react-i18next";

type Props = {
    open: boolean;

    source: string | null;

    initialTime?: number;

    onClose: () => void;

    onCapture: (time: number) => void;
};

type Thumbnail = { time: number; src: string };

function formatTime(seconds: number) {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);

    const minutes = Math.floor(safe / 60);

    const remainder = safe - minutes * 60;

    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function parseTime(value: string) {
    const trimmed = value.trim();

    if (!trimmed) return Number.NaN;

    const parts = trimmed.split(":").map(Number);

    if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;

    return parts.length === 1 ? parts[0] : parts[parts.length - 1] + parts[parts.length - 2] * 60;
}

function waitFor(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const done = () => {
            cleanup();

            resolve();
        };

        const fail = () => {
            cleanup();

            reject(new Error("Failed to load video frame"));
        };

        const cleanup = () => {
            video.removeEventListener(eventName, done);

            video.removeEventListener("error", fail);
        };

        video.addEventListener(eventName, done, { once: true });

        video.addEventListener("error", fail, { once: true });
    });
}

export function CanvasVideoFrameCaptureModal({ open, source, initialTime = 0, onClose, onCapture }: Props) {
    const { t } = useTranslation();

    const { token } = antdTheme.useToken();

    const videoRef = useRef<HTMLVideoElement>(null);

    const thumbnailVideoRef = useRef<HTMLVideoElement>(null);

    const [duration, setDuration] = useState(0);

    const [currentTime, setCurrentTime] = useState(0);

    const [playing, setPlaying] = useState(false);

    const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);

    const [savedFrames, setSavedFrames] = useState<number[]>([]);

    const [jumpTime, setJumpTime] = useState("");

    const [loadingThumbnails, setLoadingThumbnails] = useState(false);

    const boundedTime = useCallback((value: number) => Math.min(Math.max(0, value), duration || Number.MAX_SAFE_INTEGER), [duration]);

    const seek = useCallback(
        (value: number) => {
            const next = boundedTime(value);

            const video = videoRef.current;

            if (video) video.currentTime = next;

            setCurrentTime(next);
        },
        [boundedTime],
    );

    useEffect(() => {
        if (!open || !source) return;

        setDuration(0);

        setCurrentTime(Math.max(0, initialTime));

        setPlaying(false);

        setSavedFrames([]);

        setJumpTime("");

        setThumbnails([]);

        const video = videoRef.current;

        if (!video) return;

        const onLoaded = () => {
            const nextDuration = Number.isFinite(video.duration) ? video.duration : 0;

            setDuration(nextDuration);

            const nextTime = Math.min(Math.max(0, initialTime), nextDuration || initialTime);

            video.currentTime = nextTime;

            setCurrentTime(nextTime);
        };

        video.addEventListener("loadedmetadata", onLoaded);

        video.src = source;

        video.load();

        return () => {
            video.pause();

            video.removeEventListener("loadedmetadata", onLoaded);

            video.removeAttribute("src");

            video.load();
        };
    }, [initialTime, open, source]);

    useEffect(() => {
        if (!open || !source || !duration) return;

        let cancelled = false;

        const video = thumbnailVideoRef.current;

        if (!video) return;

        const canvas = document.createElement("canvas");

        canvas.width = 160;

        canvas.height = 90;

        const context = canvas.getContext("2d");

        if (!context) return;

        setLoadingThumbnails(true);

        const metadataLoaded = waitFor(video, "loadedmetadata");

        video.src = source;

        video.load();

        void (async () => {
            try {
                await metadataLoaded;

                const count = Math.min(32, Math.max(12, Math.ceil(duration * 6)));

                const frames: Thumbnail[] = [];

                for (let index = 0; index < count && !cancelled; index += 1) {
                    const time = duration * (index / Math.max(1, count - 1));

                    video.currentTime = time;

                    await waitFor(video, "seeked");

                    context.drawImage(video, 0, 0, canvas.width, canvas.height);

                    frames.push({ time, src: canvas.toDataURL("image/jpeg", 0.72) });
                }

                if (!cancelled) setThumbnails(frames);
            } catch {
                if (!cancelled) setThumbnails([]);
            } finally {
                if (!cancelled) setLoadingThumbnails(false);
            }
        })();

        return () => {
            cancelled = true;

            video.pause();

            video.removeAttribute("src");

            video.load();
        };
    }, [duration, open, source]);

    useEffect(() => {
        if (!open) return;

        const video = videoRef.current;

        if (!video) return;

        const onTimeUpdate = () => setCurrentTime(video.currentTime);

        const onPlay = () => setPlaying(true);

        const onPause = () => setPlaying(false);

        video.addEventListener("timeupdate", onTimeUpdate);

        video.addEventListener("play", onPlay);

        video.addEventListener("pause", onPause);

        return () => {
            video.removeEventListener("timeupdate", onTimeUpdate);

            video.removeEventListener("play", onPlay);

            video.removeEventListener("pause", onPause);
        };
    }, [open]);

    const togglePlayback = useCallback(() => {
        const video = videoRef.current;

        if (!video) return;

        if (video.paused) void video.play();
        else video.pause();
    }, []);

    const saveCurrentFrame = useCallback(() => {
        setSavedFrames((frames) => (frames.some((frame) => Math.abs(frame - currentTime) < 0.03) ? frames : [...frames, currentTime]));
    }, [currentTime]);

    useEffect(() => {
        if (!open) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLInputElement) return;

            if (event.code === "Space") {
                event.preventDefault();

                togglePlayback();
            } else if (event.key === "ArrowLeft") {
                event.preventDefault();

                seek(currentTime - (event.shiftKey ? 1 : 1 / 30));
            } else if (event.key === "ArrowRight") {
                event.preventDefault();

                seek(currentTime + (event.shiftKey ? 1 : 1 / 30));
            } else if (event.key === "Home") {
                seek(0);
            } else if (event.key === "End") {
                seek(duration);
            } else if (event.key.toLowerCase() === "s") {
                saveCurrentFrame();
            } else if (event.key === "Enter") {
                onCapture(currentTime);
            }
        };

        window.addEventListener("keydown", onKeyDown);

        return () => window.removeEventListener("keydown", onKeyDown);
    }, [currentTime, duration, onCapture, open, saveCurrentFrame, seek, togglePlayback]);

    const timelineStyle = useMemo(() => ({ background: token.colorFillTertiary, borderColor: token.colorBorderSecondary }), [token]);

    const progress = duration ? `${(currentTime / duration) * 100}%` : "0%";

    return (
        <Modal open={open && Boolean(source)} onCancel={onClose} footer={null} width={1280} centered className="canvas-video-frame-capture-modal" styles={{ body: { padding: 0 } }}>
            <div className="overflow-hidden rounded-xl" style={{ background: token.colorBgContainer, color: token.colorText }}>
                <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: token.colorBorderSecondary }}>
                    <div>
                        <div className="text-base font-semibold">{t("canvas.videoFrames.dialogTitle")}</div>

                        <div className="text-xs opacity-60">{t("canvas.videoFrames.dialogHint")}</div>
                    </div>

                    <div className="rounded-lg px-3 py-1.5 text-xs" style={{ background: token.colorFillSecondary }}>
                        {videoRef.current?.videoWidth || "—"} × {videoRef.current?.videoHeight || "—"}
                    </div>
                </div>

                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="min-w-0">
                        <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl" style={{ background: "#0d0d10" }}>
                            <video ref={videoRef} className="max-h-[62vh] max-w-full object-contain" playsInline preload="auto" onClick={togglePlayback} />

                            <button
                                type="button"
                                aria-label={playing ? t("canvas.videoFrames.pause") : t("canvas.videoFrames.play")}
                                title={playing ? t("canvas.videoFrames.pause") : t("canvas.videoFrames.play")}
                                onClick={togglePlayback}
                                className="group absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-black/70 text-white shadow-[0_10px_28px_rgba(0,0,0,.35)] backdrop-blur-md transition-[opacity,transform,background-color,border-color] duration-200 hover:scale-105 hover:bg-black/85 hover:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95"
                                style={{ opacity: playing ? 0 : 1, pointerEvents: playing ? "none" : "auto" }}
                            >
                                <span className="absolute inset-1 rounded-full border border-white/20" aria-hidden="true" />

                                {playing ? <Pause className="relative size-5" strokeWidth={2.25} /> : <Play className="relative ml-0.5 size-5" strokeWidth={2.25} />}
                            </button>

                            <div className="absolute left-3 top-3 rounded-md bg-black/65 px-2 py-1 font-mono text-xs text-white">{formatTime(currentTime)}</div>
                        </div>

                        <div className="mt-3 rounded-xl border p-3" style={timelineStyle}>
                            <div className="mb-2 flex items-center justify-between text-xs opacity-70">
                                <span>{formatTime(currentTime)}</span>
                                <span>/ {formatTime(duration)}</span>
                            </div>

                            <div className="relative h-20 overflow-hidden rounded-lg bg-black/30">
                                <div className="absolute inset-0 flex">
                                    {thumbnails.map((thumbnail) => (
                                        <button
                                            type="button"
                                            key={thumbnail.time}
                                            aria-label={formatTime(thumbnail.time)}
                                            onClick={() => seek(thumbnail.time)}
                                            className="h-full min-w-0 flex-1 overflow-hidden"
                                        >
                                            <img src={thumbnail.src} alt="" className="h-full w-full object-cover" />
                                        </button>
                                    ))}
                                </div>

                                {loadingThumbnails && !thumbnails.length ? (
                                    <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">{t("canvas.videoFrames.loadingTimeline")}</div>
                                ) : null}

                                <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.45)]" style={{ left: progress }}>
                                    <div className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-white" />
                                </div>

                                <input
                                    aria-label={t("canvas.videoFrames.timeline")}
                                    type="range"
                                    min={0}
                                    max={duration || 0}
                                    step={0.001}
                                    value={Math.min(currentTime, duration || 0)}
                                    onChange={(event) => seek(Number(event.target.value))}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                />
                            </div>

                            <div className="mt-2 flex items-center justify-between text-[11px] opacity-50">
                                <span>00:00.00</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                            <Button aria-label={t("canvas.videoFrames.first")} icon={<SkipBack className="size-4" />} onClick={() => seek(0)} />

                            <Button aria-label={t("canvas.videoFrames.stepBack")} icon={<ChevronLeft className="size-4" />} onClick={() => seek(currentTime - 1)} />

                            <Button
                                aria-label={playing ? t("canvas.videoFrames.pause") : t("canvas.videoFrames.play")}
                                type="primary"
                                icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                                onClick={togglePlayback}
                            />

                            <Button aria-label={t("canvas.videoFrames.stepForward")} icon={<ChevronRight className="size-4" />} onClick={() => seek(currentTime + 1)} />

                            <Button aria-label={t("canvas.videoFrames.last")} icon={<SkipForward className="size-4" />} onClick={() => seek(duration)} />

                            <Button icon={<Plus className="size-4" />} onClick={saveCurrentFrame}>
                                {t("canvas.videoFrames.saveFrame")} <span className="opacity-50">S</span>
                            </Button>
                        </div>

                        <div className="mt-2 text-center text-[11px] opacity-50">{t("canvas.videoFrames.keyboardHint")}</div>
                    </div>

                    <aside className="space-y-3">
                        <div className="rounded-xl border p-4" style={timelineStyle}>
                            <div className="mb-2 text-sm font-semibold">{t("canvas.videoFrames.jumpTitle")}</div>

                            <div className="flex gap-2">
                                <Input
                                    value={jumpTime}
                                    placeholder="00:01.72"
                                    onChange={(event) => setJumpTime(event.target.value)}
                                    onPressEnter={() => {
                                        const value = parseTime(jumpTime);
                                        if (Number.isFinite(value)) seek(value);
                                    }}
                                />
                                <Button
                                    onClick={() => {
                                        const value = parseTime(jumpTime);
                                        if (Number.isFinite(value)) seek(value);
                                    }}
                                >
                                    {t("canvas.videoFrames.jump")}
                                </Button>
                            </div>

                            <dl className="mt-4 space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <dt className="opacity-60">{t("canvas.videoFrames.duration")}</dt>
                                    <dd>{formatTime(duration)}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="opacity-60">{t("canvas.videoFrames.currentTime")}</dt>
                                    <dd>{formatTime(currentTime)}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="opacity-60">{t("canvas.videoFrames.output")}</dt>
                                    <dd>PNG · {t("canvas.videoFrames.originalSize")}</dd>
                                </div>
                            </dl>
                        </div>

                        <div className="rounded-xl border p-3" style={timelineStyle}>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-sm font-semibold">{t("canvas.videoFrames.savedTitle", { count: savedFrames.length })}</span>
                                {savedFrames.length ? (
                                    <Button type="text" size="small" icon={<Trash2 className="size-3.5" />} onClick={() => setSavedFrames([])}>
                                        {t("common.clear")}
                                    </Button>
                                ) : null}
                            </div>

                            {savedFrames.length ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {savedFrames.map((frame) => {
                                        const thumbnail = thumbnails.reduce<Thumbnail | undefined>(
                                            (best, item) => (!best || Math.abs(item.time - frame) < Math.abs(best.time - frame) ? item : best),
                                            undefined,
                                        );
                                        return (
                                            <button
                                                type="button"
                                                key={frame}
                                                onClick={() => seek(frame)}
                                                className="overflow-hidden rounded-lg border text-left"
                                                style={{ borderColor: token.colorBorderSecondary }}
                                            >
                                                {thumbnail ? <img src={thumbnail.src} alt="" className="h-16 w-full object-cover" /> : <div className="h-16 bg-black/30" />}
                                                <div className="px-2 py-1 text-xs">{formatTime(frame)}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex min-h-40 items-center justify-center whitespace-pre-line rounded-lg text-center text-xs opacity-50">{t("canvas.videoFrames.savedEmpty")}</div>
                            )}
                        </div>
                    </aside>
                </div>

                <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: token.colorBorderSecondary }}>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={() => onCapture(currentTime)}>
                        {t("canvas.videoFrames.captureCurrent")}
                    </Button>
                </div>
            </div>

            <video ref={thumbnailVideoRef} className="hidden" muted playsInline preload="metadata" />
        </Modal>
    );
}
