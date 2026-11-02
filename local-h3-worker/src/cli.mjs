import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.mjs";
import { generateWorkerKeyPair, loadPrivateKey, protectPrivateKeyToFile } from "./crypto-auth.mjs";
import { errorSummary, WorkerError } from "./errors.mjs";
import { WorkerLedger } from "./ledger.mjs";
import { createLogger } from "./logger.mjs";
import { NarralightWorkerClient } from "./server-client.mjs";
import { ComfyClient } from "./comfy-client.mjs";
import { H3Worker } from "./worker.mjs";
import { loadWorkflowTemplate } from "./workflow.mjs";
import { reexecWithConfiguredCa } from "./runtime-ca.mjs";

const logger = createLogger();

function parseArgs(argv) {
  const [command = "doctor", ...rest] = argv;
  const configIndex = rest.indexOf("--config");
  if (configIndex < 0 || !rest[configIndex + 1]) throw new WorkerError("cli_config_required", "Use --config <path>");
  return { command, configPath: rest[configIndex + 1] };
}

async function maybeReexec(config) {
  const child = await reexecWithConfiguredCa(config);
  if (!child) return false;
  process.exitCode = child.code;
  return true;
}

function workerId() {
  const machine = hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 40) || "windows";
  return `worker_${machine}_${randomBytes(5).toString("hex")}`;
}

async function saveIdentity(configPath, id, keyPath) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  raw.workerId = id;
  raw.privateKeyDpapiPath = path.relative(path.dirname(configPath), keyPath).replaceAll("\\", "/");
  const temp = `${configPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(raw, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, configPath);
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

function pairingStatePath(config) {
  return `${config.privateKeyDpapiPath}.pairing.json`;
}

async function writePairingState(filename, state) {
  const temp = `${filename}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, filename);
}

function validatePairingState(config, state) {
  const targetKeyPath = path.resolve(String(state?.targetKeyPath || ""));
  const stagedKeyPath = path.resolve(String(state?.stagedKeyPath || ""));
  const expectedTarget = path.resolve(config.privateKeyDpapiPath);
  if (state?.version !== 1 || !/^worker_[a-zA-Z0-9._-]{3,80}$/.test(String(state?.workerId || ""))) {
    throw new WorkerError("pairing_state_invalid", "Pending pairing state is invalid");
  }
  if (targetKeyPath !== expectedTarget
    || path.dirname(stagedKeyPath) !== path.dirname(expectedTarget)
    || !path.basename(stagedKeyPath).startsWith(`${path.basename(expectedTarget)}.pending-`)) {
    throw new WorkerError("pairing_state_path_invalid", "Pending pairing key paths are outside the configured identity boundary");
  }
  return { ...state, targetKeyPath, stagedKeyPath };
}

