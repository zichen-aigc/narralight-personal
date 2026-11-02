import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
const MANAGED_DATA_ROOT = process.env.INFINITE_CANVAS_DATA_ROOT?.trim() ? path.resolve(process.env.INFINITE_CANVAS_DATA_ROOT.trim()) : "";
export const CONFIG_DIR = MANAGED_DATA_ROOT ? path.join(MANAGED_DATA_ROOT, "agent") : path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");
const initializedWorkspaces = new Set<string>();
const configRenameRetryDelaysMs = [5, 15, 35, 75, 150];
const retryableConfigRenameErrors = new Set(["EACCES", "EBUSY", "EPERM"]);

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig };

/** 读取本地 Canvas Agent 配置，不存在时生成默认配置。 */
export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 Canvas Agent 配置写入用户配置目录。 */
export function saveConfig(config: CanvasAgentConfig) {
    writeConfigFile(CONFIG_DIR, CONFIG_FILE, config);
}

/** 原子写入配置并收紧目录、临时文件和最终文件权限。 */
export function writeConfigFile(dir: string, file: string, config: CanvasAgentConfig) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const tempFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify(config, null, 2), { mode: 0o600 });
        fs.chmodSync(tempFile, 0o600);
        replaceConfigFile(tempFile, file);
        fs.chmodSync(file, 0o600);
    } finally {
        try { fs.unlinkSync(tempFile); } catch {}
    }
}

/** 确保站点级 Codex 工作空间存在并已初始化。 */
export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (!MANAGED_DATA_ROOT && current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        initializeWorkspace(workspacePath);
        return { ...current, workspacePath };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    if (current?.workspacePath && path.resolve(current.workspacePath) === workspacePath) {
        initializeWorkspace(workspacePath);
        return current;
    }
    config.workspace = { ...current, workspacePath };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return config.workspace;
}

/** Windows may briefly lock the destination while security tools inspect it. */
function replaceConfigFile(tempFile: string, file: string) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            fs.renameSync(tempFile, file);
            return;
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
            const delay = configRenameRetryDelaysMs[attempt];
            if (!retryableConfigRenameErrors.has(code) || delay === undefined) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
        }
    }
}

/** 更新站点级 Codex 工作空间配置。 */
export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.workspace = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return config.workspace;
}

/** 创建工作空间目录并写入默认 AGENTS.md。 */
function initializeWorkspace(workspacePath: string) {
    if (initializedWorkspaces.has(workspacePath)) return;
    fs.mkdirSync(workspacePath, { recursive: true });
    const instructionsFile = path.join(workspacePath, "AGENTS.md");
    const current = fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8") : "";
    if (!current || current.startsWith("# Infinite Canvas Agent") || current.startsWith("# Narralight Agent")) fs.writeFileSync(instructionsFile, AGENT_PROMPT);
    initializedWorkspaces.add(workspacePath);
}

/** 将用户输入的工作空间路径解析为绝对路径。 */
function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

/** 从当前包信息中读取 Canvas Agent 版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
