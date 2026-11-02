import type { InstalledPlugin } from "@/stores/canvas/use-plugin-store";
export function localPluginUrls(value: unknown) {
    const urls = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { localUrls?: unknown }).localUrls) ? (value as { localUrls: unknown[] }).localUrls : [];
    return urls.filter((url): url is string => typeof url === "string" && /^\/plugins\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.js$/.test(url));
}
export function mustFetchPluginSource(record: Pick<InstalledPlugin, "local">) {
    return Boolean(record.local);
}