function workerClient(config, id, privateKeyPem) {
  return new NarralightWorkerClient({
    baseUrl: config.serverBaseUrl,
    workerId: id,
    privateKeyPem,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}

export async function pair(config, options = {}) {
  const pairingCode = options.pairingCode ?? process.env.NARRALIGHT_H3_PAIRING_CODE;
  if (!pairingCode) throw new WorkerError("pairing_code_missing", "Set NARRALIGHT_H3_PAIRING_CODE for this one pairing command");
  if (config.workerId || await fileExists(config.privateKeyDpapiPath)) {
    throw new WorkerError("worker_already_paired", "Existing worker identity will not be overwritten; revoke and recover it explicitly");
  }
  const statePath = pairingStatePath(config);
  if (await fileExists(statePath)) {
    throw new WorkerError("pairing_recovery_required", "A previous pairing attempt must be recovered before creating another identity");
  }
  const id = config.workerId || workerId();
  const keys = generateWorkerKeyPair();
  const stagedKeyPath = `${config.privateKeyDpapiPath}.pending-${id}-${randomBytes(4).toString("hex")}`;
  await protectPrivateKeyToFile(keys.privateKeyPem, stagedKeyPath);
  const state = {
    version: 1,
    workerId: id,
    publicKeySpkiDerBase64: keys.publicKeySpkiDerBase64,
    stagedKeyPath,
    targetKeyPath: config.privateKeyDpapiPath,
    outcome: "pending",
    createdAt: new Date().toISOString(),
  };
  await writePairingState(statePath, state);
  let requestReturned = false;
  try {
    const server = options.server || workerClient(config, id, keys.privateKeyPem);
    const response = await server.pair({
      pairingCode,
      workerId: id,
      displayName: config.displayName,
      publicKeySpkiDerBase64: keys.publicKeySpkiDerBase64,
      capabilities: { workflowSha256: config.workflowSha256, maxActive: 1 },
    });
    requestReturned = true;
    if (response?.workerId && response.workerId !== id) throw new WorkerError("pair_worker_id_mismatch", "Server returned a different worker ID");
    state.outcome = "accepted";
    state.acceptedAt = new Date().toISOString();
    await writePairingState(statePath, state);
    await rename(stagedKeyPath, config.privateKeyDpapiPath);
    await (options.saveIdentityImpl || saveIdentity)(config.configPath, id, config.privateKeyDpapiPath);
    await rm(statePath, { force: true }).catch(() => null);
    delete process.env.NARRALIGHT_H3_PAIRING_CODE;
    logger.info("worker_paired", { workerId: id });
  } catch (error) {
    if (state.outcome !== "accepted") {
      const summary = errorSummary(error);
      const uncertain = requestReturned || summary.uncertain || summary.retryable;
      if (uncertain) {
        state.outcome = "uncertain";
        state.errorCode = summary.code;
        state.updatedAt = new Date().toISOString();
        await writePairingState(statePath, state).catch(() => null);
      } else {
        let cleanupFailed = false;
        try { await rm(stagedKeyPath, { force: true }); } catch { cleanupFailed = true; }
        try { await rm(statePath, { force: true }); } catch { cleanupFailed = true; }
        if (cleanupFailed) {
          state.outcome = "rejected_cleanup_required";
          state.errorCode = summary.code;
          state.updatedAt = new Date().toISOString();
          await writePairingState(statePath, state).catch(() => null);
        }
      }
    }
    delete process.env.NARRALIGHT_H3_PAIRING_CODE;
    throw error;
  }
}

export async function recoverPair(config, options = {}) {
  if (config.workerId) throw new WorkerError("worker_already_paired", "Worker config already contains an identity");
  const statePath = pairingStatePath(config);
  let state;
  try {
    state = validatePairingState(config, JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    throw new WorkerError("pairing_state_unreadable", "Pending pairing state could not be read", { cause: error });
  }
  const keyPath = await fileExists(state.targetKeyPath) ? state.targetKeyPath : state.stagedKeyPath;
  if (!await fileExists(keyPath)) throw new WorkerError("pairing_key_missing", "Pending pairing private key is missing");
  const privateKeyPem = await loadPrivateKey({ privateKeyDpapiPath: keyPath });
  const server = options.server || workerClient(config, state.workerId, privateKeyPem);
  await server.heartbeat({ workflowSha256: config.workflowSha256, currentJobId: null });
  state.outcome = "accepted";
  state.acceptedAt ||= new Date().toISOString();
  await writePairingState(statePath, state);
  if (keyPath === state.stagedKeyPath) await rename(state.stagedKeyPath, state.targetKeyPath);
  await (options.saveIdentityImpl || saveIdentity)(config.configPath, state.workerId, state.targetKeyPath);
  await rm(statePath, { force: true }).catch(() => null);
  logger.info("worker_pairing_recovered", { workerId: state.workerId });
}

async function checkFfprobe(ffprobePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, ["-version"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", (error) => reject(new WorkerError("ffprobe_unavailable", "ffprobe is not available", { cause: error })));
    child.on("close", (code) => code === 0 ? resolve() : reject(new WorkerError("ffprobe_unavailable", `ffprobe exited with ${code}`)));
  });
}

async function doctor(config) {
  const workflow = await loadWorkflowTemplate(config.workflowPath, config.workflowSha256);
  await checkFfprobe(config.ffprobePath);
  const comfy = new ComfyClient({ baseUrl: config.comfyBaseUrl, requestTimeoutMs: config.requestTimeoutMs });
  const stats = await comfy.health();
  if (config.workerId) await loadPrivateKey(config);
  if (config.serverCaPath) await access(config.serverCaPath);
  logger.info("doctor_ok", {
    workflowSha256: workflow.sha256,
    comfyVersion: stats?.system?.comfyui_version || null,
    identityPresent: Boolean(config.workerId),
    customCaConfigured: Boolean(config.serverCaPath),
  });
}

async function run(config) {
  const [{ template }, privateKeyPem] = await Promise.all([
    loadWorkflowTemplate(config.workflowPath, config.workflowSha256),
    loadPrivateKey(config),
  ]);
  const ledger = new WorkerLedger(config.ledgerPath);
  const server = new NarralightWorkerClient({
    baseUrl: config.serverBaseUrl,
    workerId: config.workerId,
    privateKeyPem,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  const comfy = new ComfyClient({ baseUrl: config.comfyBaseUrl, requestTimeoutMs: config.requestTimeoutMs });
  const worker = new H3Worker({ config, ledger, server, comfy, workflowTemplate: template, logger });
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker stopped"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await worker.runForever(controller.signal);
  } finally {
    ledger.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.configPath, { requireIdentity: args.command === "run" });
  if (await maybeReexec(config)) return;
  if (args.command === "pair") return pair(config);
  if (args.command === "recover-pair") return recoverPair(config);
  if (args.command === "doctor") return doctor(config);
  if (args.command === "run") return run(config);
  throw new WorkerError("cli_command_unknown", `Unknown command: ${args.command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const summary = errorSummary(error);
    logger.error("worker_exit", {
      errorCode: summary.code,
      status: summary.status,
      retryable: summary.retryable,
      uncertain: summary.uncertain,
    });
    process.exitCode = 1;
  });
}
