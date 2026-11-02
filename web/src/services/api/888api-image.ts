// Documented gpt-image-2 sizes: https://888api.xin/docs
export const api888ImageSizeOptions = [
    { size: "1024x1024", label: "1:1 · 1K", width: 1024, height: 1024 },
    { size: "1536x864", label: "16:9 · 1K", width: 1536, height: 864 },
    { size: "864x1536", label: "9:16 · 1K", width: 864, height: 1536 },
    { size: "2048x2048", label: "1:1 · 2K", width: 2048, height: 2048 },
    { size: "2048x1152", label: "16:9 · 2K", width: 2048, height: 1152 },
    { size: "1152x2048", label: "9:16 · 2K", width: 1152, height: 2048 },
    { size: "2880x2880", label: "1:1 · 4K", width: 2880, height: 2880 },
    { size: "3840x2160", label: "16:9 · 4K", width: 3840, height: 2160 },
    { size: "2160x3840", label: "9:16 · 4K", width: 2160, height: 3840 },
] as const;

export function resolve888ApiImageSize(value: string) {
    const size = value.trim().toLowerCase();
    if (!size || size === "auto" || size === "1:1") return "1024x1024";
    if (size === "16:9") return "1536x864";
    if (size === "9:16") return "864x1536";
    return api888ImageSizeOptions.find((option) => option.size === size)?.size;
}
