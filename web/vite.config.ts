import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { portalContainerGuard } from "./portal-container-guard.mjs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const webPort = Number(process.env.INFINITE_CANVAS_WEB_PORT || 3000);
const localPlatformTarget = loopbackTarget(process.env.INFINITE_CANVAS_PLATFORM_URL || "http://127.0.0.1:17372");

function loopbackTarget(value: string) {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Local platform proxy target must use HTTP on a loopback address");
    return url.origin;
}

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const buildIndex = () => {
        let localUrls: string[] = [];
        try {
            localUrls = readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
            const manifestPath = resolve(pluginsDir, "official-plugins.json");
            if (!existsSync(manifestPath)) return { version: 1, trusted: [], localUrls };
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown; plugins?: unknown };
            if (manifest.version !== 1 || !Array.isArray(manifest.plugins)) return { version: 1, trusted: [], localUrls };
            const trusted = [] as Array<{ id: string; name: string; version: string; description?: string; url: string; sha256: string }>;
            const ids = new Set<string>();
            const urls = new Set<string>();
            for (const entry of manifest.plugins) {
                if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid plugin manifest entry");
                const value = entry as Record<string, unknown>;
                const id = typeof value.id === "string" ? value.id : "";
                const name = typeof value.entry === "string" ? value.entry : "";
                const expectedHash = typeof value.sha256 === "string" ? value.sha256.toLowerCase() : "";
                const path = resolve(pluginsDir, name);
                const url = `/plugins/${name}`;
                if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.js$/.test(name) || !/^[a-f0-9]{64}$/.test(expectedHash) || ids.has(id) || urls.has(url) || !existsSync(path))
                    throw new Error("invalid plugin manifest identity");
                const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
                if (actualHash !== expectedHash) throw new Error("plugin source hash mismatch");
                ids.add(id);
                urls.add(url);
                trusted.push({
                    id,
                    name: typeof value.name === "string" ? value.name : id,
                    version: typeof value.version === "string" ? value.version : "0.0.0",
                    description: typeof value.description === "string" ? value.description : undefined,
                    url,
                    sha256: actualHash,
                });
            }
            return { version: 1, trusted, localUrls };
        } catch {
            return { version: 1, trusted: [], localUrls };
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(buildIndex(), null, 4) + "\n");
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(buildIndex(), null, 4) + "\n" });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    cacheDir: process.env.INFINITE_CANVAS_VITE_CACHE_DIR || "node_modules/.vite",
    plugins: [portalContainerGuard(), react(), localPluginsManifest()],
    optimizeDeps: { exclude: ["@rc-component/portal"] },
    server: {
        host: "127.0.0.1",
        port: webPort,
        proxy: {
            "/api/local": localPlatformTarget,
        },
    },
    preview: {
        host: "127.0.0.1",
        port: webPort,
        proxy: {
            "/api/local": localPlatformTarget,
        },
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
