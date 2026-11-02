import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";

const DEFAULT_CLOUDFLARED_PATH = "";
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const PROXY_ENV_NAMES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const CLOUDFLARE_BYPASS_PATTERN = /^(?:\.)?(?:trycloudflare\.com|cloudflare\.com|argotunnel\.com)$/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}

export function directRelayEnvironment(environment = process.env) {
    const result = { ...environment };
    for (const name of PROXY_ENV_NAMES) delete result[name];
    return result;
}

export function apimartRelayEnvironment(environment = process.env) {
    const result = { ...environment };
    for (const name of ["NO_PROXY", "no_proxy"]) {
        if (!(name in result)) continue;
        result[name] = String(result[name] || "").split(",").map((item) => item.trim()).filter((item) => item && !CLOUDFLARE_BYPASS_PATTERN.test(item)).join(",");
    }
    return result;
}

function sendFile(req, res, path, mimeType) {
    const size = statSync(path).size;
    const headers = { "content-type": mimeType || "application/octet-stream", "content-length": size, "accept-ranges": "bytes", "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" };
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (!req.headers.range) {
        res.writeHead(200, headers);
        return req.method === "HEAD" ? res.end() : createReadStream(path).pipe(res);
    }
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
        res.writeHead(416, { "content-range": `bytes */${size}` });
        return res.end();
    }
    res.writeHead(206, { ...headers, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}` });
    return req.method === "HEAD" ? res.end() : createReadStream(path, { start, end }).pipe(res);
}

function closeServer(server) {
    try { server.close(); } catch {}
}

export function createVolcAssetRelayManager(options = {}) {
    const cloudflaredPath = String(options.cloudflaredPath || process.env.INFINITE_CANVAS_CLOUDFLARED_PATH || DEFAULT_CLOUDFLARED_PATH);
    const fetchImpl = options.fetchImpl || fetch;
    const spawnImpl = options.spawnImpl || spawn;
    const environment = options.environment || process.env;
    const ttlMs = Math.max(60_000, Number(options.ttlMs || 2 * 60 * 60 * 1000));
    const probeConcurrency = Math.max(1, Math.min(30, Number(options.probeConcurrency || 30)));
    const probeAttempts = Math.max(1, Math.min(15, Number(options.probeAttempts || 15)));
    const probeDelayMs = Math.max(0, Number(options.probeDelayMs ?? 1_000));
    const apimartProxyRequired = options.apimartProxyRequired ?? environment.INFINITE_CANVAS_APIMART_MEDIA_RELAY_REQUIRE_PROXY === "true";
    const active = new Map();
    const aliases = new Map();

    const closeEntry = (key) => {
        const entry = active.get(key);
        if (!entry) return false;
        active.delete(key);
        for (const alias of entry.members || []) aliases.delete(alias);
        if (entry.timer) clearTimeout(entry.timer);
        closeServer(entry.server);
        try { entry.child.kill(); } catch {}
        return true;
    };

    const stop = (key) => {
        const groupKey = aliases.get(key);
        if (!groupKey) return closeEntry(key);
        const entry = active.get(groupKey);
        aliases.delete(key);
        entry?.members?.delete(key);
        return entry?.members?.size ? true : closeEntry(groupKey);
    };

    const start = async ({ key, filePath, mimeType, fileName }) => {
        const current = active.get(key);
        if (current?.publicUrl) return { publicUrl: current.publicUrl, reused: true };
        if (!existsSync(cloudflaredPath)) throw Object.assign(new Error("未安装火山素材临时公网通道"), { code: "volc_asset_relay_missing" });
        if (!existsSync(filePath) || !statSync(filePath).isFile()) throw Object.assign(new Error("临时公网通道找不到本机素材"), { code: "volc_asset_relay_file_missing" });

        const token = randomBytes(32).toString("hex");
        const safeName = encodeURIComponent(String(fileName || "asset").replace(/[\\/:*?\"<>|\u0000-\u001f]/g, "-").slice(0, 96) || "asset");
        const route = `/${token}/${safeName}`;
        const server = createServer((req, res) => {
            const url = new URL(req.url || "/", "http://127.0.0.1");
            if (url.pathname !== route || url.search || !["GET", "HEAD"].includes(req.method || "")) {
                res.writeHead(["GET", "HEAD"].includes(req.method || "") ? 404 : 405, { "cache-control": "no-store" });
                return res.end();
            }
            try { return sendFile(req, res, filePath, mimeType); }
            catch { res.writeHead(404, { "cache-control": "no-store" }); return res.end(); }
        });
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            closeServer(server);
            throw Object.assign(new Error("临时公网通道本机端口不可用"), { code: "volc_asset_relay_listen_failed" });
        }

        const child = spawnImpl(cloudflaredPath, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${address.port}`], { env: directRelayEnvironment(environment), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const entry = { child, server, publicUrl: "", timer: null };
        active.set(key, entry);
        child.once("exit", () => {
            if (active.get(key)?.child === child) stop(key);
        });

        try {
            const tunnelBase = await new Promise((resolve, reject) => {
                let output = "";
                const timeout = setTimeout(() => reject(Object.assign(new Error("临时公网通道启动超时"), { code: "volc_asset_relay_start_timeout" })), 45_000);
                const inspect = (chunk) => {
                    output = `${output}${chunk.toString("utf8")}`.slice(-16_384);
                    const match = output.match(TUNNEL_URL_PATTERN);
                    if (!match) return;
                    clearTimeout(timeout);
                    resolve(match[0]);
                };
                child.stdout.on("data", inspect);
                child.stderr.on("data", inspect);
                child.once("error", () => {
                    clearTimeout(timeout);
                    reject(Object.assign(new Error("临时公网通道进程启动失败"), { code: "volc_asset_relay_process_failed" }));
                });
                child.once("exit", () => {
                    clearTimeout(timeout);
                    reject(Object.assign(new Error("临时公网通道提前退出"), { code: "volc_asset_relay_exited" }));
                });
            });
            const publicUrl = `${tunnelBase}${route}`;
            let verified = false;
            for (let attempt = 0; attempt < probeAttempts; attempt += 1) {
                try {
                    const response = await fetchImpl(publicUrl, { headers: { range: "bytes=0-0" }, signal: AbortSignal.timeout(10_000) });
                    if (response.status === 206) { verified = true; break; }
                } catch {}
                await delay(probeDelayMs);
            }
            if (!verified) throw Object.assign(new Error("临时公网素材地址无法从公网读取"), { code: "volc_asset_relay_public_check_failed" });
            entry.publicUrl = publicUrl;
            entry.timer = setTimeout(() => stop(key), ttlMs);
            entry.timer.unref?.();
            return { publicUrl, reused: false };
        } catch (error) {
            stop(key);
            throw error;
        }
    };

    const startGroupRelay = async ({ key, files, mode }) => {
        const current = active.get(key);
        if (current?.publicUrls) return { publicUrls: current.publicUrls, items: current.items, reused: true };
        const volc = mode === "volcengine";
        const maxFiles = volc ? 100 : 20;
        const code = (suffix) => volc ? `volc_asset_relay_${suffix}` : `asset_relay_${suffix}`;
        if (!existsSync(cloudflaredPath)) throw Object.assign(new Error("未安装素材临时公网通道"), { code: "asset_relay_missing" });
        if (!Array.isArray(files) || !files.length || files.length > maxFiles) throw Object.assign(new Error("临时公网通道素材数量无效"), { code: code("group_invalid") });
        if (!volc && apimartProxyRequired && !environment.HTTPS_PROXY && !environment.https_proxy && !environment.HTTP_PROXY && !environment.http_proxy) throw Object.assign(new Error("APIMart 素材中继需要动态代理桥"), { code: "apimart_asset_relay_proxy_missing" });
        for (const file of files) if (!existsSync(file.filePath) || !statSync(file.filePath).isFile()) throw Object.assign(new Error("临时公网通道找不到本机素材"), { code: code("file_missing") });

        const routes = files.map((file) => {
            const token = randomBytes(32).toString("hex");
            const safeName = encodeURIComponent(String(file.fileName || "asset").replace(/[\\/:*?\"<>|\u0000-\u001f]/g, "-").slice(0, 96) || "asset");
            return { ...file, route: `/${token}/${safeName}` };
        });
        const server = createServer((req, res) => {
            const url = new URL(req.url || "/", "http://127.0.0.1");
            const route = !url.search && routes.find((item) => item.route === url.pathname);
            if (!route || !["GET", "HEAD"].includes(req.method || "")) {
                res.writeHead(["GET", "HEAD"].includes(req.method || "") ? 404 : 405, { "cache-control": "no-store" });
                return res.end();
            }
            try { return sendFile(req, res, route.filePath, route.mimeType); }
            catch { res.writeHead(404, { "cache-control": "no-store" }); return res.end(); }
        });
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            closeServer(server);
            throw Object.assign(new Error("临时公网通道本机端口不可用"), { code: code("listen_failed") });
        }
        const child = spawnImpl(cloudflaredPath, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${address.port}`], { env: volc ? directRelayEnvironment(environment) : apimartRelayEnvironment(environment), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const members = new Set(volc ? files.map((file) => String(file.key || "")).filter(Boolean) : []);
        const entry = { child, server, publicUrls: null, items: null, members, timer: null };
        for (const member of members) aliases.set(member, key);
        active.set(key, entry);
        child.once("exit", () => { if (active.get(key)?.child === child) stop(key); });
        try {
            const tunnelBase = await new Promise((resolve, reject) => {
                let output = "";
                const timeout = setTimeout(() => reject(Object.assign(new Error("临时公网通道启动超时"), { code: code("start_timeout") })), 45_000);
                const inspect = (chunk) => {
                    output = `${output}${chunk.toString("utf8")}`.slice(-16_384);
                    const match = output.match(TUNNEL_URL_PATTERN);
                    if (!match) return;
                    clearTimeout(timeout);
                    resolve(match[0]);
                };
                child.stdout.on("data", inspect);
                child.stderr.on("data", inspect);
                child.once("error", () => { clearTimeout(timeout); reject(Object.assign(new Error("临时公网通道进程启动失败"), { code: code("process_failed") })); });
                child.once("exit", () => { clearTimeout(timeout); reject(Object.assign(new Error("临时公网通道提前退出"), { code: code("exited") })); });
            });
            const publicUrls = routes.map((item) => `${tunnelBase}${item.route}`);
            const items = await mapWithConcurrency(publicUrls, probeConcurrency, async (publicUrl, index) => {
                let verified = false;
                for (let attempt = 0; attempt < probeAttempts; attempt += 1) {
                    try {
                        const response = await fetchImpl(publicUrl, { headers: { range: "bytes=0-0" }, signal: AbortSignal.timeout(10_000) });
                        if (response.status === 206) { verified = true; break; }
                    } catch {}
                    await delay(probeDelayMs);
                }
                if (!verified) return { key: files[index].key, error: "临时公网素材地址无法从公网读取", code: code("public_check_failed") };
                return { key: files[index].key, publicUrl };
            });
            if (!volc) {
                const failed = items.find((item) => item.error);
                if (failed) throw Object.assign(new Error(failed.error), { code: failed.code });
            }
            entry.publicUrls = publicUrls;
            entry.items = items;
            entry.timer = setTimeout(() => stop(key), ttlMs);
            entry.timer.unref?.();
            return { publicUrls, items, reused: false };
        } catch (error) {
            closeEntry(key);
            throw error;
        }
    };

    const startGroup = (input) => startGroupRelay({ ...input, mode: "apimart" });
    const startVolcGroup = (input) => startGroupRelay({ ...input, mode: "volcengine" });

    return {
        available: () => existsSync(cloudflaredPath),
        start,
        startGroup,
        startVolcGroup,
        stop,
        stopPrefix: (prefix) => {
            let stopped = 0;
            for (const key of [...active.keys()]) if (key.startsWith(prefix) && stop(key)) stopped += 1;
            return stopped;
        },
        stopAll: () => { for (const key of [...active.keys()]) closeEntry(key); },
    };
}
