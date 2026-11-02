import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULTS } from "./constants.mjs";
import { WorkerError } from "./errors.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;

function resolveFile(baseDir, value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkerError("config_invalid", `${field} is required`);
  }
  return path.resolve(baseDir, value);
}

export function assertComfyLoopback(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "8188") {
    throw new WorkerError("comfy_url_not_loopback", "ComfyUI must be exactly http://127.0.0.1:8188");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new WorkerError("comfy_url_invalid", "ComfyUI URL must not include a path, query, or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

export function assertSecureServerUrl(value, allowInsecureLoopback = false) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new WorkerError("server_url_invalid", "Server URL must not contain credentials, path, query, or fragment");
  }
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(allowInsecureLoopback && isLoopback && url.protocol === "http:")) {
    throw new WorkerError("server_tls_required", "Worker server URL must use HTTPS; plain HTTP is allowed only for an explicit loopback test");
  }
  return url.toString().replace(/\/$/, "");
}

export async function loadConfig(configPath, { requireIdentity = true } = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new WorkerError("tls_verification_disabled", "NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden for the H3 Worker");
  }
  const absoluteConfigPath = path.resolve(configPath);
  const baseDir = path.dirname(absoluteConfigPath);
  let raw;
  try {
    raw = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  } catch (error) {
    throw new WorkerError("config_unreadable", `Cannot read worker config: ${absoluteConfigPath}`, { cause: error });
  }
  const config = {
    configPath: absoluteConfigPath,
    displayName: String(raw.displayName || "Windows H3 Worker").slice(0, 80),
    workerId: raw.workerId ? String(raw.workerId) : null,
    serverBaseUrl: assertSecureServerUrl(raw.serverBaseUrl, raw.allowInsecureLoopback === true),
    comfyBaseUrl: assertComfyLoopback(raw.comfyBaseUrl || "http://127.0.0.1:8188"),
    workflowPath: resolveFile(baseDir, raw.workflowPath, "workflowPath"),
    workflowSha256: String(raw.workflowSha256 || "").toLowerCase(),
    ledgerPath: resolveFile(baseDir, raw.ledgerPath || "data/worker-ledger.sqlite", "ledgerPath"),
    spoolDir: resolveFile(baseDir, raw.spoolDir || "data/spool", "spoolDir"),
    privateKeyDpapiPath: raw.privateKeyDpapiPath
      ? resolveFile(baseDir, raw.privateKeyDpapiPath, "privateKeyDpapiPath")
      : path.resolve(baseDir, "data/worker-key.dpapi"),
    serverCaPath: raw.serverCaPath ? resolveFile(baseDir, raw.serverCaPath, "serverCaPath") : null,
    ffprobePath: String(raw.ffprobePath || "ffprobe"),
    claimWaitSeconds: Number(raw.claimWaitSeconds ?? DEFAULTS.claimWaitSeconds),
    idleDelayMs: Number(raw.idleDelayMs ?? DEFAULTS.idleDelayMs),
    comfyPollMs: Number(raw.comfyPollMs ?? DEFAULTS.comfyPollMs),
    cancelConfirmTimeoutMs: Number(raw.cancelConfirmTimeoutMs ?? DEFAULTS.cancelConfirmTimeoutMs),
    leaseRenewMs: Number(raw.leaseRenewMs ?? DEFAULTS.leaseRenewMs),
    requestTimeoutMs: Number(raw.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs),
    uploadChunkBytes: Number(raw.uploadChunkBytes ?? DEFAULTS.uploadChunkBytes),
  };
  if (!SHA256_RE.test(config.workflowSha256)) {
    throw new WorkerError("workflow_hash_invalid", "workflowSha256 must be a lowercase SHA-256 hex string");
  }
  if (requireIdentity && (!config.workerId || (!config.privateKeyDpapiPath && !process.env.NARRALIGHT_H3_WORKER_PRIVATE_KEY_PEM))) {
    throw new WorkerError("worker_identity_missing", "Pair this worker before starting it");
  }
  for (const [field, value] of Object.entries({
    claimWaitSeconds: config.claimWaitSeconds,
    idleDelayMs: config.idleDelayMs,
    comfyPollMs: config.comfyPollMs,
    cancelConfirmTimeoutMs: config.cancelConfirmTimeoutMs,
    leaseRenewMs: config.leaseRenewMs,
    requestTimeoutMs: config.requestTimeoutMs,
    uploadChunkBytes: config.uploadChunkBytes,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new WorkerError("config_invalid", `${field} must be a positive integer`);
    }
  }
  return config;
}
