import { grokVideoPromptGuide } from "@/lib/grok-video-guide";
import { isModelBackendSupported, useBackendModelContracts } from "@/lib/backend-model-contract";

export function GrokVideoPromptGuide({ model, imageCount = 0, color }: { model: string | undefined; imageCount?: number; color?: string }) {
    useBackendModelContracts();
    if (!isModelBackendSupported(model)) return null;
    const guide = grokVideoPromptGuide(model, imageCount);
    if (!guide) return null;
    return <details className="my-2 min-w-0 text-xs leading-5" style={{ color }}>
        <summary className="cursor-pointer py-1 font-medium">提示词写法 · {guide.title}</summary>
        <div className="space-y-2 py-2">
            <p>{guide.limit}</p>
            <p>{guide.structure}</p>
            <p className="select-text">示例：{guide.example}</p>
            <p>{guide.note}</p>
        </div>
    </details>;
}
