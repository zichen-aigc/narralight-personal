import { ImagePlus, Images, ScanLine, Trash2 } from "lucide-react";
import { Button, Modal, Slider } from "antd";
import { useEffect, useRef, useState } from "react";
import { App, Empty } from "antd";

export type PromptCoverDraft = {
    previewUrl: string;

    storageKey?: string;

    mimeType?: string;

    bytes?: number;

    width?: number;

    height?: number;

    blob?: Blob;
};

export type PromptCoverCandidate = PromptCoverDraft & { id: string; title: string };

export type PromptVideoCoverSource = { url: string; durationMs?: number };

export function PromptCoverPicker({
    value,
    video,
    canvasImages = [],
    onChange,
}: {
    value: PromptCoverDraft | null;
    video?: PromptVideoCoverSource;
    canvasImages?: PromptCoverCandidate[];
    onChange: (value: PromptCoverDraft | null) => void;
}) {
    const { message } = App.useApp();

    const inputRef = useRef<HTMLInputElement>(null);

    const videoRef = useRef<HTMLVideoElement>(null);

    const ownedUrlRef = useRef("");

    const [canvasOpen, setCanvasOpen] = useState(false);

    const [duration, setDuration] = useState(Math.max(0, (video?.durationMs || 0) / 1000));

    const [time, setTime] = useState(0);

    useEffect(
        () => () => {
            if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
        },
        [],
    );

    const own = (blob: Blob) => {
        if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);

        ownedUrlRef.current = URL.createObjectURL(blob);

        return ownedUrlRef.current;
    };

    const chooseFile = (file?: File) => {
        if (!file) return;

        const extensionMime = file.name.toLowerCase().endsWith(".png") ? "image/png" : file.name.toLowerCase().endsWith(".webp") ? "image/webp" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "";

        const mimeType = file.type.toLowerCase() || extensionMime;

        if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return void message.error("请选择 JPG、PNG 或 WebP 图片");

        if (file.size > 64 * 1024 * 1024) return void message.error("封面图片不能超过 64 MB");

        const blob = file.type ? file : new Blob([file], { type: mimeType });

        onChange({ previewUrl: own(blob), blob, mimeType });
    };

    const seek = (next: number) => {
        setTime(next);

        if (videoRef.current) videoRef.current.currentTime = next;
    };

    const capture = () => {
        const media = videoRef.current;

        if (!media?.videoWidth || !media.videoHeight) return void message.warning("视频画面尚未准备好");

        const scale = Math.min(1, 1920 / media.videoWidth);

        const canvas = document.createElement("canvas");

        canvas.width = Math.max(1, Math.round(media.videoWidth * scale));

        canvas.height = Math.max(1, Math.round(media.videoHeight * scale));

        try {
            canvas.getContext("2d")?.drawImage(media, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(
                (blob) => {
                    if (!blob) return void message.error("当前视频帧无法作为封面");

                    onChange({ previewUrl: own(blob), blob, mimeType: blob.type, width: canvas.width, height: canvas.height, bytes: blob.size });

                    message.success("已使用当前视频帧");
                },
                "image/jpeg",
                0.9,
            );
        } catch {
            message.error("这个视频无法在浏览器中抽帧，可改用本地封面图");
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">封面（可选）</span>
                <div className="flex flex-wrap justify-end gap-1">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(event) => {
                            chooseFile(event.target.files?.[0]);
                            event.currentTarget.value = "";
                        }}
                    />
                    <Button type="text" size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => inputRef.current?.click()}>
                        本地上传
                    </Button>
                    {canvasImages.length ? (
                        <Button type="text" size="small" icon={<Images className="size-3.5" />} onClick={() => setCanvasOpen(true)}>
                            画布图片
                        </Button>
                    ) : null}
                    {value ? (
                        <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} onClick={() => onChange(null)}>
                            移除
                        </Button>
                    ) : null}
                </div>
            </div>

            {value ? (
                <img src={value.previewUrl} alt="提示词封面预览" className="max-h-56 w-full rounded-xl object-contain" />
            ) : (
                <div className="grid h-28 place-items-center rounded-xl border border-dashed border-stone-300 text-sm text-stone-400 dark:border-stone-700">添加效果图，查找提示词时更直观</div>
            )}

            {video ? (
                <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                    <video
                        ref={videoRef}
                        src={video.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="max-h-64 w-full rounded-lg bg-black object-contain"
                        onError={() => message.error("视频预览无法读取，可改用本地上传封面图")}
                        onLoadedMetadata={(event) => {
                            const value = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                            setDuration(value);
                            setTime(Math.min(time, value));
                        }}
                    />
                    <div className="mt-3 flex items-center gap-3">
                        <Slider
                            className="min-w-0 flex-1"
                            min={0}
                            max={Math.max(duration, 0.1)}
                            step={0.04}
                            value={Math.min(time, Math.max(duration, 0.1))}
                            tooltip={{ formatter: (value) => `${Number(value || 0).toFixed(1)} 秒` }}
                            onChange={seek}
                        />
                        <span className="w-16 text-right text-xs tabular-nums text-stone-500">{time.toFixed(1)} 秒</span>
                        <Button icon={<ScanLine className="size-3.5" />} onClick={capture}>
                            使用当前帧
                        </Button>
                    </div>
                </div>
            ) : null}

            <Modal open={canvasOpen} title="选择画布图片作为封面" footer={null} width={760} onCancel={() => setCanvasOpen(false)}>
                {canvasImages.length ? (
                    <div className="grid max-h-[62dvh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                        {canvasImages.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className="overflow-hidden rounded-xl border border-stone-200 text-left transition hover:border-stone-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-800"
                                onClick={() => {
                                    onChange(item);
                                    setCanvasOpen(false);
                                }}
                            >
                                <img src={item.previewUrl} alt={item.title} className="aspect-square w-full object-cover" />
                                <span className="block truncate px-2 py-2 text-xs">{item.title}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前画布还没有可用图片" />
                )}
            </Modal>
        </div>
    );
}
