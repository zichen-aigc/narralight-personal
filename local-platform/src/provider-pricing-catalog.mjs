const MICRO = 1_000_000;

const APIMART_CHANNEL_ID = "apimart";

const usd = (value) => Math.round(Number(value) * MICRO);

function video(modelId, displayName, family, version, rates, options = {}) {
    return {
        provider: "apimart",
        channelId: APIMART_CHANNEL_ID,
        modelId,
        displayName,
        family,
        version,
        capability: "video",
        operation: "video.generate",
        billingUnit: "second",
        currency: "USD",
        rates,
        ...options,
    };
}

function image(modelId, displayName, family, version, rates, options = {}) {
    return {
        provider: "apimart",
        channelId: APIMART_CHANNEL_ID,
        modelId,
        displayName,
        family,
        version,
        capability: "image",
        operation: "image.generate",
        billingUnit: "image",
        currency: "USD",
        rates,
        ...options,
    };
}

function token(modelId, displayName, family, version, capability, inputPerMillion, outputPerMillion, options = {}) {
    return {
        provider: "apimart",
        channelId: APIMART_CHANNEL_ID,
        modelId,
        displayName,
        family,
        version,
        capability,
        operation: capability === "audio" ? "audio.generate" : capability === "image" ? "image.generate" : "text.generate",
        billingUnit: "million_tokens",
        currency: "USD",
        tokenRates: { input: usd(inputPerMillion), output: usd(outputPerMillion) },
        ...options,
    };
}

