import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { ProxyAgent } from "undici";

export const APIMART_EGRESS_HOSTS = new Set(["apimart.ai", "api.apimart.ai", "upload.apimart.ai", "getapib.org"]);
const configError = () => Object.assign(new Error("APIMart 专用网络出口配置无效"), { code: "apimart_egress_config_invalid", status: 503 });

export function readApimartEgress(dataRoot) {
    if (!dataRoot) return null;
    let text;
    try { text = readFileSync(join(dataRoot, "operator-network", "apimart-egress.json"), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw configError(); }
    try {
        if (text.length > 4096) throw configError();
        const config = JSON.parse(text.replace(/^\uFEFF/, ""));
        if (config.version !== 1 || Object.keys(config).some((key) => !["version", "proxyUrl"].includes(key))) throw configError();
        const url = new URL(config.proxyUrl);
        const [a, b] = url.hostname.split(".").map(Number);
        const privateV4 = isIP(url.hostname) === 4 && (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 127);
        if (url.protocol !== "http:" || !privateV4 || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw configError();
        return url.origin;
    } catch { throw configError(); }
}

// Keep Node's original fetch and environment routing for every other provider.
// Explicit dispatchers preserve streaming uploads, TLS verification and abort behavior.
export function createApimartEgressFetch({ fallback = (...args) => globalThis.fetch(...args), makeDispatcher = (uri) => new ProxyAgent({ uri }) } = {}) {
    const agents = new Map();
    const prepare = (input, { dataRoot, provider } = {}) => {
        const target = new URL(input instanceof Request ? input.url : input);
        if (provider !== "apimart" || target.protocol !== "https:" || target.port && target.port !== "443" || !APIMART_EGRESS_HOSTS.has(target.hostname)) return (init) => fallback(input, init);
        const proxy = readApimartEgress(dataRoot);
        if (!proxy) return (init) => fallback(input, init);
        if (!agents.has(proxy)) agents.set(proxy, makeDispatcher(proxy));
        const dispatcher = agents.get(proxy);
        return (init) => fallback(input, { ...init, dispatcher });
    };
    const fetchRoute = async (input, init, context) => prepare(input, context)(init);
    fetchRoute.prepare = prepare;
    fetchRoute.close = async () => { await Promise.all([...agents.values()].map((agent) => agent.close())); agents.clear(); };
    return fetchRoute;
}

export const fetchApimartRoute = createApimartEgressFetch();
