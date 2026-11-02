import { normalizeSeedanceRatio } from "@/lib/seedance-video";

export function normalize888ApiVideoSettings(model: string | undefined, size: string | undefined, duration: string | number | undefined) {
    const economy = String(model || "").endsWith("seedance2.0-933-economy");
    const accepted = economy ? ["16:9", "9:16", "1:1"] : ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
    const candidate = normalizeSeedanceRatio(size || "");
    const ratio = accepted.includes(candidate) ? candidate : accepted[0];
    const raw = Number(duration);
    const seconds = economy ? 15 : Number.isSafeInteger(raw) ? Math.max(2, Math.min(30, raw)) : 6;
    return { seconds, ratio, economy };
}
