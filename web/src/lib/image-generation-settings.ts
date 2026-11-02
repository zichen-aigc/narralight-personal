import { resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export function effectiveImageGenerationCount(config: AiConfig, model = config.imageModel || config.model, maxCount = 15) {
    if (resolveModelChannel(config, model).provider === "888api") return 1;
    return Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
}

export function buildImageBatchConfig(config: AiConfig, count: number): AiConfig {
    return { ...config, count: String(count) };
}

export function buildImageSlotConfig(config: AiConfig): AiConfig {
    return { ...config, count: "1" };
}