const APIMART_MODELS = [
    image("gpt-image-2", "GPT Image 2", "GPT Image", "2", { default: usd(0.0085), "1k": usd(0.0085), "2k": usd(0.014), "4k": usd(0.021) }),
    token("gpt-image-2-official", "GPT Image 2 官方版", "GPT Image", "2 Official", "image", 6.4, 24, {
        inputVariant: "image_input",
        outputVariant: "image_output",
        textInputPerMillion: usd(4),
        cachedTextInputPerMillion: usd(1),
        cachedImageInputPerMillion: usd(1.6),
        differentiatedUsage: "gpt_image",
    }),
    image("gemini-3-pro-image-preview", "Gemini 3 Pro Image", "Gemini Image", "3 Pro", { default: usd(0.03), "1k": usd(0.03), "2k": usd(0.03), "4k": usd(0.04) }),
    image("gemini-3.1-flash-image-preview", "Gemini 3.1 Flash Image", "Gemini Image", "3.1 Flash", { default: usd(0.015), "0.5k": usd(0.015), "1k": usd(0.015), "2k": usd(0.02), "4k": usd(0.025) }),
    token("gemini-3.1-flash-lite-image", "Gemini 3.1 Flash Lite Image", "Gemini Image", "3.1 Flash Lite", "image", 0.2, 24, {
        outputVariant: "image_output",
        textOutputPerMillion: usd(1.2),
        differentiatedUsage: "gemini_image",
    }),
    image("midjourney", "Midjourney", "Midjourney", "Current", { default: usd(0.04504), fast: usd(0.05504), turbo: usd(0.1) }, { billingUnit: "generation" }),
    image("doubao-seedance-4-5", "Seedream 4.5", "Seedream", "4.5", { default: usd(0.026) }, { aliases: ["doubao-seedream-4-5", "doubao-seedream-4-5-251128"] }),
    image("doubao-seedream-5-0-lite", "Seedream 5.0 Lite", "Seedream", "5.0 Lite", { default: usd(0.02275) }),
    image(
        "doubao-seedream-5-0-pro",
        "Seedream 5.0 Pro",
        "Seedream",
        "5.0 Pro",
        { default: usd(0.036), "1k": usd(0.02925), "1.5k": usd(0.02925), "2k": usd(0.0585), "1k-layer": usd(0.014625), "2k-layer": usd(0.02925) },
        {
            aliases: ["seedream-5-0-pro", "seedream-5.0-pro"],
            listRates: { default: usd(0.045), "1k": usd(0.0365625), "1.5k": usd(0.0365625), "2k": usd(0.073125) },
            inputImagePrice: usd(0.00195),
            inputImageFirstFree: true,
            priceConflict: true,
        },
    ),

    video(
        "doubao-seedance-2.5",
        "Seedance 2.5",
        "Seedance",
        "2.5",
        { "480p": usd(0.1201), "720p": usd(0.27), "1080p": usd(0.4811), "480p-input": usd(0.072), "720p-input": usd(0.162), "1080p-input": usd(0.2874) },
        { aliases: ["seedance-2.5"] },
    ),
    video("doubao-seedance-2.0", "Seedance 2.0", "Seedance", "2.0", {
        "480p": usd(0.0825),
        "720p": usd(0.1775),
        "1080p": usd(0.443),
        "4k": usd(0.9025),
        "480p-input": usd(0.05),
        "720p-input": usd(0.1073),
        "1080p-input": usd(0.2696),
        "4k-input": usd(0.5554),
    }),
    video("doubao-seedance-2.0-fast", "Seedance 2.0 Fast", "Seedance", "2.0 Fast", { "480p": usd(0.03984), "720p": usd(0.0856), "480p-input": usd(0.02368), "720p-input": usd(0.05128) }),
    video("doubao-seedance-2.0-mini", "Seedance 2.0 Mini", "Seedance", "2.0 Mini", { "480p": usd(0.0132), "720p": usd(0.0286), "480p-input": usd(0.008), "720p-input": usd(0.0173) }),
    video("doubao-seedance-1-5-pro", "Seedance 1.5 Pro", "Seedance", "1.5 Pro", { "480p": usd(0.0255), "720p": usd(0.055), "1080p": usd(0.135) }),
    video("MiniMax-H3", "MiniMax H3", "MiniMax", "H3", { "768p": usd(0.0714), "2k": usd(0.1143), default: usd(0.0714) }, { inputImagePrice: usd(0.0286), inputImageFreeCount: 5 }),
    video("kling-v3", "Kling 3", "Kling", "3", { default: usd(0.0672), pro: usd(0.0896), sound: usd(0.1008), "pro-sound": usd(0.1344), "4k": usd(0.42856) }),
    video("wan2.7", "Wan 2.7", "Wan", "2.7", { default: usd(0.0664), "1080p": usd(0.1096) }),
    video("veo3.1-fast", "Veo 3.1 Fast", "Veo", "3.1 Fast", { default: usd(0.14), "4k": usd(0.64) }),
    video("veo3.1-quality", "Veo 3.1 Quality", "Veo", "3.1 Quality", { default: usd(1), "4k": usd(1.5) }),
    video("veo3.1-lite", "Veo 3.1 Lite", "Veo", "3.1 Lite", { default: usd(0.07), "4k": usd(0.57) }),
    video("grok-imagine-1.5-video-apimart", "Grok 1.5 视频", "Grok", "1.5", { "480p": usd(0.0102), "720p": usd(0.01912), default: usd(0.0102) }),

    token("gpt-5", "GPT-5", "GPT", "5", "text", 1, 8),
    token("gpt-5.1", "GPT-5.1", "GPT", "5.1", "text", 1, 8),
    token("claude-opus-4-8", "Claude Opus 4.8", "Claude Opus", "4.8", "text", 4, 20),
    token("claude-opus-4-7", "Claude Opus 4.7", "Claude Opus", "4.7", "text", 4, 20),
    token("claude-opus-4-6", "Claude Opus 4.6", "Claude Opus", "4.6", "text", 4, 20),
    token("gemini-3.5-flash", "Gemini 3.5 Flash", "Gemini", "3.5 Flash", "text", 1.2, 7.2),
    token("gemini-3.1-pro-preview", "Gemini 3.1 Pro", "Gemini", "3.1 Pro", "text", 1.6, 9.6),
    token("gemini-3-pro-preview-thinking", "Gemini 3 Pro Thinking", "Gemini", "3 Pro Thinking", "text", 1.6, 9.6),
    token("gemini-3-pro-preview", "Gemini 3 Pro", "Gemini", "3 Pro", "text", 1.6, 9.6),
    token("gemini-3-flash-preview", "Gemini 3 Flash", "Gemini", "3 Flash", "text", 0.4, 2.4),
    token("gpt-4o-mini-tts", "GPT-4o Mini TTS", "GPT Audio", "4o Mini TTS", "audio", 0.48, 1.92),
];

const MODEL_INDEX = new Map();
for (const model of APIMART_MODELS) {
    MODEL_INDEX.set(model.modelId.toLowerCase(), model);
    for (const alias of model.aliases || []) MODEL_INDEX.set(alias.toLowerCase(), model);
}

export function parseUsdCnyRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 1 || rate > 20) return null;
    return Math.round(rate * MICRO);
}
