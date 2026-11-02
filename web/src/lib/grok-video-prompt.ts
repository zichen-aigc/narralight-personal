export type GrokPromptReference = { nodeId: string; kind: "image" | "video" | "audio" | "text"; active?: boolean };

export function grokReferenceBatchIssue(current: { images: number; videos: number; audios: number }, incoming: { images: number; videos: number; audios: number }, limits: { images: number; videos: number; audios: number }) {
    for (const [kind, label] of [["images", "图片"], ["videos", "视频"], ["audios", "音频"]] as const) {
        if (current[kind] + incoming[kind] > limits[kind]) return `本次选择的${label}超过当前模式可接收的数量（最多${limits[kind]}份）；这批素材未加入，请减少数量或切换模式。`;
    }
    return "";
}

// The labels are ordinary request text, not a provider-specific binding protocol.
// Always derive them from the same final ordered array used for submission.
export function compileGrokReferencePrompt(prompt: string, references: GrokPromptReference[]) {
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    const labels = new Map(references.filter((ref) => ref.active !== false).map((ref) => {
        const index = ++counts[ref.kind];
        return [ref.nodeId, ref.kind === "image" ? `第${index}张参考图` : ref.kind === "video" ? `第${index}段源视频` : ref.kind === "audio" ? `第${index}段音频` : `文字参考${index}`];
    }));
    const result = prompt.replace(/@\[node:([^\]]+)\]/g, (_, id: string) => {
        const label = labels.get(id);
        if (!label) throw new Error("提示词引用的素材已断开或被移除，请重新选择该素材后再生成。");
        return label;
    });
    if (/<IMAGE_\d+>|(?:^|[\s，。；！？：、（【《“‘(])@[^@\s，。；！？：、（）【】《》“”‘’<>()]+/iu.test(result)) {
        throw new Error("请通过素材引用按钮选择图片，或用普通文字说明参考用途；当前渠道未确认原生 @ / <IMAGE_n> 语法。");
    }
    return result;
}
