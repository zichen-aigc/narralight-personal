import { createHash, randomInt, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statfsSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { once } from "node:events";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Worker } from "node:worker_threads";
import { Agent as PinnedDownloadAgent } from "undici";
import { readWindowsCredential } from "./credential-manager.mjs";
import {
  deploymentProfileMetadata,
  resolveDeploymentProfile,
} from "./deployment-profile.mjs";
import {
  APIMART_MINIMAX_H3_MODEL_ID,
  validateApimartMiniMaxH3Payload,
} from "./apimart-minimax-h3.mjs";
import {
  apimartGrokVideoModelsMatch,
  isApimartGrokVideo,
  validateApimartGrokVideoPayload,
} from "./apimart-grok-video.mjs";
import {
  createGrokOfficialPricing,
  GROK_OFFICIAL_BASE_LOCAL,
  GROK_OFFICIAL_15_LOCAL,
  GROK_OFFICIAL_EDIT_LOCAL,
  GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT,
  GROK_OFFICIAL_PLATFORM_EDIT_MAX_MS,
  grokOfficialInputCounts,
  grokOfficialLocalVideo,
  grokOfficialModelsMatch,
  grokOfficialRequestModel,
  isGrokOfficialEditModel,
  isGrokOfficialModel,
  quoteGrokOfficial,
  validateGrokOfficialPayload,
} from "./apimart-grok-official.mjs";
import { parseUsdCnyRate } from "./provider-pricing-catalog.mjs";
import {
  API888_BASE_URL,
  API888_CHANNEL_ID,
  API888_CREDENTIAL_TARGET,
  API888_PROVIDER,
  api888LocalObject,
  api888VideoResult,
  validate888ApiRequest,
} from "./provider-888api.mjs";
import { projectProviderCatalog } from "./provider-catalog.mjs";
import { fetchApimartRoute } from "./apimart-egress.mjs";
import {
  isRunningHubGrokCreatePath,
  runningHubGrokContractFor,
  runningHubGrokModelForPath,
  runningHubTaskStatus,
  validateRunningHubGrokPayload,
} from "./runninghub-grok-video.mjs";
import { createVolcAssetOpenApiClient } from "./volc-asset-api.mjs";
import { createVolcAssetRelayManager } from "./volc-asset-relay.mjs";
import {
  createLocalH3WorkerService,
  LOCAL_H3_MODEL,
  LOCAL_H3_PROVIDER,
  normalizeLocalH3Parameters,
} from "./local-h3-worker.mjs";
import {
  probeAudioFile,
  probeVideoFile,
  transcodeVideoPreview,
} from "./video-media-tools.mjs";
const DEFAULT_ROOT = join(homedir(), ".narralight-personal");
const MAX_JSON = 128 * 1024 * 1024;
const MAX_OBJECT = 2 * 1024 * 1024 * 1024;
const PROJECT_EXPORT_TTL_MS = 30 * 60 * 1000;
const PROJECT_IMPORT_SOURCE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_APIMART_IMAGE_UPLOAD = 21 * 1024 * 1024;
const MAX_RICHBEST_MEDIA_UPLOAD = 201 * 1024 * 1024;
const MAX_REMOTE_IMAGE_IMPORT = 64 * 1024 * 1024;
const MAX_REMOTE_VIDEO_IMPORT = 512 * 1024 * 1024;
const MAX_RUNNINGHUB_MEDIA_UPLOAD = 512 * 1024 * 1024;
const DEFAULT_REMOTE_IMPORT_TIMEOUT_MS = 90000;
const DEFAULT_REMOTE_IMPORT_ATTEMPTS = 3;
const DEFAULT_REMOTE_IMPORT_REDIRECTS = 3;
const MAX_FASTSTART_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_SEEDANCE_VIDEO_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_SEEDANCE_AUDIO_INPUT_BYTES = 15 * 1024 * 1024;
const EDIT_LEASE_TTL_MS = 15000;
const VOLCENGINE_ARK_GX_CREDENTIAL_TARGET = "VOLCENGINE_ARK_GX_API_KEY";
const RUNNINGHUB_CREDENTIAL_TARGET = "RUNNINGHUB_API_KEY";
const RICHBEST_CHANNEL_ID = "richbest";
const RICHBEST_BASE_URL = "https://api.richbest.cn";
const RUNNINGHUB_BASE_PATH = "/openapi/v2";
const RUNNINGHUB_SEEDANCE_25_MODEL_ID =
  "bytedance/seedance-2.5-global-token/multimodal-video";
const RUNNINGHUB_REQUEST_PATH = `/${RUNNINGHUB_SEEDANCE_25_MODEL_ID}`;
const RUNNINGHUB_CREATE_PATH = `${RUNNINGHUB_BASE_PATH}/${RUNNINGHUB_SEEDANCE_25_MODEL_ID}`;
const RUNNINGHUB_QUERY_PATH = `${RUNNINGHUB_BASE_PATH}/query`;
const RUNNINGHUB_UPLOAD_PATH = `${RUNNINGHUB_BASE_PATH}/media/upload/binary`;
const RUNNINGHUB_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const VOLCENGINE_ARK_ASSETS_ACCESS_KEY_TARGET =
  "VOLCENGINE_ARK_ASSETS_ACCESS_KEY";
const VOLCENGINE_ARK_ASSETS_SECRET_KEY_TARGET =
  "VOLCENGINE_ARK_ASSETS_SECRET_KEY";
const LOCAL_VIDEO_TAKE_HEADER = "x-narralight-video-take-id";
const CODEX_AGENT_REASONING_EFFORTS = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const PLATFORM_APP_VERSION =
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../VERSION"),
    "utf8",
  ).trim() || "dev";
const PROVIDER_RECONCILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const APIMART_TASK_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const RICHBEST_TASK_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const PROVIDER_RECONCILE_TIME_BEFORE_MS = 30 * 1000;
const PROVIDER_RECONCILE_TIME_AFTER_MS = 15 * 60 * 1000;
const PROVIDER_INITIAL_POLL_DELAY_MS = 60_000;
const PROVIDER_INITIAL_VIDEO_POLL_DELAY_MS = 30_000;
const PROVIDER_QUERY_ERROR_BACKOFF_MS = [
  5_000,
  15_000,
  30_000,
  60_000,
  2 * 60_000,
];
const PROVIDER_RESULT_PENDING_BACKOFF_MS = [10_000, 20_000, 30_000, 60_000];
const PROVIDER_ARCHIVE_BACKOFF_MS = [15_000, 30_000, 60_000, 2 * 60_000];
const PROVIDER_SUBMISSION_RECONCILE_BACKOFF_MS = [
  5_000,
  15_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
];
const PROVIDER_RECONCILE_BATCH_SIZE = 30;
const PROVIDER_RECONCILE_CONCURRENCY = 10;
const PROXY_RESPONSE_HEADER_DENYLIST = new Set([
  "access-control-allow-origin",
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const ALLOWED_CREDENTIAL_TARGETS = new Set([
  "MG_API_KEY",
  VOLCENGINE_ARK_GX_CREDENTIAL_TARGET,
  RUNNINGHUB_CREDENTIAL_TARGET,
  API888_CREDENTIAL_TARGET,
]);
const MANAGED_VIDEO_PROVIDERS = new Set([
  "apimart",
  "volcengine-ark",
  "runninghub",
  "richbest",
  API888_PROVIDER,
]);
const MANAGED_STANDALONE_MEDIA = new Set([
  "apimart:image",
  "apimart:video",
  "volcengine-ark:video",
  "runninghub:video",
  "richbest:video",
]);
const RUNNINGHUB_RESOLUTIONS = new Set([
  "480p",
  "720p",
  "native1080p",
  "1080p",
  "2k",
  "4k",
]);
const RUNNINGHUB_RATIOS = new Set([
  "adaptive",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "21:9",
]);
const VOLCENGINE_REFERENCE_MODES_20 = new Set([
  "text_to_video",
  "omni",
  "video_edit",
  "video_extend",
  "first_frame",
  "first_last_frame",
  "multi_image",
  "motion_transfer",
]);
const VOLCENGINE_REFERENCE_MODES_15 = new Set([
  "text_to_video",
  "first_frame",
  "first_last_frame",
  "draft",
]);
function diagnosticToken(value, fallback = "unknown") {
  const normalized = String(value || "").slice(0, 100);
  return /^[a-zA-Z0-9_.:-]+$/.test(normalized) ? normalized : fallback;
}
function diagnosticNetworkCode(error) {
  for (const value of [error?.cause?.code, error?.cause?.errno, error?.code]) {
    const normalized = diagnosticToken(value, "");
    if (
      /^(?:EAI_AGAIN|E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NETUNREACH|HOSTUNREACH|PIPE|OF)|ENOTFOUND|UND_ERR_[A-Z0-9_]+|ABORT_ERR|ERR_TLS_[A-Z0-9_]+|CERT_[A-Z0-9_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(
        normalized,
      )
    )
      return normalized;
  }
  return undefined;
}
function beijingTimestamp(utcTimestamp) {
  const time = Date.parse(utcTimestamp);
  return Number.isFinite(time)
    ? new Date(time + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00")
    : undefined;
}
export function createVolcAssetRelayDiagnostics(options = {}) {
  const db = options.db;
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  const correlationId = options.correlationId || randomUUID;
  const writeLine =
    options.writeLine || ((line) => process.stderr.write(`${line}\n`));
  const contexts = new AsyncLocalStorage();
  const writeStderr = (payload) => {
    const line = JSON.stringify(payload);
    try {
      writeLine(line);
    } catch (error) {
      const fallback = JSON.stringify({
        event: "volc_asset.relay_log_sink_failed",
        createdAtUtc: new Date().toISOString(),
        errorName: diagnosticToken(error?.name, "Error"),
        errorCode: diagnosticToken(error?.code),
        networkCode: diagnosticNetworkCode(error),
      });
      try {
        process.stderr.write(`${fallback}\n`);
      } catch (stderrError) {
        void stderrError;
      }
    }
  };
  const record = (event, context, detail = {}) => {
    const createdAtUtc = now().toISOString();
    const payload = {
      event,
      createdAtUtc,
      createdAtBeijing: beijingTimestamp(createdAtUtc),
      correlationId: context.correlationId,
      provider: context.provider,
      operation: context.operation,
      localRefHash: context.localRefHash,
      ...detail,
    };
    writeStderr(payload);
    if (!db?.prepare) return payload;
    try {
      db.prepare(
        "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES(?,?,?,?)",
      ).run(
        event,
        context.correlationId,
        JSON.stringify({
          ...payload,
          event: undefined,
          createdAtUtc: undefined,
        }),
        createdAtUtc,
      );
    } catch (error) {
      writeStderr({
        event: "volc_asset.relay_audit_write_failed",
        createdAtUtc,
        createdAtBeijing: beijingTimestamp(createdAtUtc),
        correlationId: context.correlationId,
        errorName: diagnosticToken(error?.name, "Error"),
        errorCode: diagnosticToken(error?.code),
        networkCode: diagnosticNetworkCode(error),
      });
    }
    return payload;
  };
  const relayFetch = async (input, init) => {
    const active = contexts.getStore();
    const safeTarget = (() => {
      try {
        return new URL(String(input)).origin;
      } catch {
        return "invalid-relay-target";
      }
    })();
    const context = active || {
      correlationId: `orphan-${createHash("sha256").update(safeTarget).digest("hex").slice(0, 20)}`,
      provider: "unknown",
      operation: "relay_public_probe",
      localRefHash: undefined,
      attempts: new Map(),
      totalAttempts: 0,
      startedAtMs: Date.now(),
    };
    const probeId = createHash("sha256")
      .update(String(input))
      .digest("hex")
      .slice(0, 20);
    const attempt = Number(context.attempts.get(probeId) || 0) + 1;
    context.attempts.set(probeId, attempt);
    context.totalAttempts += 1;
    const startedAtMs = Date.now();
    try {
      const response = await fetchImpl(input, init);
      record("volc_asset.relay_probe", context, {
        probeId,
        attempt,
        httpStatus: response.status,
        durationMs: Date.now() - startedAtMs,
        outcome: response.status === 206 ? "ready" : "retry",
      });
      return response;
    } catch (error) {
      record("volc_asset.relay_probe", context, {
        probeId,
        attempt,
        durationMs: Date.now() - startedAtMs,
        outcome: "network_error",
        errorName: diagnosticToken(error?.name, "Error"),
        networkCode: diagnosticNetworkCode(error),
      });
      throw error;
    }
  };
  const run = (input, task) => {
    const context = {
      correlationId: diagnosticToken(correlationId(), randomUUID()),
      provider: diagnosticToken(input?.provider),
      operation: diagnosticToken(input?.operation, "relay_public_probe"),
      localRefHash: createHash("sha256")
        .update(String(input?.key || "unknown"))
        .digest("hex")
        .slice(0, 24),
      attempts: new Map(),
      totalAttempts: 0,
      startedAtMs: Date.now(),
    };
    return contexts.run(context, async () => {
      try {
        const result = await task();
        const failedItems = Array.isArray(result?.items)
          ? result.items.filter((item) => item?.error).length
          : 0;
        record("volc_asset.relay_result", context, {
          outcome: failedItems ? "partial" : "ready",
          probeCount: context.attempts.size,
          attemptCount: context.totalAttempts,
          ...(failedItems
            ? {
                failedItems,
              }
            : {}),
          durationMs: Date.now() - context.startedAtMs,
          providerSubmitted: false,
          chargeExpected: false,
        });
        return result;
      } catch (error) {
        record("volc_asset.relay_result", context, {
          outcome: "failed",
          probeCount: context.attempts.size,
          attemptCount: context.totalAttempts,
          durationMs: Date.now() - context.startedAtMs,
          errorName: diagnosticToken(error?.name, "Error"),
          errorCode: diagnosticToken(error?.code),
          networkCode: diagnosticNetworkCode(error),
          providerSubmitted: false,
          chargeExpected: false,
        });
        throw error;
      }
    });
  };
  return {
    fetch: relayFetch,
    run,
  };
}
function instrumentVolcAssetRelayManager(manager, diagnostics) {
  return {
    available: (...args) => manager.available(...args),
    start: (input) =>
      diagnostics.run(
        {
          key: input?.key,
          provider: "volcengine-assets",
          operation: "asset_public_readback",
        },
        () => manager.start(input),
      ),
    startGroup: (input) =>
      diagnostics.run(
        {
          key: input?.key,
          provider: "apimart",
          operation: "media_public_readback",
        },
        () => manager.startGroup(input),
      ),
    startVolcGroup: manager.startVolcGroup
      ? (input) =>
          diagnostics.run(
            {
              key: input?.key,
              provider: "volcengine-assets",
              operation: "asset_batch_public_readback",
            },
            () => manager.startVolcGroup(input),
          )
      : undefined,
    stop: (...args) => manager.stop(...args),
    stopPrefix: (...args) =>
      manager.stopPrefix ? manager.stopPrefix(...args) : 0,
    stopAll: (...args) => manager.stopAll(...args),
  };
}
const VOLCENGINE_VIDEO_CAPABILITIES = new Map([
  [
    "doubao-seedance-2-5-260628",
    {
      duration: [4, 30],
      resolutions: new Set(["480p", "720p", "1080p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      images: 30,
      videos: 10,
      audios: 10,
      audioRequiresVisual: false,
      family: "2.5",
    },
  ],
  [
    "doubao-seedance-2-0-260128",
    {
      duration: [4, 15],
      resolutions: new Set(["480p", "720p", "1080p", "4k"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      images: 9,
      videos: 3,
      audios: 3,
      audioRequiresVisual: true,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2-0-fast-260128",
    {
      duration: [4, 15],
      resolutions: new Set(["480p", "720p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      images: 9,
      videos: 3,
      audios: 3,
      audioRequiresVisual: true,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2-0-mini-260615",
    {
      duration: [4, 15],
      resolutions: new Set(["480p", "720p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      images: 9,
      videos: 3,
      audios: 3,
      audioRequiresVisual: true,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-1-5-pro-251215",
    {
      duration: [4, 12],
      resolutions: new Set(["480p", "720p", "1080p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_15,
      images: 2,
      videos: 0,
      audios: 0,
      audioRequiresVisual: true,
      family: "1.5",
    },
  ],
]);
const VOLCENGINE_VIDEO_RATIOS = new Set([
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "adaptive",
]);
const LOCAL_SEEDANCE_MEDIA_PATTERN =
  /^narralight-object:\/\/sha256\/([a-f0-9]{64})\?mime=([^&#]+)$/i;
const LOCAL_SEEDANCE_VIDEO_PATTERN = LOCAL_SEEDANCE_MEDIA_PATTERN;
const ISO_BMFF_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const VOLC_ASSET_CLASSIFICATIONS = new Set([
  "unclassified",
  "ordinary",
  "real_person",
  "volc_preset_avatar",
  "volc_trusted_output",
]);
const VOLC_ASSET_STATUSES = new Set([
  "unverified",
  "not_required",
  "credentials_missing",
  "integration_pending",
  "pending_asset",
  "processing",
  "active",
  "failed",
  "expired",
  "project_mismatch",
]);
const VOLC_ASSET_GENERATION_STATUSES = new Set([
  "unverified",
  "not_required",
  "verified",
  "inaccessible",
]);
const VOLC_ASSET_MEDIA_KINDS = new Set(["image", "video", "audio"]);
const VOLC_ASSET_RECONCILE_AFTER_MS = 8_000;
const VOLC_ASSET_HEDGE_AFTER_MS = 20_000;
const VOLC_ASSET_BACKUP_AFTER_MS = 90_000;
const VOLC_ASSET_GENERATION_HEDGE_AFTER_MS = 180_000;
const VOLC_ASSET_POLL_SCAN_LIMIT = 100;
const VOLC_ASSET_BATCH_MAX = 100;
const VOLC_ASSET_DEFAULT_CONCURRENCY = 30;
const VOLC_AIGC_GROUP_PREFIX = "Narralight-AIGC-";
const VOLC_ASSET_DEFAULT_PROJECT_NAME = "narralight-personal";
const ALLOWED_REMOTE_OBJECT_HOSTS = new Set([
  "upload.apimart.ai",
  "getapib.org",
]);
const isoNow = () => new Date().toISOString();
const apiErrorLogCounts = new Map();
export function createBoundedJobQueue({ maxActive = 3, maxQueued = 12 } = {}) {
  if (
    !Number.isSafeInteger(maxActive) ||
    maxActive < 1 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 0
  )
    throw new Error("invalid_job_queue_limits");
  let active = 0;
  const waiting = [];
  const pump = () => {
    while (active < maxActive && waiting.length) {
      const job = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return {
    run(task) {
      if (active >= maxActive && waiting.length >= maxQueued)
        return Promise.reject(
          Object.assign(new Error("后台任务容量已满，请稍后重试"), {
            status: 429,
            code: "job_capacity_exhausted",
          }),
        );
      return new Promise((resolvePromise, rejectPromise) => {
        waiting.push({
          task,
          resolve: resolvePromise,
          reject: rejectPromise,
        });
        pump();
      });
    },
    status: () => ({
      maxActive,
      maxQueued,
      active,
      queued: waiting.length,
    }),
  };
}
function sendJson(res, status, value, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  const requestId =
    diagnosticIdentifier(res.narralightRequestId) ||
    createDiagnosticRequestId();
  const output =
    status >= 400 ? normalizedApiError(status, value, requestId) : value;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": requestId,
    ...headers,
  });
  if (status >= 400) logApiError(res, status, output);
  res.end(JSON.stringify(output));
}
function normalizedApiError(status, value, requestId) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {
          error: String(value || `HTTP ${status}`),
        };
  const nested =
    source.error &&
    typeof source.error === "object" &&
    !Array.isArray(source.error)
      ? source.error
      : null;
  const rawMessage =
    typeof source.error === "string"
      ? source.error
      : typeof source.message === "string"
        ? source.message
        : typeof nested?.message === "string"
          ? nested.message
          : `HTTP ${status}`;
  const rawCode =
    source.code ||
    nested?.code ||
    (/^[a-z][a-z0-9_.:-]{2,120}$/i.test(rawMessage)
      ? rawMessage
      : `http_${status}`);
  return {
    ...source,
    error: sanitizeDiagnosticText(rawMessage),
    code: diagnosticIdentifier(rawCode) || `http_${status}`,
    httpStatus: status,
    requestId,
    ...(source.details
      ? {
          details: sanitizeDiagnosticValue(source.details),
        }
      : {}),
    ...(source.providerError
      ? {
          providerError: sanitizeDiagnosticValue(source.providerError),
        }
      : {}),
  };
}
function logApiError(res, status, payload) {
  const code = diagnosticIdentifier(payload.code) || `http_${status}`;
  const key = `${status}:${code}:${res.narralightRequestPath || "unknown"}`;
  const count = (apiErrorLogCounts.get(key) || 0) + 1;
  apiErrorLogCounts.set(key, count);
  if (code === "lease_held" && count !== 1 && count % 100 !== 0) return;
  console.error(
    JSON.stringify({
      type: "api_error",
      at: isoNow(),
      requestId: payload.requestId,
      method: res.narralightRequestMethod || "UNKNOWN",
      path: res.narralightRequestPath || "unknown",
      httpStatus: status,
      code,
      message: sanitizeDiagnosticText(payload.error),
      ...(payload.details
        ? {
            details: sanitizeDiagnosticValue(payload.details),
          }
        : {}),
      count,
    }),
  );
}
function createDiagnosticRequestId() {
  return `NL-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toUpperCase();
}
function diagnosticIdentifier(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 200);
}
function sanitizeDiagnosticValue(value) {
  if (Array.isArray(value))
    return value.slice(0, 30).map(sanitizeDiagnosticValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]) => [
          diagnosticIdentifier(key),
          sanitizeDiagnosticValue(item),
        ]),
    );
  return typeof value === "string" ? sanitizeDiagnosticText(value) : value;
}
function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+\?\S+/gi, "[signed-url-redacted]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[secret-redacted]")
    .replace(
      /\b(api[_-]?key|token|signature|authorization)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/(?:[a-zA-Z]:[\\/]|\\\\)[^\s,;]+/g, "[path-redacted]")
    .replace(/\/(?:Users|home|tmp|var|etc|mnt)\/[^\s,;]+/g, "[path-redacted]")
    .slice(0, 1000);
}
async function pipeWebResponse(response, res) {
  if (!response.body) {
    res.end();
    return true;
  }
  const reader = response.body.getReader();
  let clientClosed = false;
  let completed = false;
  const closeClient = () => {
    clientClosed = true;
    void reader.cancel().catch(() => undefined);
  };
  res.on("close", closeClient);
  res.on("error", closeClient);
  try {
    while (!clientClosed && !res.destroyed && !res.writableEnded) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (!res.write(value)) await once(res, "drain");
    }
  } catch (error) {
    if (!clientClosed && error?.name !== "AbortError" && !res.destroyed)
      throw error;
  } finally {
    res.off("close", closeClient);
    res.off("error", closeClient);
    await reader.cancel().catch(() => undefined);
  }
  if (!res.destroyed && !res.writableEnded) res.end();
  return completed && !clientClosed;
}
function isLoopback(value) {
  const host = String(value || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
function isLocalRequest(req) {
  const hostHeader = String(req.headers.host || "");
  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(1, hostHeader.indexOf("]"))
    : hostHeader.split(":")[0];
  if (!isLoopback(hostname)) return false;
  if (!req.headers.origin) return true;
  try {
    return isLoopback(new URL(req.headers.origin).hostname);
  } catch {
    return false;
  }
}
async function readJson(req, limit = MAX_JSON) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit)
      throw Object.assign(new Error("请求内容过大"), {
        status: 413,
      });
    chunks.push(chunk);
  }
  try {
    return chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
  } catch {
    throw Object.assign(new Error("JSON 格式无效"), {
      status: 400,
    });
  }
}
function collectStorageMimeTypes(value, result = new Map(), seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (typeof value.storageKey === "string" && value.storageKey.includes(":")) {
    const mimeType =
      typeof value.mimeType === "string"
        ? value.mimeType
        : typeof value.type === "string" && value.type.includes("/")
          ? value.type
          : "";
    if (mimeType && !result.has(value.storageKey))
      result.set(value.storageKey, mimeType);
  }
  for (const item of Object.values(value)) {
    if (Array.isArray(item))
      item.forEach((child) => collectStorageMimeTypes(child, result, seen));
    else collectStorageMimeTypes(item, result, seen);
  }
  return result;
}
function stateKey(pathname) {
  const key = decodeURIComponent(pathname.slice("/api/local/state/".length));
  if (!key || key.length > 300 || key.includes("\0"))
    throw Object.assign(new Error("状态键无效"), {
      status: 400,
    });
  return key;
}
function initialize(root) {
  for (const name of [
    "db",
    "objects",
    "tmp",
    "snapshots",
    "backups",
    "exports",
    "logs",
    "updates",
    "secrets",
  ])
    mkdirSync(join(root, name), {
      recursive: true,
    });
  const dbPath = join(root, "db", "platform.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(`
        CREATE TABLE IF NOT EXISTS app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS object_alias(alias TEXT PRIMARY KEY,hash TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS remote_result(provider TEXT NOT NULL,task_id TEXT NOT NULL,result_index INTEGER NOT NULL,media_kind TEXT NOT NULL DEFAULT 'image',hash TEXT NOT NULL,mime_type TEXT NOT NULL,bytes INTEGER NOT NULL,source_url_hash TEXT NOT NULL,expires_at TEXT,created_at TEXT NOT NULL,PRIMARY KEY(provider,task_id,result_index));
        CREATE TABLE IF NOT EXISTS generation_task(provider TEXT NOT NULL,task_id TEXT NOT NULL,media_kind TEXT NOT NULL,model TEXT NOT NULL,channel_id TEXT,project_id TEXT,node_id TEXT,status TEXT NOT NULL,result_index INTEGER,error_code TEXT,provider_http_status INTEGER,provider_error_code TEXT,provider_error_message TEXT,provider_request_id TEXT,poll_attempt_count INTEGER NOT NULL DEFAULT 0,consecutive_error_count INTEGER NOT NULL DEFAULT 0,poll_phase TEXT,phase_attempt_count INTEGER NOT NULL DEFAULT 0,last_checked_at TEXT,last_successful_check_at TEXT,last_provider_status TEXT,next_poll_at TEXT,imported_history INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(provider,task_id));
        CREATE TABLE IF NOT EXISTS video_generation_take(take_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,node_id TEXT NOT NULL,status TEXT NOT NULL,provider TEXT,task_id TEXT,model TEXT,prompt TEXT NOT NULL DEFAULT '',params_json TEXT NOT NULL DEFAULT '{}',hash TEXT,mime_type TEXT,bytes INTEGER,duration_ms INTEGER,result_index INTEGER,error_code TEXT,provider_http_status INTEGER,provider_error_code TEXT,provider_error_message TEXT,provider_request_id TEXT,imported_history INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,node_id,provider,task_id,result_index));
        CREATE INDEX IF NOT EXISTS video_generation_take_node_idx ON video_generation_take(project_id,node_id,created_at);
        CREATE TABLE IF NOT EXISTS provider_submission_attempt(take_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,submitted_at TEXT NOT NULL,seed INTEGER,resolution TEXT,ratio TEXT,duration INTEGER,generate_audio INTEGER,reconcile_status TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,consecutive_error_count INTEGER NOT NULL DEFAULT 0,poll_phase TEXT,phase_attempt_count INTEGER NOT NULL DEFAULT 0,last_checked_at TEXT,last_successful_check_at TEXT,last_provider_status TEXT,next_check_at TEXT NOT NULL,last_error TEXT,candidates_json TEXT NOT NULL DEFAULT '[]',expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(take_id) REFERENCES video_generation_take(take_id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS provider_submission_attempt_due_idx ON provider_submission_attempt(reconcile_status,next_check_at);
        CREATE TABLE IF NOT EXISTS grok_official_submission(take_id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL,request_json TEXT NOT NULL,request_sha256 TEXT NOT NULL,last_http_status INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(take_id) REFERENCES video_generation_take(take_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS video_node_history(project_id TEXT NOT NULL,node_id TEXT NOT NULL,active_take_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,node_id));
        CREATE TABLE IF NOT EXISTS media_derivative(source_hash TEXT NOT NULL,kind TEXT NOT NULL,target_hash TEXT NOT NULL,mime_type TEXT NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(source_hash,kind));
        CREATE TABLE IF NOT EXISTS secret_value(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,key));
        CREATE TABLE IF NOT EXISTS volc_asset(asset_id TEXT PRIMARY KEY,local_ref TEXT NOT NULL,media_kind TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,error_message TEXT,project_name TEXT,last_checked_at TEXT,authorization_expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS volc_asset_local_ref_idx ON volc_asset(local_ref,updated_at);
        CREATE TABLE IF NOT EXISTS asset_compliance_binding(local_ref TEXT PRIMARY KEY,project_id TEXT,media_kind TEXT NOT NULL,classification TEXT NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'volcengine-ark',asset_id TEXT,error_code TEXT,error_message TEXT,checked_at TEXT,expires_at TEXT,generation_status TEXT NOT NULL DEFAULT 'unverified',generation_channel_id TEXT,generation_error_code TEXT,generation_error_message TEXT,generation_provider_http_status INTEGER,generation_provider_error_code TEXT,generation_provider_error_message TEXT,generation_provider_request_id TEXT,generation_checked_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS asset_compliance_binding_status_idx ON asset_compliance_binding(status,updated_at);
        CREATE TABLE IF NOT EXISTS volc_asset_group(group_id TEXT PRIMARY KEY,person_id TEXT,display_name TEXT,project_name TEXT,authorization_status TEXT NOT NULL DEFAULT 'pending',authorization_expires_at TEXT,source_account_scope TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS volc_asset_registration(local_ref TEXT PRIMARY KEY,group_id TEXT NOT NULL,project_name TEXT NOT NULL DEFAULT 'default',media_kind TEXT NOT NULL,status TEXT NOT NULL,asset_id TEXT UNIQUE,validation_session_id TEXT,file_id TEXT,mime_type TEXT,source_hash TEXT,asset_name TEXT,create_request_hash TEXT NOT NULL,staging_started_at TEXT,create_started_at TEXT,staging_poll_attempt_count INTEGER NOT NULL DEFAULT 0,poll_attempt_count INTEGER NOT NULL DEFAULT 0,next_poll_at TEXT,delayed_at TEXT,provider_http_status INTEGER,error_code TEXT,error_message TEXT,provider_error_code TEXT,provider_error_message TEXT,provider_request_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS volc_asset_registration_due_idx ON volc_asset_registration(status,next_poll_at);
        CREATE TABLE IF NOT EXISTS volc_asset_submission_attempt(attempt_id TEXT PRIMARY KEY,local_ref TEXT NOT NULL,ordinal INTEGER NOT NULL,status TEXT NOT NULL,asset_id TEXT UNIQUE,request_hash TEXT NOT NULL,provider_http_status INTEGER,provider_error_code TEXT,provider_error_message TEXT,provider_request_id TEXT,submitted_at TEXT NOT NULL,response_received_at TEXT,next_check_at TEXT,poll_attempt_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(local_ref,ordinal),FOREIGN KEY(local_ref) REFERENCES volc_asset_registration(local_ref) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS volc_asset_submission_attempt_ref_idx ON volc_asset_submission_attempt(local_ref,status,next_check_at);
        CREATE TABLE IF NOT EXISTS audit_event(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,subject TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
    `);
  const remoteColumns = db
    .prepare("PRAGMA table_info(remote_result)")
    .all()
    .map((column) => column.name);
  if (!remoteColumns.includes("media_kind"))
    db.exec(
      "ALTER TABLE remote_result ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'image'",
    );
  ensureTableColumns(db, "generation_task", {
    channel_id: "TEXT",
    provider_http_status: "INTEGER",
    provider_error_code: "TEXT",
    provider_error_message: "TEXT",
    provider_request_id: "TEXT",
    poll_attempt_count: "INTEGER NOT NULL DEFAULT 0",
    consecutive_error_count: "INTEGER NOT NULL DEFAULT 0",
    poll_phase: "TEXT",
    phase_attempt_count: "INTEGER NOT NULL DEFAULT 0",
    last_checked_at: "TEXT",
    last_successful_check_at: "TEXT",
    last_provider_status: "TEXT",
    next_poll_at: "TEXT",
    imported_history: "INTEGER NOT NULL DEFAULT 0",
  });
  ensureTableColumns(db, "video_generation_take", {
    provider_http_status: "INTEGER",
    provider_error_code: "TEXT",
    provider_error_message: "TEXT",
    provider_request_id: "TEXT",
    imported_history: "INTEGER NOT NULL DEFAULT 0",
  });
  ensureTableColumns(db, "provider_submission_attempt", {
    consecutive_error_count: "INTEGER NOT NULL DEFAULT 0",
    poll_phase: "TEXT",
    phase_attempt_count: "INTEGER NOT NULL DEFAULT 0",
    last_checked_at: "TEXT",
    last_successful_check_at: "TEXT",
    last_provider_status: "TEXT",
  });
  ensureTableColumns(db, "volc_asset_registration", {
    project_name: "TEXT NOT NULL DEFAULT 'default'",
    validation_session_id: "TEXT",
    file_id: "TEXT",
    mime_type: "TEXT",
    source_hash: "TEXT",
    asset_name: "TEXT",
    staging_started_at: "TEXT",
    staging_poll_attempt_count: "INTEGER NOT NULL DEFAULT 0",
    provider_error_code: "TEXT",
    provider_error_message: "TEXT",
    generation_waiting: "INTEGER NOT NULL DEFAULT 0",
    submission_count: "INTEGER NOT NULL DEFAULT 0",
  });
  ensureTableColumns(db, "asset_compliance_binding", {
    generation_status: "TEXT NOT NULL DEFAULT 'unverified'",
    generation_channel_id: "TEXT",
    generation_error_code: "TEXT",
    generation_error_message: "TEXT",
    generation_provider_http_status: "INTEGER",
    generation_provider_error_code: "TEXT",
    generation_provider_error_message: "TEXT",
    generation_provider_request_id: "TEXT",
    generation_checked_at: "TEXT",
  });
  db.prepare(
    "UPDATE asset_compliance_binding SET generation_status='not_required' WHERE classification='ordinary' AND generation_status<>'not_required'",
  ).run();
  db.exec(
    "UPDATE generation_task SET channel_id=substr(model,1,instr(model,'::')-1) WHERE channel_id IS NULL AND instr(model,'::')>1",
  );
  db.prepare(
    "UPDATE generation_task SET next_poll_at=updated_at WHERE imported_history=0 AND next_poll_at IS NULL AND ((provider IN ('apimart','volcengine-ark','runninghub','richbest','888api') AND media_kind='video') OR (provider='apimart' AND media_kind='image')) AND status IN ('pending','result_pending')",
  ).run();
  const recoveredAt = isoNow();
  const interrupted = db
    .prepare(
      "UPDATE video_generation_take SET status='submission_unknown',error_code='platform_restarted_during_submission',updated_at=? WHERE status='submitting' AND task_id IS NULL",
    )
    .run(recoveredAt);
  if (interrupted.changes)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.recover_submitting','startup',?,?)",
    ).run(
      JSON.stringify({
        count: interrupted.changes,
      }),
      recoveredAt,
    );
  db.prepare(
    `INSERT OR IGNORE INTO volc_asset_submission_attempt(attempt_id,local_ref,ordinal,status,asset_id,request_hash,provider_http_status,provider_error_code,provider_error_message,provider_request_id,submitted_at,response_received_at,next_check_at,poll_attempt_count,created_at,updated_at)
        SELECT 'legacy-' || lower(hex(randomblob(16))),local_ref,1,CASE WHEN asset_id IS NULL THEN 'response_missing' ELSE CASE WHEN status='active' THEN 'active' WHEN status='failed' THEN 'failed' ELSE 'processing' END END,asset_id,create_request_hash,provider_http_status,error_code,error_message,provider_request_id,COALESCE(create_started_at,created_at),CASE WHEN asset_id IS NULL THEN NULL ELSE updated_at END,?,poll_attempt_count,created_at,? FROM volc_asset_registration WHERE (asset_id IS NOT NULL OR status IN ('submitting','submission_unknown')) AND NOT EXISTS(SELECT 1 FROM volc_asset_submission_attempt a WHERE a.local_ref=volc_asset_registration.local_ref)`,
  ).run(recoveredAt, recoveredAt);
  const interruptedAssets = db
    .prepare(
      "UPDATE volc_asset_registration SET status='reconciling',error_code='asset_recovery_pending',error_message='素材正在后台准备，可继续制作',next_poll_at=?,submission_count=MAX(submission_count,1),updated_at=? WHERE status IN ('submitting','submission_unknown') AND asset_id IS NULL",
    )
    .run(recoveredAt, recoveredAt);
  if (interruptedAssets.changes)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.recover_submitting','startup',?,?)",
    ).run(
      JSON.stringify({
        count: interruptedAssets.changes,
      }),
      recoveredAt,
    );
  db.prepare(
    "UPDATE volc_asset_registration SET status='reconciling',next_poll_at=?,submission_count=MAX(submission_count,(SELECT COUNT(*) FROM volc_asset_submission_attempt a WHERE a.local_ref=volc_asset_registration.local_ref)),error_code='asset_recovery_pending',error_message='素材正在后台准备，可继续制作',updated_at=? WHERE status='submission_unknown'",
  ).run(recoveredAt, recoveredAt);
  const retiredFilesStaging = db
    .prepare(
      "UPDATE volc_asset_registration SET status='relay_queued',file_id=NULL,next_poll_at=?,error_code='files_staging_replaced_by_https_relay',error_message='旧 Files 中转已替换为单文件临时 HTTPS 通道',updated_at=? WHERE status IN ('staging_queued','staging_upload','staging_processing','staging_unknown') AND asset_id IS NULL",
    )
    .run(recoveredAt, recoveredAt);
  if (retiredFilesStaging.changes)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.recover_files_staging','startup',?,?)",
    ).run(
      JSON.stringify({
        count: retiredFilesStaging.changes,
      }),
      recoveredAt,
    );
  db.prepare(
    "UPDATE volc_asset_registration SET status='relay_queued',next_poll_at=?,error_code='relay_restarted_before_create',error_message='临时公网通道已重启，平台将重新建立地址后再提交',updated_at=? WHERE status='relay_starting' AND asset_id IS NULL",
  ).run(recoveredAt, recoveredAt);
  const retiredVisualFlows = db
    .prepare(
      "UPDATE volc_asset_registration SET status='failed',error_code='visual_identity_flow_retired',error_message='刷脸认证流程已撤销，请重新提交素材审核',next_poll_at=NULL,updated_at=? WHERE status='identity_pending'",
    )
    .run(recoveredAt);
  if (retiredVisualFlows.changes)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.retire_visual_identity','startup',?,?)",
    ).run(
      JSON.stringify({
        count: retiredVisualFlows.changes,
      }),
      recoveredAt,
    );
  backfillProviderSubmissionAttempts(db);
  const resumedGenerationPolls = db
    .prepare(
      "UPDATE generation_task SET next_poll_at=? WHERE imported_history=0 AND status IN ('pending','result_pending') AND next_poll_at>?",
    )
    .run(recoveredAt, new Date(Date.now() + 2 * 60_000).toISOString());
  const resumedTakePolls = db
    .prepare(
      "UPDATE provider_submission_attempt SET next_check_at=? WHERE take_id IN (SELECT take_id FROM video_generation_take WHERE task_id IS NOT NULL AND status IN ('pending','result_pending')) AND reconcile_status IN ('monitoring','archive_pending') AND next_check_at>?",
    )
    .run(recoveredAt, new Date(Date.now() + 2 * 60_000).toISOString());
  if (resumedGenerationPolls.changes || resumedTakePolls.changes)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('provider_poll.legacy_delay_recovered','startup',?,?)",
    ).run(
      JSON.stringify({
        generationTasks: resumedGenerationPolls.changes,
        videoTakes: resumedTakePolls.changes,
      }),
      recoveredAt,
    );
  backfillVolcAssetGenerationVisibility(db);
  return {
    db,
    dbPath,
  };
}
function ensureTableColumns(db, table, definitions) {
  const existing = new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name),
  );
  for (const [name, definition] of Object.entries(definitions))
    if (!existing.has(name))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
function volcAssetReference(value) {
  const ref = String(value || "").trim();
  if (!ref || ref.length > 500 || ref.includes("\0") || /[\r\n]/.test(ref))
    throw Object.assign(new Error("仿真人资产引用无效"), {
      status: 400,
      code: "invalid_volc_asset_reference",
    });
  return ref;
}
function volcAssetMediaKind(value) {
  const kind = String(value || "");
  if (!VOLC_ASSET_MEDIA_KINDS.has(kind))
    throw Object.assign(new Error("仿真人资产媒体类型无效"), {
      status: 400,
      code: "invalid_volc_asset_media_kind",
    });
  return kind;
}
function volcAssetBindingRow(row) {
  if (!row) return null;
  return {
    localRef: row.local_ref,
    projectId: row.project_id || undefined,
    mediaKind: row.media_kind,
    classification: row.classification,
    status: row.status,
    provider: row.provider,
    assetId: row.asset_id || undefined,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
    checkedAt: row.checked_at || undefined,
    expiresAt: row.expires_at || undefined,
    generationStatus: VOLC_ASSET_GENERATION_STATUSES.has(row.generation_status)
      ? row.generation_status
      : "unverified",
    generationChannelId: row.generation_channel_id || undefined,
    generationErrorCode: row.generation_error_code || undefined,
    generationErrorMessage: row.generation_error_message || undefined,
    generationProviderHttpStatus:
      row.generation_provider_http_status ?? undefined,
    generationProviderErrorCode:
      row.generation_provider_error_code || undefined,
    generationProviderErrorMessage:
      row.generation_provider_error_message || undefined,
    generationProviderRequestId:
      row.generation_provider_request_id || undefined,
    generationCheckedAt: row.generation_checked_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function readVolcAssetBinding(db, localRef) {
  return volcAssetBindingRow(
    db
      .prepare("SELECT * FROM asset_compliance_binding WHERE local_ref=?")
      .get(localRef),
  );
}
function ensureVolcAssetBinding(db, input) {
  const localRef = volcAssetReference(input.localRef);
  const mediaKind = volcAssetMediaKind(input.mediaKind);
  const projectId = String(input.projectId || "").slice(0, 200) || null;
  const existing = readVolcAssetBinding(db, localRef);
  if (existing) return existing;
  const now = isoNow();
  db.prepare(
    "INSERT INTO asset_compliance_binding(local_ref,project_id,media_kind,classification,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(localRef, projectId, mediaKind, "unclassified", "unverified", now, now);
  return readVolcAssetBinding(db, localRef);
}
function classifyVolcAssetBinding(db, input, credentialResolver) {
  const localRef = volcAssetReference(input.localRef);
  const mediaKind = volcAssetMediaKind(input.mediaKind);
  const classification = String(input.classification || "");
  if (
    !VOLC_ASSET_CLASSIFICATIONS.has(classification) ||
    !new Set(["ordinary", "real_person"]).has(classification)
  )
    throw Object.assign(new Error("当前阶段只允许标记为普通素材或仿真人素材"), {
      status: 400,
      code: "invalid_volc_asset_classification",
    });
  const projectId = String(input.projectId || "").slice(0, 200) || null;
  const now = isoNow();
  const registration =
    classification === "real_person"
      ? readVolcAssetRegistration(db, localRef)
      : null;
  const registrationStatus = registration
    ? volcAssetBindingStatusForRegistration(registration.status)
    : "";
  const status =
    classification === "ordinary"
      ? "not_required"
      : registrationStatus ||
        (hasVolcAssetCredentials(credentialResolver)
          ? "integration_pending"
          : "credentials_missing");
  const existing = readVolcAssetBinding(db, localRef);
  db.prepare(
    `INSERT INTO asset_compliance_binding(local_ref,project_id,media_kind,classification,status,asset_id,checked_at,generation_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(local_ref) DO UPDATE SET project_id=COALESCE(excluded.project_id,project_id),media_kind=excluded.media_kind,classification=excluded.classification,status=excluded.status,asset_id=excluded.asset_id,error_code=NULL,error_message=NULL,checked_at=excluded.checked_at,expires_at=NULL,updated_at=excluded.updated_at`,
  ).run(
    localRef,
    projectId,
    mediaKind,
    classification,
    status,
    registration?.assetId || null,
    now,
    classification === "ordinary" ? "not_required" : "unverified",
    now,
    now,
  );
  if (classification === "ordinary") {
    db.prepare(
      "UPDATE asset_compliance_binding SET generation_status='not_required',generation_channel_id=NULL,generation_error_code=NULL,generation_error_message=NULL,generation_provider_http_status=NULL,generation_provider_error_code=NULL,generation_provider_error_message=NULL,generation_provider_request_id=NULL,generation_checked_at=? WHERE local_ref=?",
    ).run(now, localRef);
  } else if (
    existing?.classification !== "real_person" ||
    (registration?.assetId && existing.assetId !== registration.assetId)
  ) {
    db.prepare(
      "UPDATE asset_compliance_binding SET generation_status='unverified',generation_channel_id=NULL,generation_error_code=NULL,generation_error_message=NULL,generation_provider_http_status=NULL,generation_provider_error_code=NULL,generation_provider_error_message=NULL,generation_provider_request_id=NULL,generation_checked_at=NULL WHERE local_ref=?",
    ).run(localRef);
  }
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.classify',?,?,?)",
  ).run(
    localRef,
    JSON.stringify({
      classification,
      status,
      projectId,
    }),
    now,
  );
  return readVolcAssetBinding(db, localRef);
}
function hasVolcAssetCredentials(credentialResolver) {
  try {
    return Boolean(
      credentialResolver(VOLCENGINE_ARK_ASSETS_ACCESS_KEY_TARGET) &&
      credentialResolver(VOLCENGINE_ARK_ASSETS_SECRET_KEY_TARGET),
    );
  } catch {
    return false;
  }
}
function normalizeVolcAssetReferences(references) {
  const unique = new Map();
  for (const input of Array.isArray(references)
    ? references.slice(0, 100)
    : []) {
    const localRef = volcAssetReference(input.localRef);
    if (!unique.has(localRef))
      unique.set(localRef, {
        ...input,
        localRef,
      });
  }
  return [...unique.values()];
}
function checkVolcAssetBindings(db, references, credentialResolver) {
  const credentialsConfigured = hasVolcAssetCredentials(credentialResolver);
  const normalizedReferences = normalizeVolcAssetReferences(references);
  const bindings = normalizedReferences.map((input) =>
    ensureVolcAssetBinding(db, input),
  );
  const checkedAt = isoNow();
  for (const binding of bindings) {
    if (binding.classification !== "real_person") continue;
    if (
      [
        "active",
        "processing",
        "pending_asset",
        "failed",
        "expired",
        "project_mismatch",
      ].includes(binding.status)
    )
      continue;
    const status = credentialsConfigured
      ? "integration_pending"
      : "credentials_missing";
    db.prepare(
      "UPDATE asset_compliance_binding SET status=?,checked_at=?,updated_at=? WHERE local_ref=?",
    ).run(status, checkedAt, checkedAt, binding.localRef);
  }
  return {
    credentialsConfigured,
    bindings: normalizedReferences.map((input) =>
      readVolcAssetBinding(db, input.localRef),
    ),
    registrations: normalizedReferences
      .map((input) => readVolcAssetRegistration(db, input.localRef))
      .filter(Boolean),
  };
}
function requiresVolcAssetPreflight(provider, model) {
  if (provider !== "volcengine-ark") return false;
  const name =
    String(model || "")
      .split("::")
      .pop() || "";
  return name.includes("seedance-2-0") || name.includes("seedance-2-5");
}
function preflightVolcAssets(db, input, credentialResolver) {
  const required = requiresVolcAssetPreflight(
    String(input.provider || ""),
    String(input.model || ""),
  );
  const references = normalizeVolcAssetReferences(input.references);
  if (!required)
    return {
      required: false,
      allowed: true,
      credentialsConfigured: hasVolcAssetCredentials(credentialResolver),
      bindings: [],
      blockers: [],
    };
  const checked = checkVolcAssetBindings(db, references, credentialResolver);
  const channelId =
    safeProviderIdentifier(input.channelId, 100) || "volcengine-ark-gx";
  const blockers = checked.bindings
    .filter((binding) => {
      if (!binding || !["not_required", "active"].includes(binding.status))
        return true;
      return (
        binding.status === "active" &&
        binding.generationStatus === "inaccessible" &&
        binding.generationChannelId === channelId
      );
    })
    .map((binding) => ({
      localRef: binding?.localRef,
      status: binding?.status || "unverified",
      classification: binding?.classification || "unclassified",
      errorCode: binding?.generationErrorCode || binding?.errorCode,
      errorMessage: binding?.generationErrorMessage || binding?.errorMessage,
      generationStatus: binding?.generationStatus,
      generationChannelId: binding?.generationChannelId,
    }));
  const visibilityProbeRequired =
    blockers.length === 0 &&
    checked.bindings.some(
      (binding) =>
        binding?.status === "active" &&
        (binding.generationStatus !== "verified" ||
          binding.generationChannelId !== channelId),
    );
  if (blockers.length) {
    const now = isoNow();
    for (const blocker of blockers)
      db.prepare(
        "UPDATE volc_asset_registration SET generation_waiting=1,next_poll_at=COALESCE(next_poll_at,?),updated_at=? WHERE local_ref=? AND status<>'active'",
      ).run(now, now, blocker.localRef);
  }
  return {
    required: true,
    allowed: blockers.length === 0,
    visibilityProbeRequired,
    channelId,
    credentialsConfigured: checked.credentialsConfigured,
    bindings: checked.bindings,
    blockers,
  };
}
const VOLC_ASSET_REGISTRATION_SELECT =
  "SELECT local_ref AS localRef,group_id AS groupId,project_name AS projectName,media_kind AS mediaKind,status,asset_id AS assetId,file_id AS fileId,mime_type AS mimeType,source_hash AS sourceHash,asset_name AS assetName,create_request_hash AS createRequestHash,staging_started_at AS stagingStartedAt,create_started_at AS createStartedAt,staging_poll_attempt_count AS stagingPollAttemptCount,poll_attempt_count AS pollAttemptCount,next_poll_at AS nextPollAt,delayed_at AS delayedAt,provider_http_status AS providerHttpStatus,error_code AS errorCode,error_message AS errorMessage,provider_error_code AS providerErrorCode,provider_error_message AS providerErrorMessage,provider_request_id AS providerRequestId,generation_waiting AS generationWaiting,submission_count AS submissionCount,created_at AS createdAt,updated_at AS updatedAt FROM volc_asset_registration";
function volcAssetBindingStatusForRegistration(status) {
  if (
    [
      "staging_queued",
      "staging_upload",
      "staging_processing",
      "relay_queued",
      "relay_starting",
      "submitting",
    ].includes(status)
  )
    return "pending_asset";
  if (
    [
      "staging_unknown",
      "submission_unknown",
      "reconciling",
      "accelerating",
      "processing",
      "delayed",
    ].includes(status)
  )
    return "processing";
  return status;
}
function safeVolcAssetProjectName(value) {
  const projectName = String(value || VOLC_ASSET_DEFAULT_PROJECT_NAME).trim();
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(projectName))
    throw Object.assign(new Error("火山项目名称无效"), {
      status: 400,
      code: "invalid_volc_asset_project_name",
    });
  return projectName;
}
function safeVolcAssetGroupId(value) {
  const groupId = String(value || "").trim();
  if (!/^group-[a-zA-Z0-9-]{8,200}$/.test(groupId))
    throw Object.assign(new Error("火山虚拟人像素材组 ID 无效"), {
      status: 400,
      code: "invalid_volc_asset_group_id",
    });
  return groupId;
}
function safeVolcAssetPublicUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw Object.assign(new Error("请提供素材的公网 HTTPS 地址"), {
      status: 400,
      code: "invalid_volc_asset_public_url",
    });
  }
  const hostname = url.hostname.toLowerCase();
  const ipHostname = hostname.replace(/^\[|\]$/g, "");
  const ipv4 =
    isIP(ipHostname) === 4 ? ipHostname.split(".").map(Number) : null;
  const privateIpv4 =
    ipv4 &&
    (ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      ipv4[0] === 0 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    privateIpv4 ||
    isIP(ipHostname) === 6
  ) {
    throw Object.assign(
      new Error(
        "素材 URL 必须是火山可访问的公网 HTTPS 地址，不能使用叙光本机地址",
      ),
      {
        status: 400,
        code: "invalid_volc_asset_public_url",
      },
    );
  }
  return url.toString();
}
function defaultVolcAssetCreatePayload({
  mediaKind,
  sourceUrl,
  name,
  groupId,
  projectName,
}) {
  return {
    AssetType: {
      image: "Image",
      video: "Video",
      audio: "Audio",
    }[mediaKind],
    GroupId: safeVolcAssetGroupId(groupId),
    Name:
      String(name || "Narralight asset")
        .trim()
        .slice(0, 64) || "Narralight asset",
    ProjectName: safeVolcAssetProjectName(projectName),
    URL: safeVolcAssetPublicUrl(sourceUrl),
  };
}
function detectVolcLocalMedia(path) {
  const bytes = Buffer.alloc(32);
  const handle = openSync(path, "r");
  let length = 0;
  try {
    length = readSync(handle, bytes, 0, bytes.length, 0);
  } finally {
    closeSync(handle);
  }
  const head = bytes.subarray(0, length);
  const ascii = head.toString("ascii");
  const hex = head.toString("hex");
  if (hex.startsWith("ffd8ff"))
    return {
      mediaKind: "image",
      mimeType: "image/jpeg",
      extension: "jpg",
    };
  if (hex.startsWith("89504e470d0a1a0a"))
    return {
      mediaKind: "image",
      mimeType: "image/png",
      extension: "png",
    };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP")
    return {
      mediaKind: "image",
      mimeType: "image/webp",
      extension: "webp",
    };
  if (ascii.startsWith("BM"))
    return {
      mediaKind: "image",
      mimeType: "image/bmp",
      extension: "bmp",
    };
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a"))
    return {
      mediaKind: "image",
      mimeType: "image/gif",
      extension: "gif",
    };
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a"))
    return {
      mediaKind: "image",
      mimeType: "image/tiff",
      extension: "tiff",
    };
  if (
    ascii.slice(4, 8) === "ftyp" &&
    /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(ascii.slice(8, 24))
  )
    return {
      mediaKind: "image",
      mimeType: "image/heic",
      extension: "heic",
    };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE")
    return {
      mediaKind: "audio",
      mimeType: "audio/wav",
      extension: "wav",
    };
  if (
    ascii.startsWith("ID3") ||
    (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
  )
    return {
      mediaKind: "audio",
      mimeType: "audio/mpeg",
      extension: "mp3",
    };
  if (ascii.slice(4, 8) === "ftyp") {
    const quickTime = ascii.slice(8, 16).includes("qt");
    return {
      mediaKind: "video",
      mimeType: quickTime ? "video/quicktime" : "video/mp4",
      extension: quickTime ? "mov" : "mp4",
    };
  }
  throw Object.assign(new Error("本机素材格式不在火山虚拟人像素材支持范围内"), {
    status: 400,
    code: "unsupported_volc_asset_media_format",
  });
}
function resolveVolcLocalObject(dataRoot, localRef, expectedMediaKind) {
  const match = /^storage:sha256:([a-f0-9]{64})$/i.exec(localRef);
  if (!match)
    throw Object.assign(new Error("仿真人素材必须先保存到叙光本机对象库"), {
      status: 409,
      code: "volc_asset_local_object_required",
    });
  const hash = match[1].toLowerCase();
  const path = objectPath(dataRoot, hash);
  if (!existsSync(path))
    throw Object.assign(new Error("叙光本机素材对象不存在"), {
      status: 404,
      code: "volc_asset_local_object_missing",
    });
  const detected = detectVolcLocalMedia(path);
  if (detected.mediaKind !== expectedMediaKind)
    throw Object.assign(new Error("本机素材内容与声明的媒体类型不一致"), {
      status: 400,
      code: "volc_asset_media_kind_mismatch",
    });
  const bytes = statSync(path).size;
  const limit =
    {
      image: 30,
      video: 50,
      audio: 15,
    }[expectedMediaKind] *
    1024 *
    1024;
  if (bytes > limit)
    throw Object.assign(
      new Error(
        `仿真人${expectedMediaKind === "image" ? "图片" : expectedMediaKind === "video" ? "视频" : "音频"}超过火山大小限制`,
      ),
      {
        status: 413,
        code: "volc_asset_file_too_large",
      },
    );
  return {
    hash,
    path,
    bytes,
    ...detected,
  };
}
function safeVolcAssetName(value) {
  return (
    String(value || "Narralight asset")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 64) || "Narralight asset"
  );
}
function buildVolcProviderAssetName({ mediaKind, sourceHash }) {
  const hash = String(sourceHash || "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 20);
  return safeVolcAssetName(
    ["Narralight", mediaKind, hash || "asset"].filter(Boolean).join("-"),
  );
}
function readVolcAssetRegistration(db, localRef) {
  const registration =
    db
      .prepare(`${VOLC_ASSET_REGISTRATION_SELECT} WHERE local_ref=?`)
      .get(localRef) || null;
  if (!registration) return null;
  registration.attempts = db
    .prepare(
      "SELECT attempt_id AS attemptId,ordinal,status,asset_id AS assetId,provider_http_status AS providerHttpStatus,provider_error_code AS providerErrorCode,provider_error_message AS providerErrorMessage,provider_request_id AS providerRequestId,submitted_at AS submittedAt,response_received_at AS responseReceivedAt,updated_at AS updatedAt FROM volc_asset_submission_attempt WHERE local_ref=? ORDER BY ordinal",
    )
    .all(localRef);
  return registration;
}
function persistVolcAigcGroup(db, group) {
  const now = isoNow();
  db.prepare(
    `INSERT INTO volc_asset_group(group_id,person_id,display_name,project_name,authorization_status,authorization_expires_at,source_account_scope,created_at,updated_at)
        VALUES(?,NULL,?,?,'active',NULL,'AIGC',?,?) ON CONFLICT(group_id) DO UPDATE SET display_name=excluded.display_name,project_name=excluded.project_name,authorization_status='active',source_account_scope='AIGC',updated_at=excluded.updated_at`,
  ).run(
    safeVolcAssetGroupId(group.id),
    String(group.name || VOLC_AIGC_GROUP_PREFIX).slice(0, 64),
    safeVolcAssetProjectName(group.projectName),
    now,
    now,
  );
  return {
    id: safeVolcAssetGroupId(group.id),
    name: String(group.name || "").slice(0, 64),
    projectName: safeVolcAssetProjectName(group.projectName),
  };
}
async function resolveVolcAigcGroup(db, client, inputProjectName) {
  const projectName = safeVolcAssetProjectName(inputProjectName);
  const local = db
    .prepare(
      "SELECT group_id AS id,display_name AS name,project_name AS projectName FROM volc_asset_group WHERE source_account_scope='AIGC' AND authorization_status='active' AND project_name=? ORDER BY updated_at DESC LIMIT 1",
    )
    .get(projectName);
  if (local?.id)
    return {
      ...local,
      id: safeVolcAssetGroupId(local.id),
      projectName: safeVolcAssetProjectName(local.projectName),
    };
  const listed = await client.listAssetGroups({
    Filter: {
      GroupType: "AIGC",
      Name: VOLC_AIGC_GROUP_PREFIX,
    },
    PageNumber: 1,
    PageSize: 50,
    ProjectName: projectName,
    SortBy: "CreateTime",
    SortOrder: "Desc",
  });
  if (listed.state === "failed")
    throw Object.assign(
      new Error(listed.providerError?.message || "查询火山虚拟人像素材组失败"),
      {
        code: listed.providerError?.code || "list_aigc_asset_groups_failed",
      },
    );
  const existing = listed.items.find(
    (item) =>
      item.groupType === "AIGC" &&
      item.projectName === projectName &&
      item.name.startsWith(VOLC_AIGC_GROUP_PREFIX),
  );
  if (existing) return persistVolcAigcGroup(db, existing);
  const name = `${VOLC_AIGC_GROUP_PREFIX}${randomUUID().slice(0, 8)}`;
  const created = await client.createAssetGroup({
    Name: name,
    Description: "Narralight virtual avatar assets",
    GroupType: "AIGC",
    ProjectName: projectName,
  });
  if (created.state === "failed" || !created.groupId)
    throw Object.assign(
      new Error(created.providerError?.message || "创建叙光虚拟人像素材组失败"),
      {
        code: created.providerError?.code || "create_aigc_asset_group_failed",
      },
    );
  const group = persistVolcAigcGroup(db, {
    id: created.groupId,
    name,
    projectName,
  });
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset_group.create',?,?,?)",
  ).run(
    group.id,
    JSON.stringify({
      groupType: "AIGC",
      projectName: group.projectName,
    }),
    isoNow(),
  );
  return group;
}
function assetProviderError(result) {
  return {
    httpStatus: result?.httpStatus ?? null,
    code: result?.providerError?.code || null,
    message: result?.providerError?.message || null,
    requestId: result?.providerError?.requestId || null,
  };
}
function updateVolcAssetBindingState(db, localRef, status, input = {}) {
  const now = input.now || isoNow();
  const current = readVolcAssetBinding(db, localRef);
  db.prepare(
    "UPDATE asset_compliance_binding SET status=?,asset_id=COALESCE(?,asset_id),error_code=?,error_message=?,checked_at=?,updated_at=? WHERE local_ref=?",
  ).run(
    status,
    input.assetId || null,
    input.errorCode || null,
    input.errorMessage || null,
    now,
    now,
    localRef,
  );
  if (input.assetId && current?.assetId && current.assetId !== input.assetId) {
    db.prepare(
      "UPDATE asset_compliance_binding SET generation_status='unverified',generation_channel_id=NULL,generation_error_code=NULL,generation_error_message=NULL,generation_provider_http_status=NULL,generation_provider_error_code=NULL,generation_provider_error_message=NULL,generation_provider_request_id=NULL,generation_checked_at=NULL WHERE local_ref=?",
    ).run(localRef);
  }
}
function startVolcAssetReview(db, dataRoot, input, inputProjectName) {
  const localRef = volcAssetReference(input.localRef);
  const mediaKind = volcAssetMediaKind(input.mediaKind);
  const binding = readVolcAssetBinding(db, localRef);
  if (!binding || binding.classification !== "real_person")
    throw Object.assign(
      new Error("只有已标记的仿真人素材可以提交火山虚拟人像审核"),
      {
        status: 409,
        code: "volc_asset_real_person_required",
      },
    );
  const existing = readVolcAssetRegistration(db, localRef);
  const projectName = safeVolcAssetProjectName(inputProjectName);
  const projectMigration = Boolean(
    existing && existing.projectName !== projectName,
  );
  const safeRetry = existing?.status === "failed";
  if (existing && !safeRetry && !projectMigration)
    return {
      registration: readVolcAssetRegistration(db, localRef),
      created: false,
    };
  const localObject = resolveVolcLocalObject(dataRoot, localRef, mediaKind);
  const assetName = buildVolcProviderAssetName({
    mediaKind,
    sourceHash: localObject.hash,
  });
  const now = isoNow();
  const queueHash = createHash("sha256")
    .update(
      JSON.stringify({
        localRef,
        mediaKind,
        sourceHash: localObject.hash,
        assetName,
        projectName,
      }),
    )
    .digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing)
      db.prepare(
        "DELETE FROM volc_asset_submission_attempt WHERE local_ref=?",
      ).run(localRef);
    db.prepare(
      `INSERT INTO volc_asset_registration(local_ref,group_id,project_name,media_kind,status,validation_session_id,file_id,mime_type,source_hash,asset_name,create_request_hash,staging_started_at,create_started_at,staging_poll_attempt_count,poll_attempt_count,next_poll_at,delayed_at,provider_http_status,error_code,error_message,provider_error_code,provider_error_message,provider_request_id,created_at,updated_at)
            VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,NULL,NULL,0,0,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?,?)
            ON CONFLICT(local_ref) DO UPDATE SET group_id='',project_name=excluded.project_name,media_kind=excluded.media_kind,status=excluded.status,asset_id=NULL,validation_session_id=NULL,file_id=NULL,mime_type=excluded.mime_type,source_hash=excluded.source_hash,asset_name=excluded.asset_name,create_request_hash=excluded.create_request_hash,staging_started_at=NULL,create_started_at=NULL,staging_poll_attempt_count=0,poll_attempt_count=0,next_poll_at=excluded.next_poll_at,delayed_at=NULL,provider_http_status=NULL,error_code=NULL,error_message=NULL,provider_error_code=NULL,provider_error_message=NULL,provider_request_id=NULL,generation_waiting=0,submission_count=0,updated_at=excluded.updated_at`,
    ).run(
      localRef,
      "",
      projectName,
      mediaKind,
      "relay_queued",
      localObject.mimeType,
      localObject.hash,
      assetName,
      queueHash,
      now,
      now,
      now,
    );
    updateVolcAssetBindingState(db, localRef, "pending_asset", {
      now,
    });
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.review_queued',?,?,?)",
  ).run(
    localRef,
    JSON.stringify({
      mediaKind,
      sourceHash: localObject.hash,
      projectName,
      previousProjectName: projectMigration ? existing.projectName : undefined,
    }),
    now,
  );
  return {
    registration: readVolcAssetRegistration(db, localRef),
    created: true,
  };
}
function startVolcAssetReviewBatch(
  db,
  dataRoot,
  references,
  inputProjectName,
  credentialResolver,
) {
  return references.map((input) => {
    try {
      const localRef = volcAssetReference(input.localRef);
      const mediaKind = volcAssetMediaKind(input.mediaKind);
      const currentBinding = readVolcAssetBinding(db, localRef);
      if (currentBinding?.classification === "ordinary")
        return {
          localRef,
          binding: currentBinding,
          skipped: true,
        };
      const binding = classifyVolcAssetBinding(
        db,
        {
          ...input,
          localRef,
          mediaKind,
          classification: "real_person",
        },
        credentialResolver,
      );
      const existing = readVolcAssetRegistration(db, localRef);
      const projectName = safeVolcAssetProjectName(inputProjectName);
      const projectMigration = Boolean(
        existing && existing.projectName !== projectName,
      );
      if (projectMigration)
        return {
          localRef,
          binding: readVolcAssetBinding(db, localRef) || binding,
          registration: existing,
          error: "跨项目素材必须打开单份校验并显式迁移",
          code: "volc_asset_project_migration_requires_single",
        };
      const safeRetry = existing?.status === "failed";
      const result =
        existing && !safeRetry && !projectMigration
          ? {
              registration: existing,
              created: false,
            }
          : startVolcAssetReview(
              db,
              dataRoot,
              {
                ...input,
                localRef,
                mediaKind,
              },
              projectName,
            );
      return {
        localRef,
        binding: readVolcAssetBinding(db, localRef) || binding,
        registration: result.registration,
        created: result.created,
      };
    } catch (error) {
      const localRef =
        typeof input?.localRef === "string" ? input.localRef : "";
      return {
        localRef,
        binding: localRef ? readVolcAssetBinding(db, localRef) : undefined,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code || "volc_asset_batch_item_failed",
        httpStatus: Number(error?.status || 422),
      };
    }
  });
}
function failVolcAssetRegistration(
  db,
  registration,
  code,
  message,
  provider = {},
) {
  const now = isoNow();
  db.prepare(
    "UPDATE volc_asset_registration SET status='failed',next_poll_at=NULL,provider_http_status=?,error_code=?,error_message=?,provider_error_code=?,provider_error_message=?,provider_request_id=?,updated_at=? WHERE local_ref=?",
  ).run(
    provider.httpStatus ?? null,
    code,
    safeProviderMessage(message),
    provider.code || null,
    safeProviderMessage(provider.message || "") || null,
    provider.requestId || null,
    now,
    registration.localRef,
  );
  updateVolcAssetBindingState(db, registration.localRef, "failed", {
    assetId: registration.assetId,
    errorCode: code,
    errorMessage: safeProviderMessage(message),
    now,
  });
  return readVolcAssetRegistration(db, registration.localRef);
}
function promoteVolcAssetAttempt(
  db,
  registration,
  attempt,
  result,
  now = isoNow(),
) {
  if (registration.status === "active") return registration;
  const provider = assetProviderError(result);
  const status =
    result.state === "active"
      ? "active"
      : result.state === "failed"
        ? "failed"
        : "processing";
  db.prepare(
    "UPDATE volc_asset_submission_attempt SET status=?,asset_id=COALESCE(?,asset_id),provider_http_status=?,provider_error_code=?,provider_error_message=?,provider_request_id=?,response_received_at=COALESCE(response_received_at,?),next_check_at=?,poll_attempt_count=poll_attempt_count+1,updated_at=? WHERE attempt_id=?",
  ).run(
    status,
    result.assetId || attempt.assetId || null,
    provider.httpStatus,
    provider.code,
    provider.message,
    provider.requestId,
    now,
    status === "processing" ? now : null,
    now,
    attempt.attemptId,
  );
  const assetId = result.assetId || attempt.assetId;
  if (assetId)
    db.prepare(
      `INSERT INTO volc_asset(asset_id,local_ref,media_kind,status,error_code,error_message,project_name,last_checked_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET status=excluded.status,error_code=excluded.error_code,error_message=excluded.error_message,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`,
    ).run(
      assetId,
      registration.localRef,
      registration.mediaKind,
      status,
      provider.code,
      provider.message,
      registration.projectName,
      now,
      attempt.submittedAt || now,
      now,
    );
  if (status === "active" && assetId) {
    db.prepare(
      "UPDATE volc_asset_registration SET status='active',asset_id=?,next_poll_at=NULL,provider_http_status=?,error_code=NULL,error_message=NULL,provider_error_code=NULL,provider_error_message=NULL,provider_request_id=?,updated_at=? WHERE local_ref=?",
    ).run(
      assetId,
      provider.httpStatus,
      provider.requestId,
      now,
      registration.localRef,
    );
    updateVolcAssetBindingState(db, registration.localRef, "active", {
      assetId,
      now,
    });
    db.prepare(
      "UPDATE volc_asset_submission_attempt SET status='redundant',updated_at=? WHERE local_ref=? AND attempt_id<>? AND status NOT IN ('active','failed')",
    ).run(now, registration.localRef, attempt.attemptId);
  } else if (
    status === "processing" &&
    assetId &&
    registration.status !== "active"
  ) {
    db.prepare(
      "UPDATE volc_asset_registration SET status='processing',asset_id=?,next_poll_at=?,provider_http_status=?,error_code=NULL,error_message=NULL,provider_error_code=NULL,provider_error_message=NULL,provider_request_id=?,updated_at=? WHERE local_ref=?",
    ).run(
      assetId,
      now,
      provider.httpStatus,
      provider.requestId,
      now,
      registration.localRef,
    );
    updateVolcAssetBindingState(db, registration.localRef, "processing", {
      assetId,
      now,
    });
  }
  return readVolcAssetRegistration(db, registration.localRef);
}
function launchVolcAssetAttempt(
  db,
  registration,
  downloadUrl,
  client,
  inflight,
  timings,
  submissionQueue,
  onUpdated,
) {
  const payload = defaultVolcAssetCreatePayload({
    mediaKind: registration.mediaKind,
    sourceUrl: downloadUrl,
    name: registration.assetName,
    groupId: registration.groupId,
    projectName: registration.projectName,
  });
  const requestHash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const startedAt = isoNow();
  const ordinal = Number(
    db
      .prepare(
        "SELECT COALESCE(MAX(ordinal),0)+1 AS value FROM volc_asset_submission_attempt WHERE local_ref=?",
      )
      .get(registration.localRef)?.value || 1,
  );
  const attemptId = randomUUID();
  const nextCheckAt = new Date(
    Date.parse(startedAt) + timings.reconcileAfterMs,
  ).toISOString();
  db.prepare(
    "INSERT INTO volc_asset_submission_attempt(attempt_id,local_ref,ordinal,status,request_hash,submitted_at,next_check_at,created_at,updated_at) VALUES(?,?,?,'submitting',?,?,?,?,?)",
  ).run(
    attemptId,
    registration.localRef,
    ordinal,
    requestHash,
    startedAt,
    nextCheckAt,
    startedAt,
    startedAt,
  );
  db.prepare(
    "UPDATE volc_asset_registration SET status=?,create_request_hash=?,create_started_at=COALESCE(create_started_at,?),submission_count=?,next_poll_at=?,error_code=NULL,error_message=NULL,updated_at=? WHERE local_ref=?",
  ).run(
    ordinal > 1 ? "accelerating" : "submitting",
    requestHash,
    startedAt,
    ordinal,
    nextCheckAt,
    startedAt,
    registration.localRef,
  );
  updateVolcAssetBindingState(db, registration.localRef, "pending_asset", {
    now: startedAt,
  });
  const notify = () => {
    try {
      const latest = readVolcAssetRegistration(db, registration.localRef);
      if (latest && onUpdated) onUpdated(latest);
      return latest;
    } catch {
      return null;
    }
  };
  const task = submissionQueue
    .run(() => client.createAsset(payload))
    .then((result) => {
      const current = readVolcAssetRegistration(db, registration.localRef);
      const attempt = db
        .prepare(
          "SELECT attempt_id AS attemptId,asset_id AS assetId,submitted_at AS submittedAt FROM volc_asset_submission_attempt WHERE attempt_id=?",
        )
        .get(attemptId);
      if (!current || !attempt) return;
      if (result.state === "failed" || !result.assetId) {
        const provider = assetProviderError(result);
        const now = isoNow();
        const transient = [429, 502, 503, 504].includes(
          Number(provider.httpStatus),
        );
        db.prepare(
          "UPDATE volc_asset_submission_attempt SET status='failed',provider_http_status=?,provider_error_code=?,provider_error_message=?,provider_request_id=?,response_received_at=?,next_check_at=NULL,updated_at=? WHERE attempt_id=?",
        ).run(
          provider.httpStatus,
          provider.code || "create_asset_failed",
          provider.message || "火山未返回 Asset ID",
          provider.requestId,
          now,
          now,
          attemptId,
        );
        if (transient) {
          db.prepare(
            "UPDATE volc_asset_submission_attempt SET status='response_missing',next_check_at=? WHERE attempt_id=?",
          ).run(nextCheckAt, attemptId);
          db.prepare(
            "UPDATE volc_asset_registration SET status='reconciling',next_poll_at=?,error_code='asset_recovery_pending',error_message='供应商暂时繁忙，素材正在后台重试',updated_at=? WHERE local_ref=? AND status<>'active'",
          ).run(nextCheckAt, now, registration.localRef);
        } else {
          db.prepare(
            "UPDATE volc_asset_registration SET status='reconciling',next_poll_at=?,error_code='asset_create_retry_pending',error_message='素材正在后台准备，可继续制作',updated_at=? WHERE local_ref=? AND status<>'active'",
          ).run(now, now, registration.localRef);
        }
        notify();
        return;
      }
      promoteVolcAssetAttempt(db, current, attempt, result);
      notify();
    })
    .catch((error) => {
      const now = isoNow();
      try {
        db.prepare(
          "UPDATE volc_asset_submission_attempt SET status='response_missing',provider_error_code='create_asset_response_missing',provider_error_message=?,next_check_at=?,updated_at=? WHERE attempt_id=?",
        ).run(
          safeProviderMessage(
            error instanceof Error ? error.message : String(error),
          ),
          nextCheckAt,
          now,
          attemptId,
        );
        db.prepare(
          "UPDATE volc_asset_registration SET status='reconciling',next_poll_at=?,error_code='asset_recovery_pending',error_message='素材正在后台准备，可继续制作',updated_at=? WHERE local_ref=? AND status<>'active'",
        ).run(nextCheckAt, now, registration.localRef);
        updateVolcAssetBindingState(db, registration.localRef, "processing", {
          errorCode: "asset_recovery_pending",
          errorMessage: "素材正在后台准备，可继续制作",
          now,
        });
        notify();
      } catch {}
    })
    .finally(() => inflight.delete(attemptId));
  inflight.set(attemptId, task);
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.create_attempt',?,?,?)",
  ).run(
    registration.localRef,
    JSON.stringify({
      attemptId,
      ordinal,
    }),
    startedAt,
  );
  return notify();
}
async function submitVolcAssetThroughRelay(
  db,
  dataRoot,
  registration,
  groupResolver,
  relayManager,
  assetClient,
  inflight,
  timings,
  submissionQueue,
  onUpdated,
) {
  const media = resolveVolcLocalObject(
    dataRoot,
    registration.localRef,
    registration.mediaKind,
  );
  const startedAt = isoNow();
  db.prepare(
    "UPDATE volc_asset_registration SET status='relay_starting',mime_type=?,source_hash=?,asset_name=?,staging_started_at=?,next_poll_at=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE local_ref=?",
  ).run(
    media.mimeType,
    media.hash,
    safeVolcAssetName(registration.assetName),
    startedAt,
    startedAt,
    registration.localRef,
  );
  onUpdated?.(readVolcAssetRegistration(db, registration.localRef));
  let group;
  try {
    group = await groupResolver();
  } catch (error) {
    return failVolcAssetRegistration(
      db,
      registration,
      error?.code || "aigc_asset_group_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  db.prepare(
    "UPDATE volc_asset_registration SET group_id=?,project_name=?,updated_at=? WHERE local_ref=?",
  ).run(group.id, group.projectName, isoNow(), registration.localRef);
  const current = readVolcAssetRegistration(db, registration.localRef);
  let relay;
  try {
    relay = await relayManager.start({
      key: registration.localRef,
      filePath: media.path,
      mimeType: media.mimeType,
      fileName: `${safeVolcAssetName(registration.assetName)}.${media.extension}`,
    });
  } catch (error) {
    return failVolcAssetRegistration(
      db,
      current,
      error?.code || "volc_asset_relay_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  return launchVolcAssetAttempt(
    db,
    current,
    relay.publicUrl,
    assetClient,
    inflight,
    timings,
    submissionQueue,
    onUpdated,
  );
}
async function submitVolcAssetsThroughSharedRelay(
  db,
  dataRoot,
  registrations,
  groupResolver,
  relayManager,
  assetClient,
  inflight,
  timings,
  submissionQueue,
  concurrency,
  onUpdated,
) {
  if (!registrations.length) return [];
  if (typeof relayManager.startVolcGroup !== "function") {
    return mapWithConcurrency(registrations, concurrency, (registration) =>
      submitVolcAssetThroughRelay(
        db,
        dataRoot,
        registration,
        groupResolver,
        relayManager,
        assetClient,
        inflight,
        timings,
        submissionQueue,
        onUpdated,
      ),
    );
  }
  const prepared = [];
  const results = [];
  for (const registration of registrations) {
    try {
      const media = resolveVolcLocalObject(
        dataRoot,
        registration.localRef,
        registration.mediaKind,
      );
      const startedAt = isoNow();
      db.prepare(
        "UPDATE volc_asset_registration SET status='relay_starting',mime_type=?,source_hash=?,asset_name=?,staging_started_at=?,next_poll_at=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE local_ref=?",
      ).run(
        media.mimeType,
        media.hash,
        safeVolcAssetName(registration.assetName),
        startedAt,
        startedAt,
        registration.localRef,
      );
      const current = readVolcAssetRegistration(db, registration.localRef);
      onUpdated?.(current);
      prepared.push({
        registration: current,
        media,
      });
    } catch (error) {
      const failed = failVolcAssetRegistration(
        db,
        registration,
        error?.code || "volc_asset_relay_file_missing",
        error instanceof Error ? error.message : String(error),
      );
      onUpdated?.(failed);
      results.push(failed);
    }
  }
  if (!prepared.length) return results;
  let group;
  try {
    group = await groupResolver();
  } catch (error) {
    for (const item of prepared) {
      const failed = failVolcAssetRegistration(
        db,
        item.registration,
        error?.code || "aigc_asset_group_failed",
        error instanceof Error ? error.message : String(error),
      );
      onUpdated?.(failed);
      results.push(failed);
    }
    return results;
  }
  for (const item of prepared) {
    db.prepare(
      "UPDATE volc_asset_registration SET group_id=?,project_name=?,updated_at=? WHERE local_ref=?",
    ).run(group.id, group.projectName, isoNow(), item.registration.localRef);
    item.registration = readVolcAssetRegistration(
      db,
      item.registration.localRef,
    );
  }
  let relay;
  try {
    relay = await relayManager.startVolcGroup({
      key: `volc-assets:${randomUUID()}`,
      files: prepared.map(({ registration, media }) => ({
        key: registration.localRef,
        filePath: media.path,
        mimeType: media.mimeType,
        fileName: `${safeVolcAssetName(registration.assetName)}.${media.extension}`,
      })),
    });
  } catch (error) {
    for (const item of prepared) {
      const failed = failVolcAssetRegistration(
        db,
        item.registration,
        error?.code || "volc_asset_relay_failed",
        error instanceof Error ? error.message : String(error),
      );
      onUpdated?.(failed);
      results.push(failed);
    }
    return results;
  }
  const relays = new Map((relay.items || []).map((item) => [item.key, item]));
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    const publicRelay =
      relays.get(item.registration.localRef) ||
      (relay.publicUrls?.[index]
        ? {
            publicUrl: relay.publicUrls[index],
          }
        : undefined);
    if (!publicRelay?.publicUrl) {
      const failed = failVolcAssetRegistration(
        db,
        item.registration,
        publicRelay?.code || "volc_asset_relay_public_check_failed",
        publicRelay?.error || "临时公网素材地址无法从公网读取",
      );
      relayManager.stop(item.registration.localRef);
      onUpdated?.(failed);
      results.push(failed);
      continue;
    }
    results.push(
      launchVolcAssetAttempt(
        db,
        item.registration,
        publicRelay.publicUrl,
        assetClient,
        inflight,
        timings,
        submissionQueue,
        onUpdated,
      ),
    );
  }
  return results;
}
async function reconcileVolcAssetRegistration(
  db,
  dataRoot,
  registration,
  client,
  groupResolver,
  relayManager,
  inflight,
  timings,
  submissionQueue,
  onUpdated,
) {
  const now = isoNow();
  const before = db
    .prepare(
      "SELECT ordinal,status,asset_id AS assetId,submitted_at AS submittedAt FROM volc_asset_submission_attempt WHERE local_ref=? ORDER BY ordinal",
    )
    .all(registration.localRef);
  const beforeElapsed = Math.max(
    0,
    Date.parse(now) -
      Date.parse(before[0]?.submittedAt || registration.createStartedAt || now),
  );
  const beforeHasRemoteId = before.some((attempt) => attempt.assetId);
  const urgentSecond =
    before.length < 2 &&
    (before.every((attempt) => attempt.status === "failed") ||
      (!beforeHasRemoteId && beforeElapsed >= timings.hedgeAfterMs) ||
      (beforeHasRemoteId && beforeElapsed >= timings.backupAfterMs));
  const urgentThird =
    registration.generationWaiting &&
    before.length < 3 &&
    beforeElapsed >= timings.generationHedgeAfterMs;
  if (
    (urgentSecond || urgentThird) &&
    registration.errorCode !== "asset_recovery_pending"
  )
    return submitVolcAssetThroughRelay(
      db,
      dataRoot,
      registration,
      groupResolver,
      relayManager,
      client,
      inflight,
      timings,
      submissionQueue,
      onUpdated,
    );
  try {
    const listed = await client.listAssets({
      Filter: {
        GroupType: "AIGC",
        GroupIds: [registration.groupId],
        Name: registration.assetName,
      },
      PageNumber: 1,
      PageSize: 100,
      ProjectName: registration.projectName,
      SortBy: "CreateTime",
      SortOrder: "Desc",
    });
    if (listed.state !== "failed") {
      for (const item of listed.items.filter(
        (candidate) =>
          candidate.name === registration.assetName &&
          candidate.groupId === registration.groupId &&
          candidate.projectName === registration.projectName,
      )) {
        let attempt = db
          .prepare(
            "SELECT attempt_id AS attemptId,asset_id AS assetId,submitted_at AS submittedAt FROM volc_asset_submission_attempt WHERE asset_id=?",
          )
          .get(item.id);
        if (!attempt) {
          attempt = db
            .prepare(
              "SELECT attempt_id AS attemptId,asset_id AS assetId,submitted_at AS submittedAt FROM volc_asset_submission_attempt WHERE local_ref=? AND asset_id IS NULL AND status IN ('submitting','response_missing') ORDER BY ordinal LIMIT 1",
            )
            .get(registration.localRef);
          if (attempt)
            db.prepare(
              "UPDATE volc_asset_submission_attempt SET asset_id=?,status=?,response_received_at=?,next_check_at=?,updated_at=? WHERE attempt_id=?",
            ).run(item.id, item.state, now, now, now, attempt.attemptId);
          else {
            const ordinal = Number(
              db
                .prepare(
                  "SELECT COALESCE(MAX(ordinal),0)+1 AS value FROM volc_asset_submission_attempt WHERE local_ref=?",
                )
                .get(registration.localRef)?.value || 1,
            );
            const attemptId = randomUUID();
            db.prepare(
              "INSERT INTO volc_asset_submission_attempt(attempt_id,local_ref,ordinal,status,asset_id,request_hash,submitted_at,response_received_at,next_check_at,created_at,updated_at) VALUES(?,?,?,?,?,'reconciled',?,?,?,?,?)",
            ).run(
              attemptId,
              registration.localRef,
              ordinal,
              item.state,
              item.id,
              item.createTime || now,
              now,
              now,
              now,
              now,
            );
            attempt = {
              attemptId,
              assetId: item.id,
              submittedAt: item.createTime || now,
            };
          }
        }
        if (attempt) {
          const promoted = promoteVolcAssetAttempt(
            db,
            readVolcAssetRegistration(db, registration.localRef),
            {
              ...attempt,
              assetId: item.id,
            },
            {
              ...item,
              assetId: item.id,
              httpStatus: listed.httpStatus,
            },
          );
          if (promoted.status === "active") {
            relayManager.stop(registration.localRef);
            return promoted;
          }
        }
      }
    }
  } catch {}
  let current = readVolcAssetRegistration(db, registration.localRef);
  if (current.status === "active") {
    relayManager.stop(registration.localRef);
    return current;
  }
  const attempts = db
    .prepare(
      "SELECT attempt_id AS attemptId,ordinal,status,asset_id AS assetId,provider_http_status AS providerHttpStatus,provider_error_code AS providerErrorCode,provider_error_message AS providerErrorMessage,provider_request_id AS providerRequestId,submitted_at AS submittedAt FROM volc_asset_submission_attempt WHERE local_ref=? ORDER BY ordinal",
    )
    .all(registration.localRef);
  for (const attempt of attempts.filter(
    (item) =>
      item.assetId && !["active", "failed", "redundant"].includes(item.status),
  )) {
    try {
      const result = await client.getAsset(
        attempt.assetId,
        registration.projectName || VOLC_ASSET_DEFAULT_PROJECT_NAME,
      );
      current = promoteVolcAssetAttempt(db, current, attempt, result);
      if (current.status === "active") {
        relayManager.stop(registration.localRef);
        return current;
      }
    } catch {}
  }
  current = readVolcAssetRegistration(db, registration.localRef);
  const refreshed = db
    .prepare(
      "SELECT ordinal,status,asset_id AS assetId,provider_http_status AS providerHttpStatus,provider_error_code AS providerErrorCode,provider_error_message AS providerErrorMessage,provider_request_id AS providerRequestId,submitted_at AS submittedAt FROM volc_asset_submission_attempt WHERE local_ref=? ORDER BY ordinal",
    )
    .all(registration.localRef);
  const firstSubmitted = Date.parse(
    refreshed[0]?.submittedAt || current.createStartedAt || now,
  );
  const elapsed = Math.max(0, Date.parse(now) - firstSubmitted);
  const hasRemoteId = refreshed.some((attempt) => attempt.assetId);
  const maxAttempts = current.generationWaiting ? 3 : 2;
  const needsSecond =
    refreshed.length < 2 &&
    (refreshed.every((attempt) => attempt.status === "failed") ||
      (!hasRemoteId && elapsed >= timings.hedgeAfterMs) ||
      (hasRemoteId && elapsed >= timings.backupAfterMs));
  const needsThird =
    current.generationWaiting &&
    refreshed.length < 3 &&
    elapsed >= timings.generationHedgeAfterMs;
  if ((needsSecond || needsThird) && refreshed.length < maxAttempts)
    return submitVolcAssetThroughRelay(
      db,
      dataRoot,
      current,
      groupResolver,
      relayManager,
      client,
      inflight,
      timings,
      submissionQueue,
      onUpdated,
    );
  const allExplicitFailed =
    refreshed.length >= maxAttempts &&
    refreshed.every((attempt) => attempt.status === "failed");
  if (allExplicitFailed) {
    const providerFailure =
      [...refreshed]
        .reverse()
        .find(
          (attempt) =>
            attempt.providerHttpStatus ||
            attempt.providerErrorCode ||
            attempt.providerErrorMessage ||
            attempt.providerRequestId,
        ) || {};
    return failVolcAssetRegistration(
      db,
      current,
      "asset_attempts_failed",
      "火山明确返回素材创建失败，可重新提交审核",
      {
        httpStatus: providerFailure.providerHttpStatus,
        code: providerFailure.providerErrorCode,
        message: providerFailure.providerErrorMessage,
        requestId: providerFailure.providerRequestId,
      },
    );
  }
  const next = new Date(
    Date.parse(now) + Math.min(5_000, timings.reconcileAfterMs),
  ).toISOString();
  db.prepare(
    "UPDATE volc_asset_registration SET status=?,next_poll_at=?,poll_attempt_count=poll_attempt_count+1,error_code=NULL,error_message=NULL,provider_error_code=NULL,provider_error_message=NULL,updated_at=? WHERE local_ref=? AND status<>'active'",
  ).run(
    refreshed.length > 1
      ? "accelerating"
      : hasRemoteId
        ? "processing"
        : "reconciling",
    next,
    now,
    registration.localRef,
  );
  updateVolcAssetBindingState(db, registration.localRef, "processing", {
    assetId: current.assetId,
    now,
  });
  return readVolcAssetRegistration(db, registration.localRef);
}
async function pollDueVolcAssetRegistrations(
  db,
  dataRoot,
  assetClient,
  groupResolver,
  relayManager,
  inflight,
  timings,
  submissionQueue,
  concurrency,
  onUpdated,
) {
  const due = db
    .prepare(
      `${VOLC_ASSET_REGISTRATION_SELECT} WHERE next_poll_at<=? AND status IN ('relay_queued','submitting','submission_unknown','reconciling','accelerating','processing','delayed') ORDER BY next_poll_at LIMIT ?`,
    )
    .all(isoNow(), VOLC_ASSET_POLL_SCAN_LIMIT);
  const updated = [];
  let failed = 0;
  const record = (next) => {
    if (!next) return;
    updated.push(next);
    onUpdated?.(next);
  };
  const queued = due.filter(
    (registration) => registration.status === "relay_queued",
  );
  const reconciling = due.filter(
    (registration) => registration.status !== "relay_queued",
  );
  await Promise.all([
    submitVolcAssetsThroughSharedRelay(
      db,
      dataRoot,
      queued,
      groupResolver,
      relayManager,
      assetClient,
      inflight,
      timings,
      submissionQueue,
      concurrency,
      onUpdated,
    )
      .then((items) => items.forEach(record))
      .catch(() => {
        failed += queued.length;
      }),
    mapWithConcurrency(reconciling, concurrency, async (registration) => {
      try {
        record(
          await reconcileVolcAssetRegistration(
            db,
            dataRoot,
            registration,
            assetClient,
            groupResolver,
            relayManager,
            inflight,
            timings,
            submissionQueue,
            onUpdated,
          ),
        );
      } catch {
        failed += 1;
      }
    }),
  ]);
  return {
    checked: due.length,
    updated,
    failed,
  };
}
function directoryUsage(root) {
  if (!existsSync(root))
    return {
      bytes: 0,
      files: 0,
    };
  const stack = [root];
  let bytes = 0;
  let files = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, {
      withFileTypes: true,
    })) {
      const target = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) {
        bytes += statSync(target).size;
        files += 1;
      }
    }
  }
  return {
    bytes,
    files,
  };
}
function platformStorageUsage(dataRoot, dbPath) {
  const total = directoryUsage(dataRoot);
  const objects = directoryUsage(join(dataRoot, "objects"));
  const backups = directoryUsage(join(dataRoot, "backups"));
  const agent = directoryUsage(join(dataRoot, "agent"));
  const logs = directoryUsage(join(dataRoot, "logs"));
  const databaseBytes = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].reduce(
    (sum, file) => sum + (existsSync(file) ? statSync(file).size : 0),
    0,
  );
  const disk = statfsSync(dataRoot);
  const diskTotalBytes = disk.blocks * disk.bsize;
  const diskFreeBytes = disk.bavail * disk.bsize;
  return {
    dataRoot,
    totalBytes: total.bytes,
    totalFiles: total.files,
    databaseBytes,
    objects,
    backups,
    agent,
    logs,
    disk: {
      totalBytes: diskTotalBytes,
      freeBytes: diskFreeBytes,
      usedBytes: Math.max(0, diskTotalBytes - diskFreeBytes),
    },
  };
}
function storeSecret(db, scope, key, value) {
  if (!value || value === "server-managed") return;
  db.prepare(
    "INSERT INTO secret_value(scope,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  ).run(scope, key, value, isoNow());
}
function parseAiConfigState(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw Object.assign(new Error("模型配置格式无效"), {
      status: 400,
      code: "ai_config_state_invalid",
    });
  }
  const state = parsed?.state;
  const config = state?.config;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !config ||
    typeof config !== "object" ||
    Array.isArray(config)
  ) {
    throw Object.assign(new Error("模型配置格式无效"), {
      status: 400,
      code: "ai_config_state_invalid",
    });
  }
  return {
    parsed,
    state,
    config,
  };
}
function projectApimartOfficialModels(config) {
  const names = [
    GROK_OFFICIAL_BASE_LOCAL,
    GROK_OFFICIAL_15_LOCAL,
    GROK_OFFICIAL_EDIT_LOCAL,
  ];
  return {
    ...config,
    channels: (config.channels || []).map((channel) => {
      if (
        channel.id !== "apimart" ||
        (channel.provider && channel.provider !== "apimart")
      )
        return channel;
      const models = (channel.models || []).filter(
        (model) => !names.includes(model.name),
      );
      return {
        ...channel,
        models: [
          ...models,
          ...names.map((name) => ({
            name,
            capability: "video",
          })),
        ],
      };
    }),
  };
}
function projectAiConfigState(value) {
  const { parsed, state, config } = parseAiConfigState(value);
  return JSON.stringify({
    ...parsed,
    state: {
      ...state,
      config: projectApimartOfficialModels(config),
    },
  });
}
function sanitizePersistedState(db, key, value, options = {}) {
  if (key !== "infinite-canvas:ai_config_store") return value;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  const state = parsed?.state;
  if (!state?.config) return value;
  state.config = projectApimartOfficialModels(state.config);
  for (const channel of state.config.channels || []) {
    if (
      channel.id === RICHBEST_CHANNEL_ID ||
      channel.provider === RICHBEST_CHANNEL_ID
    ) {
      channel.id = RICHBEST_CHANNEL_ID;
      channel.provider = RICHBEST_CHANNEL_ID;
      const testLoopback =
        options.allowRichBestLoopback === true &&
        /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(
          String(channel.baseUrl || ""),
        );
      if (!testLoopback) channel.baseUrl = RICHBEST_BASE_URL;
      channel.apiFormat = "openai";
      delete channel.credentialTarget;
    }
    const id = String(channel.id || "default");
    const credentialTarget = String(channel.credentialTarget || "");
    if (credentialTarget && ALLOWED_CREDENTIAL_TARGETS.has(credentialTarget)) {
      channel.apiKey = "server-managed";
    } else {
      storeSecret(db, "ai", id, channel.apiKey);
      channel.apiKey = db
        .prepare("SELECT 1 AS ok FROM secret_value WHERE scope='ai' AND key=?")
        .get(id)?.ok
        ? "server-managed"
        : "";
    }
  }
  storeSecret(db, "ai", "default", state.config.apiKey);
  state.config.apiKey = db
    .prepare(
      "SELECT 1 AS ok FROM secret_value WHERE scope='ai' AND key='default'",
    )
    .get()?.ok
    ? "server-managed"
    : "";
  if (state.webdav) {
    storeSecret(db, "webdav", "password", state.webdav.password);
    state.webdav.password = db
      .prepare(
        "SELECT 1 AS ok FROM secret_value WHERE scope='webdav' AND key='password'",
      )
      .get()?.ok
      ? "server-managed"
      : "";
  }
  return JSON.stringify(parsed);
}
function normalizeRichBestDescriptor(channel, options = {}) {
  if (
    channel?.id !== RICHBEST_CHANNEL_ID &&
    channel?.provider !== RICHBEST_CHANNEL_ID
  )
    return channel;
  const allowLoopback =
    options.allowRichBestLoopback === true &&
    /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(
      String(channel.baseUrl || ""),
    );
  const normalized = {
    ...channel,
    id: RICHBEST_CHANNEL_ID,
    provider: RICHBEST_CHANNEL_ID,
    baseUrl: allowLoopback ? channel.baseUrl : RICHBEST_BASE_URL,
    apiFormat: "openai",
  };
  delete normalized.credentialTarget;
  return normalized;
}
function normalizePersistedRichBestEndpoints(db, options = {}) {
  const key = "infinite-canvas:ai_config_store";
  const row = db
    .prepare("SELECT value,version FROM app_state WHERE key=?")
    .get(key);
  if (!row?.value) return false;
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return false;
  }
  const channels = parsed?.state?.config?.channels;
  if (!Array.isArray(channels)) return false;
  let changed = false;
  parsed.state.config.channels = channels.map((channel) => {
    const normalized = normalizeRichBestDescriptor(channel, options);
    if (normalized !== channel && !isDeepStrictEqual(normalized, channel))
      changed = true;
    return normalized;
  });
  const serialized = JSON.stringify(parsed);
  if (!changed || serialized === row.value) return false;
  const updatedAt = isoNow();
  db.exec("BEGIN IMMEDIATE");
  try {
    const updated = db
      .prepare(
        "UPDATE app_state SET value=?,version=version+1,updated_at=? WHERE key=? AND version=?",
      )
      .run(serialized, updatedAt, key, row.version);
    if (updated.changes !== 1)
      throw Object.assign(new Error("RichBest 渠道规范化遇到并发配置变化"), {
        code: "richbest_normalization_conflict",
      });
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('ai.richbest_endpoint_normalized',?,?,?)",
    ).run(
      RICHBEST_CHANNEL_ID,
      JSON.stringify({
        baseUrl: RICHBEST_BASE_URL,
      }),
      updatedAt,
    );
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
function readAiChannelDescriptor(db, id, options = {}) {
  const row = db
    .prepare(
      "SELECT value FROM app_state WHERE key='infinite-canvas:ai_config_store'",
    )
    .get();
  if (!row?.value)
    throw Object.assign(new Error("尚未配置模型渠道"), {
      status: 409,
    });
  const parsed = JSON.parse(row.value);
  const channels = parsed?.state?.config?.channels || [];
  const channel = channels.find((item) => String(item.id) === id);
  if (!channel)
    throw Object.assign(new Error("模型渠道不存在"), {
      status: 404,
    });
  try {
    if (
      new URL(channel.baseUrl).hostname === "888api.xin" &&
      channel.provider !== API888_PROVIDER
    )
      throw Object.assign(
        new Error("888API 固定域名不能作为自定义渠道绕过试点门禁"),
        {
          status: 403,
          code: "api888_provider_identity_required",
        },
      );
  } catch (error) {
    if (error?.code === "api888_provider_identity_required") throw error;
  }
  if (id === API888_CHANNEL_ID || channel.provider === API888_PROVIDER) {
    if (
      id !== API888_CHANNEL_ID ||
      channel.provider !== API888_PROVIDER ||
      channel.baseUrl !== API888_BASE_URL ||
      channel.credentialTarget !== API888_CREDENTIAL_TARGET ||
      channel.apiFormat !== "openai"
    )
      throw Object.assign(new Error("888API 渠道必须使用固定受信配置"), {
        status: 403,
        code: "api888_channel_invalid",
      });
  }
  return normalizeRichBestDescriptor(channel, options);
}
function readAiChannel(
  db,
  id,
  credentialResolver,
  credentialHosts,
  options = {},
) {
  const channel = readAiChannelDescriptor(db, id, options);
  const credentialTarget = String(channel.credentialTarget || "");
  let apiKey = "";
  if (credentialTarget) {
    if (!ALLOWED_CREDENTIAL_TARGETS.has(credentialTarget))
      throw Object.assign(new Error("模型渠道引用了未授权的系统凭据"), {
        status: 403,
      });
    const base = new URL(channel.baseUrl);
    if (
      !managedCredentialAllowed(
        channel,
        base,
        credentialTarget,
        credentialHosts,
      )
    )
      throw Object.assign(new Error("系统凭据只能用于固定的受信模型渠道"), {
        status: 403,
      });
    apiKey = credentialResolver(credentialTarget);
  } else {
    apiKey =
      db
        .prepare("SELECT value FROM secret_value WHERE scope='ai' AND key=?")
        .get(id)?.value || "";
  }
  if (!apiKey)
    throw Object.assign(new Error("模型渠道尚未保存 API Key"), {
      status: 409,
    });
  return {
    ...channel,
    apiKey,
  };
}
function readNetworkProxyConfig(db) {
  const row = db
    .prepare(
      "SELECT value FROM app_state WHERE key='infinite-canvas:ai_config_store'",
    )
    .get();
  if (!row?.value)
    return {
      enabled: false,
      channels: [],
      webdav: null,
    };
  const parsed = parseAiConfigState(row.value);
  return {
    enabled: parsed.config.proxyEnabled === true,
    channels: Array.isArray(parsed.config.channels)
      ? parsed.config.channels
      : [],
    webdav:
      parsed.state.webdav && typeof parsed.state.webdav === "object"
        ? parsed.state.webdav
        : null,
  };
}
function configuredNetworkProxyTarget(
  db,
  rawTarget,
  credentialResolver,
  credentialHosts,
  providerEndpointPolicy = {},
) {
  const config = readNetworkProxyConfig(db);
  if (!config.enabled)
    throw Object.assign(new Error("本机平台代理未开启"), {
      status: 409,
      code: "local_proxy_disabled",
    });
  let target;
  try {
    target = new URL(String(rawTarget || ""));
  } catch {
    throw Object.assign(new Error("代理目标地址无效"), {
      status: 400,
      code: "local_proxy_target_invalid",
    });
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.hash
  )
    throw Object.assign(new Error("代理目标地址无效"), {
      status: 400,
      code: "local_proxy_target_invalid",
    });
  for (const descriptor of config.channels) {
    let base;
    try {
      base = new URL(
        normalizeRichBestDescriptor(descriptor, providerEndpointPolicy).baseUrl,
      );
    } catch {
      continue;
    }
    if (!networkProxyPathMatches(target, base)) continue;
    const channel = readAiChannel(
      db,
      String(descriptor.id || ""),
      credentialResolver,
      credentialHosts,
      providerEndpointPolicy,
    );
    return {
      target,
      kind: "ai",
      authorization:
        channel.apiFormat === "gemini"
          ? {
              name: "x-goog-api-key",
              value: channel.apiKey,
            }
          : {
              name: "authorization",
              value: `Bearer ${channel.apiKey}`,
            },
    };
  }
  if (config.webdav?.url) {
    let base;
    try {
      base = new URL(String(config.webdav.url));
    } catch {
      base = null;
    }
    if (base && networkProxyPathMatches(target, base)) {
      const password =
        db
          .prepare(
            "SELECT value FROM secret_value WHERE scope='webdav' AND key='password'",
          )
          .get()?.value || "";
      const value = Buffer.from(
        `${String(config.webdav.username || "")}:${password}`,
      ).toString("base64");
      return {
        target,
        kind: "webdav",
        authorization: {
          name: "authorization",
          value: `Basic ${value}`,
        },
      };
    }
  }
  throw Object.assign(
    new Error("代理只允许访问已配置的模型渠道或 WebDAV 地址"),
    {
      status: 403,
      code: "local_proxy_target_not_configured",
    },
  );
}
function networkProxyPathMatches(target, base) {
  if (target.origin !== base.origin) return false;
  const root = base.pathname.replace(/\/+$/, "") || "/";
  return (
    root === "/" ||
    target.pathname === root ||
    target.pathname.startsWith(`${root}/`)
  );
}
async function proxyConfiguredNetworkRequest(
  req,
  res,
  url,
  db,
  credentialResolver,
  credentialHosts,
  providerEndpointPolicy = {},
) {
  const descriptor = configuredNetworkProxyTarget(
    db,
    url.searchParams.get("url"),
    credentialResolver,
    credentialHosts,
    providerEndpointPolicy,
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      !value ||
      [
        "host",
        "origin",
        "referer",
        "cookie",
        "authorization",
        "x-goog-api-key",
        "connection",
        "content-length",
      ].includes(name.toLowerCase()) ||
      name.toLowerCase().startsWith("sec-") ||
      name.toLowerCase().startsWith("x-narralight-")
    )
      continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  headers.set(descriptor.authorization.name, descriptor.authorization.value);
  const method = String(req.method || "GET").toUpperCase();
  const hasBody =
    !["GET", "HEAD"].includes(method) &&
    (Number(req.headers["content-length"] || 0) > 0 ||
      Boolean(req.headers["transfer-encoding"]));
  const response = await fetch(descriptor.target, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
    signal: ["GET", "HEAD"].includes(method) ? req.signal : undefined,
  });
  if (response.status >= 300 && response.status < 400)
    throw Object.assign(
      new Error("平台代理拒绝跨目标重定向，请在配置中填写最终地址"),
      {
        status: 502,
        code: "local_proxy_redirect_rejected",
      },
    );
  res.writeHead(response.status, proxyResponseHeaders(response));
  return pipeWebResponse(response, res);
}
function aiProxyRequestIdentity(pathname) {
  const suffix = pathname.slice("/api/local/ai/".length);
  const slash = suffix.indexOf("/");
  if (slash <= 0)
    throw Object.assign(new Error("无法识别模型渠道或请求路径"), {
      status: 400,
      code: "invalid_ai_proxy_route",
    });
  return {
    channelId: decodeURIComponent(suffix.slice(0, slash)),
    requestPath: suffix.slice(slash),
  };
}
function managedCredentialAllowed(
  channel,
  base,
  credentialTarget,
  credentialHosts,
) {
  if (
    !credentialHosts.has(base.hostname) ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && isLoopback(base.hostname)))
  )
    return false;
  if (credentialTarget === "MG_API_KEY") return channel.provider === "apimart";
  if (credentialTarget === VOLCENGINE_ARK_GX_CREDENTIAL_TARGET)
    return (
      channel.provider === "volcengine-ark" &&
      base.pathname.replace(/\/+$/, "") === "/api/v3"
    );
  if (credentialTarget === RUNNINGHUB_CREDENTIAL_TARGET)
    return (
      channel.provider === "runninghub" &&
      base.pathname.replace(/\/+$/, "") === RUNNINGHUB_BASE_PATH
    );
  if (credentialTarget === API888_CREDENTIAL_TARGET)
    return (
      channel.provider === API888_PROVIDER &&
      base.origin === API888_BASE_URL &&
      base.pathname === "/"
    );
  return false;
}
function assertVolcengineCredentialFormat(value) {
  if (/^[\x21-\x7e]+$/.test(value)) return;
  throw Object.assign(
    new Error(
      "火山 API Key 格式错误：请只保存原始密钥，不要包含“API Key：”标签、中文、全角符号、空格或换行",
    ),
    {
      status: 409,
      code: "credential_format_invalid",
    },
  );
}
async function readBuffer(req, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit)
      throw Object.assign(new Error("请求内容过大"), {
        status: 413,
      });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function joinUpstreamUrl(base, path, search) {
  const baseText = base.toString().replace(/\/$/, "");
  const basePath = base.pathname.replace(/\/+$/, "").toLowerCase();
  const versionedBase =
    basePath.endsWith("/v1") ||
    basePath.endsWith("/api/v3") ||
    basePath.endsWith("/api/plan/v3") ||
    basePath.endsWith(RUNNINGHUB_BASE_PATH);
  const joinedPath =
    versionedBase && path.startsWith("/v1/") ? path.slice(3) : path;
  return new URL(`${baseText}${joinedPath}${search}`);
}
function proxyResponseHeaders(response, bodyBytes) {
  const headers = {};
  for (const [name, value] of response.headers)
    if (!PROXY_RESPONSE_HEADER_DENYLIST.has(name.toLowerCase()))
      headers[name] = value;
  if (bodyBytes !== undefined) headers["content-length"] = String(bodyBytes);
  return headers;
}
function localVideoTakeId(req) {
  const value = String(req.headers[LOCAL_VIDEO_TAKE_HEADER] || "").trim();
  if (!value) return "";
  if (!/^take_[a-zA-Z0-9-]{8,100}$/.test(value))
    throw Object.assign(new Error("视频版本标识无效"), {
      status: 400,
      code: "invalid_video_take_id",
    });
  return value;
}
function videoTaskCreateProvider(channel, target, method) {
  if (method !== "POST") return "";
  if (
    channel.provider === "volcengine-ark" &&
    target.pathname === "/api/v3/contents/generations/tasks"
  )
    return "volcengine-ark";
  if (
    channel.provider === "apimart" &&
    target.pathname === "/v1/videos/generations"
  )
    return "apimart";
  if (
    channel.provider === "runninghub" &&
    (target.pathname === RUNNINGHUB_CREATE_PATH ||
      isRunningHubGrokCreatePath(target.pathname))
  )
    return "runninghub";
  if (
    channel.provider === "seedance" &&
    target.pathname.endsWith("/contents/generations/tasks")
  )
    return "seedance";
  if (channel.provider === "openai" && /\/v1\/videos$/.test(target.pathname))
    return "openai";
  if (channel.provider === "richbest" && /\/v1\/videos$/.test(target.pathname))
    return "richbest";
  if (channel.provider === API888_PROVIDER && target.pathname === "/v1/videos")
    return API888_PROVIDER;
  return "";
}
function imageTaskCreateProvider(channel, target, method) {
  return method === "POST" &&
    channel.provider === "apimart" &&
    target.pathname === "/v1/images/generations"
    ? "apimart"
    : "";
}
function requestModelMatchesTake(storedModel, requestModel, payload) {
  const stored = String(storedModel || "");
  const requested = String(requestModel || "");
  const canonical = (value) =>
    value === "doubao-seedance-2.5" ? "seedance-2.5" : value;
  const storedLeaf = stored.split("::").pop();
  if (isGrokOfficialModel(stored))
    return grokOfficialModelsMatch(stored, requested, payload);
  return (
    !requested ||
    stored === requested ||
    stored.endsWith(`::${requested}`) ||
    canonical(storedLeaf) === canonical(requested) ||
    apimartGrokVideoModelsMatch(stored, requested)
  );
}
function validProviderTaskId(provider, taskId) {
  const value = String(taskId || "");
  if (provider === "runninghub") return /^\d{10,30}$/.test(value);
  if (provider === "gemini")
    return (
      value.length <= 500 &&
      /^(?:[a-zA-Z0-9_.:-]+\/){1,8}[a-zA-Z0-9_.:-]+$/.test(value) &&
      (value.startsWith("operations/") || value.includes("/operations/"))
    );
  return /^[a-zA-Z0-9_.:-]{3,200}$/.test(value);
}
function runningHubRoute(target, method) {
  if (method !== "POST") return "";
  if (
    target.pathname === RUNNINGHUB_CREATE_PATH ||
    isRunningHubGrokCreatePath(target.pathname)
  )
    return "create";
  if (target.pathname === RUNNINGHUB_QUERY_PATH) return "query";
  if (target.pathname === RUNNINGHUB_UPLOAD_PATH) return "upload";
  return "";
}
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from(
      {
        length: Math.min(limit, items.length),
      },
      async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await worker(items[index], index);
        }
      },
    ),
  );
  return results;
}
function safeReconcileError(value) {
  return String(value || "reconcile_failed")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 100);
}
function safeProviderIdentifier(value, max = 200) {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_.:@/-]+$/.test(text) ? text.slice(0, max) : "";
}
function providerRequestSensitiveStrings(payload) {
  const values = [];
  const visit = (value, key = "", depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (
        (key === "prompt" ||
          key === "text" ||
          key.endsWith("_url") ||
          key === "url") &&
        value.length >= 4
      )
        values.push(value);
      return;
    }
    if (Array.isArray(value))
      return value.slice(0, 100).forEach((item) => visit(item, key, depth + 1));
    if (typeof value === "object")
      for (const [childKey, child] of Object.entries(value))
        visit(child, childKey.toLowerCase(), depth + 1);
  };
  visit(payload);
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}
function safeProviderMessage(value, requestPayload, sensitiveValues = []) {
  let message = String(value ?? "")
    .replace(/data:[^\s,;]+;base64,[a-zA-Z0-9+/=]{16,}/gi, "[base64-redacted]")
    .replace(/https?:\/\/\S+/gi, "[url-redacted]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[authorization-redacted]")
    .replace(
      /\b(?:api[_-]?key|token|secret|signature|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[secret-redacted]")
    .replace(/(?:[a-zA-Z]:[\\/]|\\\\)[^\s,;]+/g, "[path-redacted]")
    .replace(/\/(?:Users|home|tmp|var|etc|mnt)\/[^\s,;]+/g, "[path-redacted]")
    .replace(/\b[a-zA-Z0-9+/]{80,}={0,2}\b/g, "[opaque-data-redacted]")
    .replace(/\bprompt\b[\s\S]*/i, "prompt [request-content-redacted]")
    .replace(/提示词[\s\S]*/, "提示词 [request-content-redacted]");
  for (const sensitive of providerRequestSensitiveStrings(requestPayload))
    message = message.split(sensitive).join("[request-content-redacted]");
  for (const sensitive of sensitiveValues)
    if (typeof sensitive === "string" && sensitive.length >= 4)
      message = message.split(sensitive).join("[secret-redacted]");
  return message
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
function providerMessageCandidate(payload, depth = 0) {
  if (depth > 5 || payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return "";
  for (const key of [
    "message",
    "msg",
    "detail",
    "fail_reason",
    "error_message",
    "errorMessage",
  ]) {
    const message = providerMessageCandidate(payload[key], depth + 1);
    if (message) return message;
  }
  return (
    providerMessageCandidate(payload.error, depth + 1) ||
    providerMessageCandidate(payload.data, depth + 1)
  );
}
function providerCodeCandidate(payload) {
  if (!payload || typeof payload !== "object") return "";
  const error =
    payload.error && typeof payload.error === "object" ? payload.error : {};
  const data =
    payload.data &&
    typeof payload.data === "object" &&
    !Array.isArray(payload.data)
      ? payload.data
      : {};
  const dataError =
    data.error && typeof data.error === "object" ? data.error : {};
  const candidates = [
    error.code,
    error.type,
    payload.error_code,
    payload.errorCode,
    payload.code,
    dataError.code,
    data.error_code,
    data.code,
  ];
  return (
    candidates
      .map((value) => String(value ?? ""))
      .find(
        (value) => value && value !== "0" && value.toLowerCase() !== "success",
      ) || ""
  );
}
function providerRequestIdCandidate(payload, headers) {
  const headerValue = [
    "x-request-id",
    "x-tt-logid",
    "request-id",
    "trace-id",
    "x-trace-id",
  ]
    .map((name) => headers?.get?.(name))
    .find(Boolean);
  const bodyValue =
    payload && typeof payload === "object"
      ? (payload.request_id ??
        payload.requestId ??
        payload.trace_id ??
        payload.traceId)
      : "";
  return safeProviderIdentifier(headerValue || bodyValue, 200);
}
function normalizeProviderFailure(
  input = {},
  requestPayload,
  sensitiveValues = [],
) {
  const httpStatus = Number(input.httpStatus);
  const containsSecret = (value) =>
    sensitiveValues.some(
      (secret) =>
        typeof secret === "string" &&
        secret.length >= 4 &&
        String(value ?? "").includes(secret),
    );
  const normalized = {
    httpStatus:
      Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
        ? httpStatus
        : undefined,
    code: containsSecret(input.code)
      ? undefined
      : safeProviderIdentifier(input.code, 100) || undefined,
    message:
      safeProviderMessage(input.message, requestPayload, sensitiveValues) ||
      undefined,
    requestId: containsSecret(input.requestId)
      ? undefined
      : safeProviderIdentifier(input.requestId, 200) || undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined)
    ? normalized
    : undefined;
}
function providerFailureFromResponse(
  response,
  responseBody,
  requestPayload,
  sensitiveValues = [],
) {
  let payload = {};
  try {
    payload = JSON.parse(responseBody.toString("utf8"));
  } catch {}
  return normalizeProviderFailure(
    {
      httpStatus: response.status,
      code: providerCodeCandidate(payload),
      message: providerMessageCandidate(payload),
      requestId: providerRequestIdCandidate(payload, response.headers),
    },
    requestPayload,
    sensitiveValues,
  );
}
function volcAssetIdsFromGenerationPayload(payload) {
  const ids = new Set();
  for (const item of Array.isArray(payload?.content) ? payload.content : []) {
    const value =
      item?.image_url?.url ?? item?.video_url?.url ?? item?.audio_url?.url;
    const match = /^asset:\/\/(asset-[a-zA-Z0-9-]{8,200})$/.exec(
      String(value || ""),
    );
    if (match) ids.add(match[1]);
  }
  return [...ids];
}
function missingVolcAssetId(failure, requestedIds = []) {
  const code = String(failure?.code || "").toLowerCase();
  const message = String(failure?.message || "");
  if (
    code !== "invalidparameter" ||
    !/asset[^\r\n]{0,240}not found/i.test(message)
  )
    return "";
  const explicit = message.match(/\b(asset-[a-zA-Z0-9-]{8,200})\b/)?.[1] || "";
  if (explicit && (!requestedIds.length || requestedIds.includes(explicit)))
    return explicit;
  return requestedIds.length === 1 ? requestedIds[0] : "";
}
function setVolcAssetGenerationVisibility(
  db,
  assetIds,
  channelId,
  generationStatus,
  input = {},
) {
  if (
    !VOLC_ASSET_GENERATION_STATUSES.has(generationStatus) ||
    generationStatus === "not_required"
  )
    return [];
  const safeChannelId =
    safeProviderIdentifier(channelId, 100) || "volcengine-ark-gx";
  const now = input.now || isoNow();
  const updated = [];
  for (const assetId of new Set(assetIds)) {
    if (!/^asset-[a-zA-Z0-9-]{8,200}$/.test(assetId)) continue;
    const binding = db
      .prepare(
        "SELECT local_ref AS localRef FROM asset_compliance_binding WHERE asset_id=? AND classification='real_person' AND status='active'",
      )
      .get(assetId);
    if (!binding) continue;
    const inaccessible = generationStatus === "inaccessible";
    const errorCode = inaccessible ? "generation_asset_not_found" : null;
    const errorMessage = inaccessible
      ? "火山审核已通过，但当前 Seedance API Key 所属账号或项目无法访问此 Asset ID；请先对齐生成 API Key 与资产 AK/SK 的账号和项目。"
      : null;
    db.prepare(
      "UPDATE asset_compliance_binding SET generation_status=?,generation_channel_id=?,generation_error_code=?,generation_error_message=?,generation_provider_http_status=?,generation_provider_error_code=?,generation_provider_error_message=?,generation_provider_request_id=?,generation_checked_at=?,updated_at=? WHERE local_ref=?",
    ).run(
      generationStatus,
      safeChannelId,
      errorCode,
      errorMessage,
      inaccessible ? (input.failure?.httpStatus ?? null) : null,
      inaccessible
        ? safeProviderIdentifier(input.failure?.code, 100) || null
        : null,
      inaccessible
        ? safeProviderMessage(input.failure?.message || "") || null
        : null,
      inaccessible
        ? safeProviderIdentifier(input.failure?.requestId, 200) || null
        : null,
      now,
      now,
      binding.localRef,
    );
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.generation_visibility',?,?,?)",
    ).run(
      binding.localRef,
      JSON.stringify({
        assetId,
        channelId: safeChannelId,
        generationStatus,
        providerCode:
          safeProviderIdentifier(input.failure?.code, 100) || undefined,
        requestId:
          safeProviderIdentifier(input.failure?.requestId, 200) || undefined,
      }),
      now,
    );
    updated.push(readVolcAssetBinding(db, binding.localRef));
  }
  return updated;
}
function markVolcAssetGenerationVerified(db, payload, channelId) {
  return setVolcAssetGenerationVisibility(
    db,
    volcAssetIdsFromGenerationPayload(payload),
    channelId,
    "verified",
  );
}
function markVolcAssetGenerationInaccessible(db, payload, channelId, failure) {
  const requestedIds = volcAssetIdsFromGenerationPayload(payload);
  const assetId = missingVolcAssetId(failure, requestedIds);
  return assetId
    ? setVolcAssetGenerationVisibility(
        db,
        [assetId],
        channelId,
        "inaccessible",
        {
          failure,
        },
      )
    : [];
}
function assertVolcAssetGenerationPayloadAllowed(db, payload, channelId) {
  const safeChannelId =
    safeProviderIdentifier(channelId, 100) || "volcengine-ark-gx";
  for (const assetId of volcAssetIdsFromGenerationPayload(payload)) {
    const binding = db
      .prepare(
        "SELECT generation_status AS generationStatus,generation_channel_id AS generationChannelId,generation_error_message AS generationErrorMessage FROM asset_compliance_binding WHERE asset_id=? AND classification='real_person'",
      )
      .get(assetId);
    if (
      binding?.generationStatus === "inaccessible" &&
      binding.generationChannelId === safeChannelId
    ) {
      throw Object.assign(
        new Error(
          binding.generationErrorMessage ||
            "火山审核已通过，但当前生成渠道无法访问此 Asset ID",
        ),
        {
          status: 409,
          code: "volc_asset_generation_inaccessible",
        },
      );
    }
  }
}
function backfillVolcAssetGenerationVisibility(db) {
  const rows = db
    .prepare(
      `SELECT t.provider_http_status AS httpStatus,t.provider_error_code AS code,t.provider_error_message AS message,t.provider_request_id AS requestId,a.channel_id AS channelId
        FROM video_generation_take t LEFT JOIN provider_submission_attempt a ON a.take_id=t.take_id
        WHERE t.provider='volcengine-ark' AND t.status='failed' AND t.provider_error_message IS NOT NULL`,
    )
    .all();
  for (const row of rows) {
    const assetId = missingVolcAssetId(row);
    if (assetId)
      setVolcAssetGenerationVisibility(
        db,
        [assetId],
        row.channelId,
        "inaccessible",
        {
          failure: row,
        },
      );
  }
}
function resetVolcAssetGenerationVisibility(db, localRef) {
  const binding = readVolcAssetBinding(db, localRef);
  if (
    !binding ||
    binding.classification !== "real_person" ||
    binding.status !== "active" ||
    !binding.assetId
  )
    throw Object.assign(
      new Error("只有火山审核 Active 的仿真人资产可以重新验证生成可见性"),
      {
        status: 409,
        code: "volc_asset_generation_retry_unavailable",
      },
    );
  const now = isoNow();
  db.prepare(
    "UPDATE asset_compliance_binding SET generation_status='unverified',generation_channel_id=NULL,generation_error_code=NULL,generation_error_message=NULL,generation_provider_http_status=NULL,generation_provider_error_code=NULL,generation_provider_error_message=NULL,generation_provider_request_id=NULL,generation_checked_at=NULL,updated_at=? WHERE local_ref=?",
  ).run(now, localRef);
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('volc_asset.generation_visibility_retry',?,'{}',?)",
  ).run(localRef, now);
  return readVolcAssetBinding(db, localRef);
}
function providerFailureFromTask(payload, requestPayload) {
  const task = providerTaskPayload(payload) || {};
  return normalizeProviderFailure(
    {
      code: providerCodeCandidate(task),
      message: providerMessageCandidate(task),
      requestId: providerRequestIdCandidate(task),
    },
    requestPayload,
  );
}
function hasSeedanceEditIntent(texts) {
  const text = texts.join("\n");
  return (
    /编辑视频[\s\S]{0,120}以\s*@视频\d+\s*为待编辑原片/.test(text) ||
    /edit(?:ing)?\s+video[\s\S]{0,120}@video\d+[\s\S]{0,120}(?:source|primary)/i.test(
      text,
    )
  );
}
function validateRunningHubSeedancePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw Object.assign(new Error("RunningHub 视频任务请求必须是 JSON 对象"), {
      status: 400,
      code: "invalid_video_task_json",
    });
  const allowedFields = new Set([
    "prompt",
    "resolution",
    "ratio",
    "duration",
    "generateAudio",
    "watermark",
    "outputFormat",
    "imageUrls",
    "videoUrls",
    "audioUrls",
    "omniReferenceTaskType",
  ]);
  if (Object.keys(payload).some((key) => !allowedFields.has(key)))
    throw Object.assign(new Error("RunningHub 视频任务包含未确认的请求字段"), {
      status: 400,
      code: "runninghub_video_field_not_allowed",
    });
  if (typeof payload.prompt !== "string" || !payload.prompt.trim())
    throw Object.assign(new Error("RunningHub 视频提示词不能为空"), {
      status: 400,
      code: "runninghub_video_prompt_invalid",
    });
  if (
    !RUNNINGHUB_RESOLUTIONS.has(String(payload.resolution || "").toLowerCase())
  )
    throw Object.assign(new Error("RunningHub 视频分辨率不受当前模型支持"), {
      status: 400,
      code: "runninghub_video_resolution_invalid",
    });
  if (!RUNNINGHUB_RATIOS.has(String(payload.ratio || "").toLowerCase()))
    throw Object.assign(new Error("RunningHub 视频比例不受当前模型支持"), {
      status: 400,
      code: "runninghub_video_ratio_invalid",
    });
  const taskType = String(payload.omniReferenceTaskType || "");
  if (taskType && !["reference", "edit", "extend"].includes(taskType))
    throw Object.assign(new Error("RunningHub 视频任务类型不受当前模型支持"), {
      status: 400,
      code: "runninghub_video_task_type_invalid",
    });
  const smartEdit = taskType === "edit" && payload.duration === -1;
  if (
    !Number.isSafeInteger(payload.duration) ||
    (!smartEdit && (payload.duration < 4 || payload.duration > 30))
  )
    throw Object.assign(
      new Error("RunningHub 视频时长必须是 4-30 秒整数，编辑模式使用 -1"),
      {
        status: 400,
        code: "runninghub_video_duration_invalid",
      },
    );
  if (
    taskType === "edit" &&
    (payload.ratio !== "adaptive" || payload.duration !== -1)
  )
    throw Object.assign(
      new Error("RunningHub 视频编辑必须使用 adaptive 比例和 -1 智能时长"),
      {
        status: 400,
        code: "runninghub_video_edit_contract_invalid",
      },
    );
  if (
    payload.generateAudio !== undefined &&
    typeof payload.generateAudio !== "boolean"
  )
    throw Object.assign(new Error("RunningHub 视频声音开关类型无效"), {
      status: 400,
      code: "runninghub_video_audio_invalid",
    });
  if (payload.watermark !== undefined && typeof payload.watermark !== "boolean")
    throw Object.assign(new Error("RunningHub 视频水印开关类型无效"), {
      status: 400,
      code: "runninghub_video_watermark_invalid",
    });
  if (payload.outputFormat !== "mp4")
    throw Object.assign(new Error("RunningHub 当前只允许 MP4 输出"), {
      status: 400,
      code: "runninghub_video_output_format_invalid",
    });
  for (const [field, max] of [
    ["imageUrls", 30],
    ["videoUrls", 10],
    ["audioUrls", 10],
  ]) {
    const values = payload[field];
    if (
      !Array.isArray(values) ||
      values.length > max ||
      values.some(
        (value) => typeof value !== "string" || !/^https?:\/\//i.test(value),
      )
    )
      throw Object.assign(new Error("RunningHub 参考素材格式或数量无效"), {
        status: 400,
        code: "runninghub_video_reference_invalid",
      });
  }
  const referenceCount =
    payload.imageUrls.length +
    payload.videoUrls.length +
    payload.audioUrls.length;
  if (!taskType && referenceCount)
    throw Object.assign(new Error("RunningHub 文生视频不能同时提交参考素材"), {
      status: 400,
      code: "runninghub_video_reference_mode_invalid",
    });
  if (taskType && !referenceCount)
    throw Object.assign(new Error("RunningHub 参考模式需要参考素材"), {
      status: 400,
      code: "runninghub_video_reference_mode_invalid",
    });
  if (
    (taskType === "edit" || taskType === "extend") &&
    !payload.videoUrls.length
  )
    throw Object.assign(new Error("RunningHub 编辑或延长模式需要参考视频"), {
      status: 400,
      code: "runninghub_video_reference_mode_invalid",
    });
  return payload;
}
function validateRunningHubQueryPayload(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !validProviderTaskId("runninghub", payload.taskId)
  )
    throw Object.assign(new Error("RunningHub 查询任务 ID 无效"), {
      status: 400,
      code: "runninghub_task_id_invalid",
    });
  return payload;
}
function validateVolcengineVideoPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw Object.assign(new Error("火山视频任务请求必须是 JSON 对象"), {
      status: 400,
      code: "invalid_video_task_json",
    });
  const allowedFields = new Set([
    "model",
    "content",
    "ratio",
    "resolution",
    "duration",
    "generate_audio",
    "watermark",
    "output_format",
    "omni_reference_task_type",
    "draft",
    "seed",
  ]);
  if (Object.keys(payload).some((key) => !allowedFields.has(key)))
    throw Object.assign(new Error("火山视频任务包含未确认的请求字段"), {
      status: 400,
      code: "volcengine_video_field_not_allowed",
    });
  const model = String(payload.model || "");
  const capability = VOLCENGINE_VIDEO_CAPABILITIES.get(model);
  if (!capability)
    throw Object.assign(new Error("火山视频任务模型不在已确认清单中"), {
      status: 403,
      code: "volcengine_video_model_not_allowed",
    });
  const taskType = String(payload.omni_reference_task_type || "");
  const duration = Number(payload.duration);
  const smartEditDuration =
    capability.family === "2.5" && taskType === "edit" && duration === -1;
  if (
    payload.duration !== undefined &&
    (!Number.isSafeInteger(duration) ||
      (!smartEditDuration &&
        (duration < capability.duration[0] ||
          duration > capability.duration[1])))
  )
    throw Object.assign(new Error("火山视频时长不受当前模型支持"), {
      status: 400,
      code: "volcengine_video_duration_invalid",
    });
  const resolution = String(payload.resolution || "").toLowerCase();
  if (resolution && !capability.resolutions.has(resolution))
    throw Object.assign(new Error("火山视频分辨率不受当前模型支持"), {
      status: 400,
      code: "volcengine_video_resolution_invalid",
    });
  const ratio = String(payload.ratio || "");
  if (ratio && !VOLCENGINE_VIDEO_RATIOS.has(ratio))
    throw Object.assign(new Error("火山视频比例不受当前模型支持"), {
      status: 400,
      code: "volcengine_video_ratio_invalid",
    });
  if (
    payload.generate_audio !== undefined &&
    typeof payload.generate_audio !== "boolean"
  )
    throw Object.assign(new Error("火山视频声音开关类型无效"), {
      status: 400,
      code: "volcengine_video_audio_invalid",
    });
  if (payload.watermark !== undefined && typeof payload.watermark !== "boolean")
    throw Object.assign(new Error("火山视频水印开关类型无效"), {
      status: 400,
      code: "volcengine_video_watermark_invalid",
    });
  if (
    payload.output_format !== undefined &&
    (capability.family !== "2.5" ||
      !["mp4", "mov"].includes(payload.output_format))
  )
    throw Object.assign(new Error("火山视频输出格式不受当前模型支持"), {
      status: 400,
      code: "volcengine_video_output_format_invalid",
    });
  if (
    payload.draft !== undefined &&
    (capability.family !== "1.5" || typeof payload.draft !== "boolean")
  )
    throw Object.assign(new Error("火山视频样片模式不受当前模型支持"), {
      status: 400,
      code: "volcengine_video_draft_invalid",
    });
  if (
    taskType &&
    (capability.family !== "2.5" ||
      !["reference", "edit", "extend"].includes(taskType))
  )
    throw Object.assign(new Error("火山视频任务类型不受当前模型支持"), {
      status: 400,
      code: "volcengine_video_task_type_invalid",
    });
  const content = payload.content;
  if (!Array.isArray(content) || !content.length || content.length > 64)
    throw Object.assign(new Error("火山视频内容列表无效"), {
      status: 400,
      code: "volcengine_video_content_invalid",
    });
  const counts = {
    text: 0,
    image_url: 0,
    video_url: 0,
    audio_url: 0,
  };
  const imageRoles = [];
  const videoRoles = [];
  const texts = [];
  for (const item of content) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !Object.hasOwn(counts, item.type)
    )
      throw Object.assign(new Error("火山视频素材类型无效"), {
        status: 400,
        code: "volcengine_video_content_invalid",
      });
    counts[item.type] += 1;
    if (item.type === "text") {
      if (typeof item.text !== "string" || !item.text.trim())
        throw Object.assign(new Error("火山视频文本内容无效"), {
          status: 400,
          code: "volcengine_video_content_invalid",
        });
      texts.push(item.text);
      continue;
    }
    const value = item[item.type]?.url;
    if (item.type === "video_url" && /^data:video\//i.test(String(value || "")))
      throw Object.assign(
        new Error(
          "火山视频参考禁止 Base64，必须使用公网 URL、Asset ID 或叙光本机对象",
        ),
        {
          status: 400,
          code: "volcengine_video_base64_forbidden",
        },
      );
    const localVideo =
      item.type === "video_url" &&
      options.allowLocalVideoObjects === true &&
      LOCAL_SEEDANCE_VIDEO_PATTERN.test(String(value || ""));
    if (
      typeof value !== "string" ||
      (!localVideo &&
        !/^(?:https?:\/\/|asset:\/\/|data:(?:image|audio)\/)/i.test(value))
    )
      throw Object.assign(new Error("火山视频参考素材格式无效"), {
        status: 400,
        code: "volcengine_video_reference_invalid",
      });
    if (item.type === "image_url")
      imageRoles.push(String(item.role || "reference_image"));
    if (item.type === "video_url") videoRoles.push(String(item.role || ""));
  }
  if (
    counts.text > 1 ||
    counts.image_url > capability.images ||
    counts.video_url > capability.videos ||
    counts.audio_url > capability.audios
  )
    throw Object.assign(new Error("火山视频参考素材数量超过当前模型限制"), {
      status: 400,
      code: "volcengine_video_reference_count_invalid",
    });
  if (
    counts.audio_url &&
    capability.audioRequiresVisual &&
    !counts.image_url &&
    !counts.video_url
  )
    throw Object.assign(new Error("当前火山模型的音频参考必须搭配图片或视频"), {
      status: 400,
      code: "volcengine_video_audio_requires_visual",
    });
  const firstFrames = imageRoles.filter(
    (role) => role === "first_frame",
  ).length;
  const lastFrames = imageRoles.filter((role) => role === "last_frame").length;
  if (
    imageRoles.some(
      (role) =>
        !["reference_image", "first_frame", "last_frame"].includes(role),
    ) ||
    firstFrames > 1 ||
    lastFrames > 1 ||
    (lastFrames &&
      (firstFrames !== 1 ||
        counts.image_url !== 2 ||
        counts.video_url ||
        counts.audio_url)) ||
    (firstFrames &&
      !lastFrames &&
      (counts.image_url !== 1 || counts.video_url || counts.audio_url))
  )
    throw Object.assign(new Error("火山视频首帧或首尾帧素材组合无效"), {
      status: 400,
      code: "volcengine_video_reference_mode_invalid",
    });
  if (videoRoles.some((role) => role !== "reference_video"))
    throw Object.assign(new Error("火山视频参考角色必须是 reference_video"), {
      status: 400,
      code: "volcengine_video_role_invalid",
    });
  if ((taskType === "edit" || taskType === "extend") && !counts.video_url)
    throw Object.assign(new Error("火山视频编辑或延长模式需要参考视频"), {
      status: 400,
      code: "volcengine_video_reference_mode_invalid",
    });
  if (
    taskType === "reference" &&
    !counts.image_url &&
    !counts.video_url &&
    !counts.audio_url
  )
    throw Object.assign(new Error("火山全模态参考模式需要参考素材"), {
      status: 400,
      code: "volcengine_video_reference_mode_invalid",
    });
  if (
    taskType === "edit" &&
    (payload.ratio !== "adaptive" || payload.duration !== -1)
  )
    throw Object.assign(
      new Error("Seedance 2.5 视频编辑必须使用 adaptive 比例和 -1 智能时长"),
      {
        status: 400,
        code: "volcengine_video_edit_contract_invalid",
      },
    );
  if (taskType === "edit" && !hasSeedanceEditIntent(texts))
    throw Object.assign(
      new Error("Seedance 2.5 视频编辑必须明确哪一份 @视频N 是待编辑原片"),
      {
        status: 400,
        code: "volcengine_video_edit_intent_required",
      },
    );
}
function seedanceRelayPrefix(takeId) {
  return `seedance:${takeId}:`;
}
function stopSeedanceTakeRelays(relayManager, takeId) {
  if (!takeId || typeof relayManager?.stopPrefix !== "function") return 0;
  return relayManager.stopPrefix(seedanceRelayPrefix(takeId));
}
async function prepare888ApiReferences(
  dataRoot,
  takeId,
  payload,
  relayManager,
) {
  const entries = [];
  for (const [field, kind, maxBytes] of [
    ["images", "image", 30 * 1024 * 1024],
    ["videos", "video", 200 * 1024 * 1024],
    ["audios", "audio", 15 * 1024 * 1024],
  ]) {
    for (const [index, value] of (payload[field] || []).entries()) {
      const reference = api888LocalObject(value);
      if (!reference) continue;
      const filePath = objectPath(dataRoot, reference.hash);
      if (!existsSync(filePath) || !statSync(filePath).isFile())
        throw Object.assign(new Error("888API 参考素材对象不存在"), {
          status: 404,
          code: "api888_reference_object_missing",
        });
      const detected = detectVolcLocalMedia(filePath);
      const compatibleVideo =
        kind === "video" &&
        ISO_BMFF_VIDEO_MIMES.has(detected.mimeType) &&
        ISO_BMFF_VIDEO_MIMES.has(reference.mimeType);
      if (
        detected.mediaKind !== kind ||
        (detected.mimeType !== reference.mimeType && !compatibleVideo) ||
        statSync(filePath).size > maxBytes
      )
        throw Object.assign(new Error("888API 参考素材类型或大小不符合要求"), {
          status: 415,
          code: "api888_reference_object_invalid",
        });
      entries.push({
        field,
        index,
        filePath,
        mimeType: detected.mimeType,
        fileName: `${kind}-${index + 1}.${detected.extension}`,
      });
    }
  }
  if (!entries.length) return payload;
  if (!takeId || typeof relayManager?.startGroup !== "function")
    throw Object.assign(new Error("888API 参考素材中继不可用"), {
      status: 503,
      code: "api888_reference_relay_unavailable",
    });
  const relay = await relayManager.startGroup({
    key: `${seedanceRelayPrefix(takeId)}888api-media`,
    files: entries.map(({ filePath, mimeType, fileName }) => ({
      filePath,
      mimeType,
      fileName,
    })),
  });
  const next = {
    ...payload,
    images: [...(payload.images || [])],
    videos: [...(payload.videos || [])],
    audios: [...(payload.audios || [])],
  };
  entries.forEach((entry, position) => {
    next[entry.field][entry.index] = relay.publicUrls[position];
  });
  validate888ApiRequest(next, "video.generate", {
    allowRelayedUrls: true,
  });
  return next;
}
function localSeedanceVideoReference(value) {
  const match = LOCAL_SEEDANCE_VIDEO_PATTERN.exec(String(value || ""));
  if (!match) return null;
  let mimeType;
  try {
    mimeType = decodeURIComponent(match[2]).toLowerCase();
  } catch {
    throw Object.assign(new Error("叙光本机视频 MIME 无效"), {
      status: 400,
      code: "local_video_mime_invalid",
    });
  }
  if (!["video/mp4", "video/quicktime"].includes(mimeType))
    throw Object.assign(new Error("Seedance 本机视频只支持 MP4 或 MOV"), {
      status: 400,
      code: "local_video_mime_invalid",
    });
  return {
    hash: match[1].toLowerCase(),
    mimeType,
  };
}
function assertSeedanceLocalVideoProbe(probe, bytes, input) {
  const { capability, taskType, label } = input;
  const width = Number(probe?.width || 0);
  const height = Number(probe?.height || 0);
  const duration = Number(probe?.durationSeconds || 0);
  const fps = Number(probe?.fps || 0);
  const pixels = width * height;
  const ratio = height ? width / height : 0;
  const maxDuration = capability.family === "2.5" ? 30 : 15;
  const minDuration = taskType === "edit" ? 4 : 2;
  if (!probe?.formatNames?.some((name) => name === "mov" || name === "mp4"))
    throw Object.assign(new Error(`${label}不是 MP4/MOV 视频`), {
      status: 415,
      code: "seedance_video_format_invalid",
    });
  if (!["h264", "hevc", "h265"].includes(String(probe.codec || "")))
    throw Object.assign(new Error(`${label}必须使用 H.264 或 H.265 编码`), {
      status: 415,
      code: "seedance_video_codec_invalid",
    });
  if (
    !Number.isFinite(duration) ||
    duration < minDuration ||
    duration > maxDuration
  )
    throw Object.assign(
      new Error(`${label}时长必须在 ${minDuration}-${maxDuration} 秒内`),
      {
        status: 422,
        code: "seedance_video_duration_invalid",
      },
    );
  if (!Number.isFinite(fps) || fps < 24 || fps > 60)
    throw Object.assign(new Error(`${label}帧率必须在 24-60 FPS 内`), {
      status: 422,
      code: "seedance_video_fps_invalid",
    });
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 300 ||
    width > 6000 ||
    height < 300 ||
    height > 6000
  )
    throw Object.assign(new Error(`${label}边长必须在 300-6000 像素内`), {
      status: 422,
      code: "seedance_video_dimensions_invalid",
    });
  if (ratio < 0.4 || ratio > 2.5)
    throw Object.assign(new Error(`${label}宽高比必须在 0.4-2.5 内`), {
      status: 422,
      code: "seedance_video_ratio_invalid",
    });
  if (pixels < 409_600 || pixels > 8_295_044)
    throw Object.assign(new Error(`${label}总像素数不符合 Seedance 要求`), {
      status: 422,
      code: "seedance_video_pixels_invalid",
    });
  if (bytes > MAX_SEEDANCE_VIDEO_INPUT_BYTES)
    throw Object.assign(new Error(`${label}超过 200 MB`), {
      status: 413,
      code: "seedance_video_size_invalid",
    });
  return duration;
}
async function prepareSeedanceLocalVideoInputs(
  db,
  dataRoot,
  takeId,
  payload,
  relayManager,
  videoProbeRunner,
) {
  let videoIndex = 0;
  const localItems = payload.content.flatMap((item) => {
    if (item?.type !== "video_url") return [];
    const index = videoIndex++;
    const reference = localSeedanceVideoReference(item.video_url?.url);
    return reference
      ? [
          {
            item,
            index,
            reference,
          },
        ]
      : [];
  });
  const totalVideoCount = videoIndex;
  if (!localItems.length)
    return {
      payload,
      authoritativeInputVideoDurationMs: null,
    };
  if (!takeId)
    throw Object.assign(
      new Error("本机视频必须先创建 Take，平台才能安全中转"),
      {
        status: 409,
        code: "local_video_take_required",
      },
    );
  const take = db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId);
  if (!take || take.status !== "submitting")
    throw Object.assign(new Error("本机视频对应的 Take 尚未进入提交状态"), {
      status: 409,
      code: "local_video_take_not_ready",
    });
  const capability = VOLCENGINE_VIDEO_CAPABILITIES.get(
    String(payload.model || ""),
  );
  let totalDuration = 0;
  const replacements = new Map();
  for (const { item, index, reference } of localItems) {
    const filePath = objectPath(dataRoot, reference.hash);
    if (!existsSync(filePath) || !statSync(filePath).isFile())
      throw Object.assign(new Error(`@视频${index + 1}的本机对象不存在`), {
        status: 404,
        code: "local_video_object_missing",
      });
    const detected = detectVolcLocalMedia(filePath);
    const compatibleIsoBmff =
      ISO_BMFF_VIDEO_MIMES.has(detected.mimeType) &&
      ISO_BMFF_VIDEO_MIMES.has(reference.mimeType);
    if (
      detected.mediaKind !== "video" ||
      (detected.mimeType !== reference.mimeType && !compatibleIsoBmff)
    )
      throw Object.assign(
        new Error(`@视频${index + 1}的格式与本机对象不一致`),
        {
          status: 415,
          code: "local_video_content_mismatch",
        },
      );
    const bytes = statSync(filePath).size;
    const probe = await videoProbeRunner(filePath);
    totalDuration += assertSeedanceLocalVideoProbe(probe, bytes, {
      capability,
      taskType: String(payload.omni_reference_task_type || ""),
      label: `@视频${index + 1}`,
    });
    const key = `${seedanceRelayPrefix(takeId)}${reference.hash}`;
    const relayExtension =
      reference.mimeType === "video/quicktime" ? "mov" : "mp4";
    const relay = await relayManager.start({
      key,
      filePath,
      mimeType: reference.mimeType,
      fileName: `video-${index + 1}.${relayExtension}`,
    });
    replacements.set(item, relay.publicUrl);
  }
  const totalLimit = capability.family === "2.5" ? 30 : 15;
  if (totalDuration > totalLimit + 0.01)
    throw Object.assign(
      new Error(`本机参考视频总时长不能超过 ${totalLimit} 秒`),
      {
        status: 422,
        code: "seedance_video_total_duration_invalid",
      },
    );
  return {
    payload: {
      ...payload,
      content: payload.content.map((item) =>
        replacements.has(item)
          ? {
              ...item,
              video_url: {
                ...item.video_url,
                url: replacements.get(item),
              },
            }
          : item,
      ),
    },
    authoritativeInputVideoDurationMs:
      localItems.length === totalVideoCount
        ? Math.round(totalDuration * 1000)
        : null,
  };
}
function validateApimartSeedance25Payload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw Object.assign(new Error("APIMart 视频任务请求必须是 JSON 对象"), {
      status: 400,
      code: "invalid_video_task_json",
    });
  const allowed = new Set([
    "model",
    "prompt",
    "resolution",
    "size",
    "duration",
    "generate_audio",
    "watermark",
    "output_format",
    "omni_reference_task_type",
    "image_urls",
    "video_urls",
    "audio_urls",
    "image_with_roles",
    "seed",
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key)))
    throw Object.assign(
      new Error("APIMart Seedance 2.5 包含未确认的请求字段"),
      {
        status: 400,
        code: "apimart_video_field_not_allowed",
      },
    );
  if (
    !["seedance-2.5", "doubao-seedance-2.5"].includes(
      String(payload.model || "").toLowerCase(),
    )
  )
    return;
  if (typeof payload.prompt !== "string" || !payload.prompt.trim())
    throw Object.assign(new Error("APIMart Seedance 2.5 提示词不能为空"), {
      status: 400,
      code: "apimart_video_prompt_invalid",
    });
  if (
    !["480p", "720p", "1080p"].includes(
      String(payload.resolution || "").toLowerCase(),
    )
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 分辨率无效"), {
      status: 400,
      code: "apimart_video_resolution_invalid",
    });
  const taskType = String(payload.omni_reference_task_type || "");
  if (taskType && !["auto", "reference", "edit", "extend"].includes(taskType))
    throw Object.assign(new Error("APIMart Seedance 2.5 任务类型无效"), {
      status: 400,
      code: "apimart_video_task_type_invalid",
    });
  const duration = Number(payload.duration);
  const smartEdit = taskType === "edit" && duration === -1;
  if (
    !Number.isSafeInteger(duration) ||
    (!smartEdit && (duration < 4 || duration > 30))
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 时长无效"), {
      status: 400,
      code: "apimart_video_duration_invalid",
    });
  if (
    !["16:9", "9:16", "1:1", "21:9", "3:4", "4:3", "adaptive"].includes(
      String(payload.size || ""),
    )
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 比例无效"), {
      status: 400,
      code: "apimart_video_ratio_invalid",
    });
  if (
    (taskType === "edit" ||
      taskType === "extend" ||
      Array.isArray(payload.image_with_roles)) &&
    payload.size !== "adaptive"
  )
    throw Object.assign(
      new Error("当前 APIMart Seedance 2.5 模式必须使用 adaptive 比例"),
      {
        status: 400,
        code: "apimart_video_adaptive_required",
      },
    );
  if (taskType === "edit" && payload.duration !== -1)
    throw Object.assign(
      new Error("APIMart Seedance 2.5 视频编辑必须使用 -1 智能时长"),
      {
        status: 400,
        code: "apimart_video_edit_duration_invalid",
      },
    );
  if (!["mp4", "mov"].includes(payload.output_format))
    throw Object.assign(new Error("APIMart Seedance 2.5 输出格式无效"), {
      status: 400,
      code: "apimart_video_output_format_invalid",
    });
  if (
    payload.generate_audio !== undefined &&
    typeof payload.generate_audio !== "boolean"
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 声音开关无效"), {
      status: 400,
      code: "apimart_video_audio_invalid",
    });
  if (payload.watermark !== undefined && typeof payload.watermark !== "boolean")
    throw Object.assign(new Error("APIMart Seedance 2.5 水印开关无效"), {
      status: 400,
      code: "apimart_video_watermark_invalid",
    });
  const fields = [
    ["image_urls", 30],
    ["video_urls", 10],
    ["audio_urls", 10],
  ];
  for (const [field, limit] of fields) {
    const values = payload[field] ?? [];
    if (!Array.isArray(values) || values.length > limit)
      throw Object.assign(new Error(`APIMart Seedance 2.5 ${field} 数量无效`), {
        status: 400,
        code: "apimart_video_reference_count_invalid",
      });
    for (const value of values) {
      const local =
        options.allowLocalMediaObjects &&
        LOCAL_SEEDANCE_MEDIA_PATTERN.test(String(value || ""));
      if (
        typeof value !== "string" ||
        (!local && !/^(?:https:\/\/|asset:\/\/)/i.test(value))
      )
        throw Object.assign(
          new Error(`APIMart Seedance 2.5 ${field} 素材地址无效`),
          {
            status: 400,
            code: "apimart_video_reference_invalid",
          },
        );
    }
  }
  const roles = payload.image_with_roles ?? [];
  if (
    !Array.isArray(roles) ||
    roles.length > 2 ||
    roles.some(
      (item) =>
        !item ||
        typeof item.url !== "string" ||
        !["first_frame", "last_frame"].includes(item.role) ||
        !/^(?:https:\/\/|asset:\/\/)/i.test(item.url),
    )
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 首尾帧素材无效"), {
      status: 400,
      code: "apimart_video_frame_reference_invalid",
    });
  if (
    roles.length &&
    (roles[0]?.role !== "first_frame" ||
      (roles.length === 2 && roles[1]?.role !== "last_frame"))
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 首尾帧角色顺序无效"), {
      status: 400,
      code: "apimart_video_frame_reference_invalid",
    });
  if (
    (taskType === "edit" || taskType === "extend") &&
    !payload.video_urls?.length
  )
    throw Object.assign(
      new Error("APIMart Seedance 2.5 编辑或延长需要参考视频"),
      {
        status: 400,
        code: "apimart_video_reference_required",
      },
    );
  if (
    taskType === "reference" &&
    !payload.image_urls?.length &&
    !payload.video_urls?.length &&
    !payload.audio_urls?.length
  )
    throw Object.assign(new Error("APIMart Seedance 2.5 全模态参考需要素材"), {
      status: 400,
      code: "apimart_video_reference_required",
    });
}
function localSeedanceMediaReference(value, kind) {
  const match = LOCAL_SEEDANCE_MEDIA_PATTERN.exec(String(value || ""));
  if (!match) return null;
  let mimeType;
  try {
    mimeType = decodeURIComponent(match[2]).toLowerCase();
  } catch {
    throw Object.assign(
      new Error(`叙光本机${kind === "video" ? "视频" : "音频"} MIME 无效`),
      {
        status: 400,
        code: `local_${kind}_mime_invalid`,
      },
    );
  }
  if (kind === "audio" && mimeType === "audio/mp3") mimeType = "audio/mpeg";
  const allowed =
    kind === "video"
      ? ["video/mp4", "video/quicktime"]
      : ["audio/wav", "audio/x-wav", "audio/mpeg"];
  if (!allowed.includes(mimeType))
    throw Object.assign(
      new Error(
        `APIMart 本机参考${kind === "video" ? "视频只支持 MP4/MOV" : "音频只支持 WAV/MP3"}`,
      ),
      {
        status: 400,
        code: `local_${kind}_mime_invalid`,
      },
    );
  return {
    hash: match[1].toLowerCase(),
    mimeType,
  };
}
async function prepareApimartSeedance25LocalInputs(
  db,
  dataRoot,
  takeId,
  payload,
  relayManager,
  videoProbeRunner,
  audioProbeRunner,
) {
  if (
    !["seedance-2.5", "doubao-seedance-2.5"].includes(
      String(payload.model || "").toLowerCase(),
    )
  )
    return {
      payload,
      authoritativeInputVideoDurationMs: null,
    };
  const entries = [];
  for (const [kind, field] of [
    ["video", "video_urls"],
    ["audio", "audio_urls"],
  ]) {
    for (const [index, value] of (payload[field] || []).entries()) {
      const reference = localSeedanceMediaReference(value, kind);
      if (reference)
        entries.push({
          kind,
          field,
          index,
          reference,
        });
    }
  }
  if (!entries.length)
    return {
      payload: {
        ...payload,
        model: "seedance-2.5",
      },
      authoritativeInputVideoDurationMs: null,
    };
  if (!takeId)
    throw Object.assign(
      new Error("本机参考素材必须先创建 Take，平台才能安全中转"),
      {
        status: 409,
        code: "local_media_take_required",
      },
    );
  const take = db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId);
  if (!take || take.status !== "submitting")
    throw Object.assign(new Error("本机参考素材对应的 Take 尚未进入提交状态"), {
      status: 409,
      code: "local_media_take_not_ready",
    });
  let videoTotal = 0;
  let audioTotal = 0;
  const files = [];
  for (const entry of entries) {
    const filePath = objectPath(dataRoot, entry.reference.hash);
    const label = `@${entry.kind === "video" ? "视频" : "音频"}${entry.index + 1}`;
    if (!existsSync(filePath) || !statSync(filePath).isFile())
      throw Object.assign(new Error(`${label}的本机对象不存在`), {
        status: 404,
        code: `local_${entry.kind}_object_missing`,
      });
    const detected = detectVolcLocalMedia(filePath);
    const declaredMime =
      entry.reference.mimeType === "audio/x-wav"
        ? "audio/wav"
        : entry.reference.mimeType;
    const compatibleVideo =
      entry.kind === "video" &&
      ISO_BMFF_VIDEO_MIMES.has(detected.mimeType) &&
      ISO_BMFF_VIDEO_MIMES.has(declaredMime);
    if (
      detected.mediaKind !== entry.kind ||
      (detected.mimeType !== declaredMime && !compatibleVideo)
    )
      throw Object.assign(new Error(`${label}的格式与本机对象不一致`), {
        status: 415,
        code: `local_${entry.kind}_content_mismatch`,
      });
    const bytes = statSync(filePath).size;
    if (entry.kind === "video") {
      const probe = await videoProbeRunner(filePath);
      videoTotal += assertSeedanceLocalVideoProbe(probe, bytes, {
        capability: {
          family: "2.5",
        },
        taskType: String(payload.omni_reference_task_type || ""),
        label,
      });
    } else {
      if (bytes > MAX_SEEDANCE_AUDIO_INPUT_BYTES)
        throw Object.assign(new Error(`${label}超过 15 MB`), {
          status: 413,
          code: "seedance_audio_size_invalid",
        });
      const probe = await audioProbeRunner(filePath);
      const duration = Number(probe?.durationSeconds || 0);
      if (!Number.isFinite(duration) || duration < 2 || duration > 30)
        throw Object.assign(new Error(`${label}时长必须在 2-30 秒内`), {
          status: 422,
          code: "seedance_audio_duration_invalid",
        });
      if (
        detected.mimeType === "audio/wav" &&
        !probe.formatNames?.some((name) => name === "wav")
      )
        throw Object.assign(new Error(`${label}不是有效 WAV 音频`), {
          status: 415,
          code: "seedance_audio_format_invalid",
        });
      if (
        detected.mimeType === "audio/mpeg" &&
        !["mp3", "mp2", "mp3float"].includes(String(probe.codec || ""))
      )
        throw Object.assign(new Error(`${label}不是有效 MP3 音频`), {
          status: 415,
          code: "seedance_audio_format_invalid",
        });
      audioTotal += duration;
    }
    files.push({
      filePath,
      mimeType: detected.mimeType,
      fileName: `${entry.kind}-${entry.index + 1}.${detected.extension}`,
    });
  }
  if (videoTotal > 30.01)
    throw Object.assign(new Error("本机参考视频总时长不能超过 30 秒"), {
      status: 422,
      code: "seedance_video_total_duration_invalid",
    });
  if (audioTotal > 30.01)
    throw Object.assign(new Error("本机参考音频总时长不能超过 30 秒"), {
      status: 422,
      code: "seedance_audio_total_duration_invalid",
    });
  if (typeof relayManager?.startGroup !== "function")
    throw Object.assign(new Error("服务器素材中继不支持多参考素材"), {
      status: 503,
      code: "asset_relay_group_unavailable",
    });
  const relay = await relayManager.startGroup({
    key: `${seedanceRelayPrefix(takeId)}apimart-media`,
    files,
  });
  const next = {
    ...payload,
    model: "seedance-2.5",
    video_urls: [...(payload.video_urls || [])],
    audio_urls: [...(payload.audio_urls || [])],
  };
  entries.forEach((entry, position) => {
    next[entry.field][entry.index] = relay.publicUrls[position];
  });
  const allVideosLocal =
    entries.filter((entry) => entry.kind === "video").length ===
    (payload.video_urls || []).length;
  return {
    payload: next,
    authoritativeInputVideoDurationMs:
      allVideosLocal && (payload.video_urls || []).length
        ? Math.round(videoTotal * 1000)
        : null,
  };
}
function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}
function normalizedProviderModel(value) {
  return String(value || "")
    .split("::")
    .pop();
}
function normalizeReconcileResolution(value) {
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!token) return null;
  if (token === "4k") return "4k";
  const match = /^(\d{3,4})p?$/.exec(token);
  return match ? match[1] : token;
}
function normalizeReconcileRatio(value) {
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  return token === "auto" ? "adaptive" : token || null;
}
function normalizedReconcileBoolean(value) {
  if (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
  )
    return 1;
  if (
    value === false ||
    value === 0 ||
    value === "0" ||
    String(value).toLowerCase() === "false"
  )
    return 0;
  return null;
}
function nextVolcengineSeed(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const seed = randomInt(1, 2_147_483_647);
    if (
      !db
        .prepare(
          "SELECT 1 AS ok FROM provider_submission_attempt WHERE seed=? LIMIT 1",
        )
        .get(seed)?.ok
    )
      return seed;
  }
  throw Object.assign(new Error("无法分配唯一视频任务 seed"), {
    status: 503,
    code: "video_seed_allocation_failed",
  });
}
function prepareVolcengineSubmission(db, row, channelId, requestPayload, now) {
  if (
    !requestPayload ||
    typeof requestPayload !== "object" ||
    Array.isArray(requestPayload)
  )
    throw Object.assign(new Error("火山视频任务请求必须是 JSON 对象"), {
      status: 400,
      code: "invalid_video_task_json",
    });
  const providedSeed = requestPayload.seed;
  if (
    providedSeed !== undefined &&
    providedSeed !== null &&
    (!Number.isSafeInteger(providedSeed) ||
      providedSeed < -1 ||
      providedSeed >= 2_147_483_647)
  )
    throw Object.assign(new Error("火山视频任务 seed 无效"), {
      status: 400,
      code: "invalid_video_seed",
    });
  const seed =
    providedSeed === undefined || providedSeed === null || providedSeed === -1
      ? nextVolcengineSeed(db)
      : providedSeed;
  const payload = {
    ...requestPayload,
    seed,
  };
  const takeParameters = safeJsonObject(row.paramsJson);
  const expiresAt = new Date(
    new Date(now).getTime() + PROVIDER_RECONCILE_MAX_AGE_MS,
  ).toISOString();
  return {
    payload,
    attempt: {
      takeId: row.takeId,
      channelId,
      provider: "volcengine-ark",
      model: String(
        requestPayload.model || normalizedProviderModel(row.model),
      ).slice(0, 200),
      submittedAt: now,
      seed,
      resolution: normalizeReconcileResolution(
        requestPayload.resolution ?? takeParameters.resolution,
      ),
      ratio: normalizeReconcileRatio(
        requestPayload.ratio ?? takeParameters.aspectRatio,
      ),
      duration: Number.isSafeInteger(requestPayload.duration)
        ? requestPayload.duration
        : Number.isSafeInteger(takeParameters.duration)
          ? takeParameters.duration
          : null,
      generateAudio: normalizedReconcileBoolean(
        requestPayload.generate_audio ?? takeParameters.generateAudio,
      ),
      reconcileStatus: "submitting",
      nextCheckAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  };
}
function prepareApimartSubmission(row, channelId, requestPayload, now) {
  if (
    !requestPayload ||
    typeof requestPayload !== "object" ||
    Array.isArray(requestPayload)
  )
    throw Object.assign(new Error("APIMart 视频任务请求必须是 JSON 对象"), {
      status: 400,
      code: "invalid_video_task_json",
    });
  if (String(requestPayload.model || "") === APIMART_MINIMAX_H3_MODEL_ID)
    validateApimartMiniMaxH3Payload(requestPayload);
  if (isApimartGrokVideo(requestPayload.model))
    validateApimartGrokVideoPayload(requestPayload);
  if (isGrokOfficialModel(requestPayload.model))
    validateGrokOfficialPayload(requestPayload, {
      allowLocalVideo: true,
    });
  const takeParameters = safeJsonObject(row.paramsJson);
  return {
    payload: requestPayload,
    attempt: {
      takeId: row.takeId,
      channelId,
      provider: "apimart",
      model: String(
        requestPayload.model || normalizedProviderModel(row.model),
      ).slice(0, 200),
      submittedAt: now,
      seed: null,
      resolution: normalizeReconcileResolution(
        requestPayload.resolution ?? takeParameters.resolution,
      ),
      ratio: normalizeReconcileRatio(
        requestPayload.aspect_ratio ??
          requestPayload.size ??
          requestPayload.ratio ??
          takeParameters.aspectRatio,
      ),
      duration: Number.isSafeInteger(requestPayload.duration)
        ? requestPayload.duration
        : Number.isSafeInteger(takeParameters.duration)
          ? takeParameters.duration
          : null,
      generateAudio: normalizedReconcileBoolean(
        requestPayload.generate_audio ?? takeParameters.generateAudio,
      ),
      reconcileStatus: "submitting",
      nextCheckAt: now,
      expiresAt: new Date(
        new Date(now).getTime() + APIMART_TASK_MAX_AGE_MS,
      ).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
  };
}
function prepareRichBestSubmission(row, channelId, requestPayload, now) {
  if (
    !requestPayload ||
    typeof requestPayload !== "object" ||
    Array.isArray(requestPayload)
  )
    throw Object.assign(new Error("火山瑞池视频任务请求必须是 JSON 对象"), {
      status: 400,
      code: "invalid_video_task_json",
    });
  const takeParameters = safeJsonObject(row.paramsJson);
  return {
    payload: requestPayload,
    attempt: {
      takeId: row.takeId,
      channelId,
      provider: RICHBEST_CHANNEL_ID,
      model: String(
        requestPayload.model || normalizedProviderModel(row.model),
      ).slice(0, 200),
      submittedAt: now,
      seed: Number.isSafeInteger(requestPayload.seed)
        ? requestPayload.seed
        : null,
      resolution: normalizeReconcileResolution(
        requestPayload.metadata?.resolution ??
          requestPayload.resolution ??
          takeParameters.resolution,
      ),
      ratio: normalizeReconcileRatio(
        requestPayload.metadata?.ratio ??
          requestPayload.ratio ??
          takeParameters.aspectRatio,
      ),
      duration: Number.isSafeInteger(requestPayload.duration)
        ? requestPayload.duration
        : Number.isSafeInteger(takeParameters.duration)
          ? takeParameters.duration
          : null,
      generateAudio: normalizedReconcileBoolean(
        requestPayload.metadata?.generate_audio ??
          requestPayload.generate_audio ??
          takeParameters.generateAudio,
      ),
      reconcileStatus: "submitting",
      nextCheckAt: now,
      expiresAt: new Date(
        new Date(now).getTime() + RICHBEST_TASK_MAX_AGE_MS,
      ).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
  };
}
function prepare888ApiSubmission(row, channelId, requestPayload, now) {
  const validated = validate888ApiRequest(requestPayload, "video.generate", {
    allowLocalObjects: true,
  });
  return {
    payload: requestPayload,
    attempt: {
      takeId: row.takeId,
      channelId,
      provider: API888_PROVIDER,
      model: validated.modelId,
      submittedAt: now,
      seed: null,
      resolution: "720p",
      ratio: normalizeReconcileRatio(requestPayload.ratio),
      duration: validated.seconds,
      generateAudio: null,
      reconcileStatus: "submitting",
      nextCheckAt: now,
      expiresAt: new Date(
        new Date(now).getTime() + RICHBEST_TASK_MAX_AGE_MS,
      ).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
  };
}
function prepareRunningHubSubmission(
  row,
  channelId,
  requestPayload,
  now,
  requestModel,
) {
  if (requestModel === RUNNINGHUB_SEEDANCE_25_MODEL_ID)
    validateRunningHubSeedancePayload(requestPayload);
  else validateRunningHubGrokPayload(requestModel, requestPayload);
  const takeParameters = safeJsonObject(row.paramsJson);
  return {
    payload: requestPayload,
    attempt: {
      takeId: row.takeId,
      channelId,
      provider: "runninghub",
      model: requestModel,
      submittedAt: now,
      seed: null,
      resolution: normalizeReconcileResolution(
        requestPayload.resolution ?? takeParameters.resolution,
      ),
      ratio: normalizeReconcileRatio(
        requestPayload.ratio ??
          requestPayload.aspectRatio ??
          takeParameters.aspectRatio,
      ),
      duration: Number.isSafeInteger(Number(requestPayload.duration))
        ? Number(requestPayload.duration)
        : Number.isSafeInteger(takeParameters.duration)
          ? takeParameters.duration
          : null,
      generateAudio: normalizedReconcileBoolean(
        requestPayload.generateAudio ?? takeParameters.generateAudio,
      ),
      reconcileStatus: "submitting",
      nextCheckAt: now,
      expiresAt: new Date(
        new Date(now).getTime() + RUNNINGHUB_TASK_MAX_AGE_MS,
      ).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
  };
}
function persistProviderSubmissionAttempt(db, attempt) {
  db.prepare(
    "INSERT INTO provider_submission_attempt(take_id,channel_id,provider,model,submitted_at,seed,resolution,ratio,duration,generate_audio,reconcile_status,attempt_count,next_check_at,last_error,candidates_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,'[]',?,?,?) ON CONFLICT(take_id) DO NOTHING",
  ).run(
    attempt.takeId,
    attempt.channelId,
    attempt.provider,
    attempt.model,
    attempt.submittedAt,
    attempt.seed,
    attempt.resolution,
    attempt.ratio,
    attempt.duration,
    attempt.generateAudio,
    attempt.reconcileStatus,
    attempt.nextCheckAt,
    attempt.lastError ? safeReconcileError(attempt.lastError) : null,
    attempt.expiresAt,
    attempt.createdAt,
    attempt.updatedAt,
  );
}
function backfillProviderSubmissionAttempts(db) {
  const rows = db
    .prepare(
      "SELECT take_id AS takeId,status,provider,task_id AS taskId,model,params_json AS paramsJson,created_at AS createdAt FROM video_generation_take WHERE imported_history=0 AND status IN ('submission_unknown','pending','result_pending') AND (provider IN ('volcengine-ark','apimart','runninghub','richbest','888api') OR model LIKE 'volcengine-ark%::%' OR model LIKE 'apimart%::%' OR model LIKE 'runninghub%::%' OR model LIKE 'richbest%::%' OR model LIKE '888api%::%') AND NOT EXISTS(SELECT 1 FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id)",
    )
    .all();
  for (const row of rows) {
    const parameters = safeJsonObject(row.paramsJson);
    const provider =
      row.provider === API888_PROVIDER ||
      String(row.model || "").startsWith(`${API888_CHANNEL_ID}::`)
        ? API888_PROVIDER
        : row.provider === RICHBEST_CHANNEL_ID ||
            String(row.model || "").startsWith(`${RICHBEST_CHANNEL_ID}::`)
          ? RICHBEST_CHANNEL_ID
          : row.provider === "runninghub" ||
              String(row.model || "").startsWith("runninghub::")
            ? "runninghub"
            : row.provider === "apimart" ||
                String(row.model || "").startsWith("apimart::")
              ? "apimart"
              : "volcengine-ark";
    const channelId = String(row.model || "").includes("::")
      ? String(row.model).split("::", 1)[0]
      : provider === "apimart"
        ? "apimart"
        : provider === "runninghub"
          ? "runninghub"
          : provider === RICHBEST_CHANNEL_ID
            ? RICHBEST_CHANNEL_ID
            : provider === API888_PROVIDER
              ? API888_CHANNEL_ID
              : "volcengine-ark-gx";
    const submittedAt = row.createdAt || isoNow();
    const expiresAt = new Date(
      new Date(submittedAt).getTime() +
        (provider === "apimart"
          ? APIMART_TASK_MAX_AGE_MS
          : provider === "runninghub"
            ? RUNNINGHUB_TASK_MAX_AGE_MS
            : provider === RICHBEST_CHANNEL_ID
              ? RICHBEST_TASK_MAX_AGE_MS
              : PROVIDER_RECONCILE_MAX_AGE_MS),
    ).toISOString();
    const now = isoNow();
    persistProviderSubmissionAttempt(db, {
      takeId: row.takeId,
      channelId,
      provider,
      model: normalizedProviderModel(row.model),
      submittedAt,
      seed: null,
      resolution: normalizeReconcileResolution(parameters.resolution),
      ratio: normalizeReconcileRatio(parameters.aspectRatio),
      duration: Number.isSafeInteger(parameters.duration)
        ? parameters.duration
        : null,
      generateAudio: normalizedReconcileBoolean(parameters.generateAudio),
      reconcileStatus: row.taskId ? "monitoring" : "legacy_untracked",
      nextCheckAt: now,
      lastError: row.taskId ? null : "legacy_request_missing_correlation_seed",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    if (!row.provider)
      db.prepare(
        "UPDATE video_generation_take SET provider=? WHERE take_id=? AND provider IS NULL",
      ).run(provider, row.takeId);
  }
  const quarantined = db
    .prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='legacy_untracked',next_check_at=?,last_error='legacy_request_missing_correlation_seed',candidates_json='[]',updated_at=? WHERE provider='volcengine-ark' AND seed IS NULL AND reconcile_status IN ('submitting','pending','no_match','candidates') AND take_id IN (SELECT take_id FROM video_generation_take WHERE task_id IS NULL)",
    )
    .run(isoNow(), isoNow());
  if (quarantined.changes)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.legacy_reconcile_quarantined','startup',?,?)",
    ).run(
      JSON.stringify({
        count: quarantined.changes,
      }),
      isoNow(),
    );
}
function beginVideoTakeSubmission(
  db,
  takeId,
  channelId,
  provider,
  requestPayload,
  requestModel,
  claimPoints = () => undefined,
) {
  const row = db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId);
  if (!row)
    throw Object.assign(new Error("视频版本不存在"), {
      status: 404,
      code: "video_take_not_found",
    });
  if (!requestModelMatchesTake(row.model, requestModel, requestPayload))
    throw Object.assign(new Error("视频版本模型与提交模型不一致"), {
      status: 409,
      code: "video_take_model_mismatch",
    });
  if (row.taskId) {
    claimPoints();
    return {
      row,
      recovered: true,
    };
  }
  if (row.status === "submitting")
    throw Object.assign(
      new Error(
        "该视频版本正在提交；系统会在 20 秒内核对原任务，随后可创建新版本",
      ),
      {
        status: 409,
        code: "video_take_submission_in_progress",
      },
    );
  if (row.status === "submission_unknown")
    throw Object.assign(
      new Error("该视频版本正在核对原任务；请使用“创建新视频任务”继续制作"),
      {
        status: 409,
        code: "video_take_submission_unknown",
      },
    );
  if (row.status !== "created")
    throw Object.assign(new Error("该视频版本已结束；请创建新的生成版本"), {
      status: 409,
      code: "video_take_requires_new_version",
    });
  const now = isoNow();
  const prepared =
    provider === "volcengine-ark"
      ? prepareVolcengineSubmission(db, row, channelId, requestPayload, now)
      : provider === "apimart"
        ? prepareApimartSubmission(row, channelId, requestPayload, now)
        : provider === "runninghub"
          ? prepareRunningHubSubmission(
              row,
              channelId,
              requestPayload,
              now,
              requestModel,
            )
          : provider === RICHBEST_CHANNEL_ID
            ? prepareRichBestSubmission(row, channelId, requestPayload, now)
            : provider === API888_PROVIDER
              ? prepare888ApiSubmission(row, channelId, requestPayload, now)
              : null;
  db.exec("BEGIN IMMEDIATE");
  try {
    claimPoints();
    db.prepare(
      "UPDATE video_generation_take SET status='submitting',provider=?,error_code=NULL,updated_at=? WHERE take_id=?",
    ).run(provider, now, takeId);
    if (prepared) persistProviderSubmissionAttempt(db, prepared.attempt);
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.submitting',?,?,?)",
    ).run(
      takeId,
      JSON.stringify({
        provider,
        correlated: Boolean(prepared),
      }),
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    row: db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId),
    recovered: false,
    requestPayload: prepared?.payload || requestPayload,
  };
}
function setUnresolvedVideoTake(db, takeId, status, errorCode, providerError) {
  const now = isoNow();
  const failure = normalizeProviderFailure(providerError);
  db.prepare(
    "UPDATE video_generation_take SET status=?,error_code=?,provider_http_status=?,provider_error_code=?,provider_error_message=?,provider_request_id=?,updated_at=? WHERE take_id=? AND task_id IS NULL",
  ).run(
    status,
    errorCode,
    failure?.httpStatus ?? null,
    failure?.code ?? null,
    failure?.message ?? null,
    failure?.requestId ?? null,
    now,
    takeId,
  );
  if (status === "submission_unknown")
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='pending',next_check_at=?,last_error=?,updated_at=? WHERE take_id=?",
    ).run(now, safeReconcileError(errorCode), now, takeId);
  else if (status === "failed")
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='rejected',last_error=?,updated_at=? WHERE take_id=?",
    ).run(safeReconcileError(errorCode), now, takeId);
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.submission_result',?,?,?)",
  ).run(
    takeId,
    JSON.stringify({
      status,
      errorCode,
      ...(failure
        ? {
            providerError: failure,
          }
        : {}),
    }),
    now,
  );
}
function providerTaskId(payload, provider = "") {
  const data = payload?.data;
  const candidates = [
    payload?.id,
    payload?.task_id,
    payload?.taskId,
    !Array.isArray(data) && data?.id,
    !Array.isArray(data) && data?.task_id,
    !Array.isArray(data) && data?.taskId,
    Array.isArray(data) && data[0]?.id,
    Array.isArray(data) && data[0]?.task_id,
    Array.isArray(data) && data[0]?.taskId,
    payload?.result?.id,
    payload?.result?.task_id,
    payload?.result?.taskId,
  ];
  return String(
    candidates.find(
      (value) =>
        (typeof value === "string" || typeof value === "number") &&
        validProviderTaskId(provider, value),
    ) || "",
  );
}
function persistSubmittedVideoTask(
  db,
  takeId,
  provider,
  taskId,
  channelId,
  bindPoints = () => undefined,
) {
  const row = db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId);
  if (!row)
    throw Object.assign(new Error("视频版本不存在"), {
      status: 404,
      code: "video_take_not_found",
    });
  if (row.taskId) {
    if (row.provider !== provider || row.taskId !== taskId)
      throw Object.assign(new Error("视频版本已经绑定其他供应商任务"), {
        status: 409,
        code: "video_take_task_conflict",
      });
    return generationTaskRow(
      db
        .prepare(`${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`)
        .get(provider, taskId),
    );
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = upsertGenerationTask(
      db,
      {
        provider,
        taskId,
      },
      {
        mediaKind: "video",
        model: row.model,
        channelId,
        projectId: row.projectId,
        nodeId: row.nodeId,
        status: "pending",
      },
    );
    bindPoints();
    const now = isoNow();
    const firstCheckAt = new Date(
      Date.now() + providerInitialPollDelay("video"),
    ).toISOString();
    db.prepare(
      "UPDATE video_generation_take SET status='pending',provider=?,task_id=?,error_code=NULL,provider_http_status=NULL,provider_error_code=NULL,provider_error_message=NULL,provider_request_id=NULL,updated_at=? WHERE take_id=?",
    ).run(provider, taskId, now, takeId);
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='monitoring',consecutive_error_count=0,poll_phase='initial_wait',phase_attempt_count=0,next_check_at=?,last_error=NULL,candidates_json='[]',updated_at=? WHERE take_id=?",
    ).run(firstCheckAt, now, takeId);
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.task_persisted',?,?,?)",
    ).run(
      takeId,
      JSON.stringify({
        provider,
        taskId,
      }),
      now,
    );
    db.exec("COMMIT");
    return task;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function selectProviderReconcileCandidate(db, takeId, taskId) {
  const attempt = db
    .prepare(`${PROVIDER_ATTEMPT_SELECT} WHERE a.take_id=?`)
    .get(takeId);
  if (!attempt || attempt.taskId || attempt.reconcileStatus !== "candidates")
    throw Object.assign(new Error("该视频版本当前没有可选择的恢复候选"), {
      status: 409,
      code: "reconcile_candidate_unavailable",
    });
  let candidates = [];
  try {
    candidates = JSON.parse(attempt.candidatesJson || "[]");
  } catch {}
  if (
    !Array.isArray(candidates) ||
    !candidates.some((candidate) => candidate?.taskId === taskId)
  )
    throw Object.assign(new Error("恢复候选不在系统已核对的清单中"), {
      status: 409,
      code: "reconcile_candidate_invalid",
    });
  persistSubmittedVideoTask(
    db,
    takeId,
    attempt.provider,
    taskId,
    attempt.channelId,
  );
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.reconcile_selected',?,?,?)",
  ).run(
    takeId,
    JSON.stringify({
      provider: attempt.provider,
      taskId,
    }),
    isoNow(),
  );
  return videoTakeRow(
    db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId),
  );
}
function closeProviderReconcileNotFound(db, takeId) {
  const attempt = db
    .prepare(`${PROVIDER_ATTEMPT_SELECT} WHERE a.take_id=?`)
    .get(takeId);
  if (!attempt || attempt.taskId || attempt.takeStatus !== "submission_unknown")
    throw Object.assign(new Error("该视频版本当前不能结束为未找到"), {
      status: 409,
      code: "reconcile_not_found_unavailable",
    });
  if (attempt.provider === "apimart" && isGrokOfficialModel(attempt.model))
    throw Object.assign(
      new Error("Grok 官方原幂等请求尚未核实，不能按未找到关闭或退款"),
      {
        status: 409,
        code: "grok_official_idempotency_unresolved",
      },
    );
  if (
    !["no_match", "legacy_untracked", "expired"].includes(
      attempt.reconcileStatus,
    )
  )
    throw Object.assign(new Error("供应商任务核对尚未形成可结束结论"), {
      status: 409,
      code: "reconcile_not_found_not_ready",
    });
  let candidates = [];
  try {
    candidates = JSON.parse(attempt.candidatesJson || "[]");
  } catch {}
  if (Array.isArray(candidates) && candidates.length)
    throw Object.assign(new Error("仍有供应商任务候选，不能标记为未找到"), {
      status: 409,
      code: "reconcile_candidates_remain",
    });
  const now = isoNow();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE video_generation_take SET status='failed',error_code='provider_task_not_found',updated_at=? WHERE take_id=? AND task_id IS NULL",
    ).run(now, takeId);
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='not_found',next_check_at=?,last_error='provider_task_not_found',candidates_json='[]',updated_at=? WHERE take_id=?",
    ).run(now, now, takeId);
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.reconcile_closed_not_found',?,?,?)",
    ).run(
      takeId,
      JSON.stringify({
        provider: attempt.provider,
        checks: Number(attempt.attemptCount || 0),
        resubmitted: false,
      }),
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return videoTakeRow(
    db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId),
  );
}
function recoveredTaskPayload(provider, taskId) {
  if (provider === "runninghub")
    return {
      taskId,
      status: "QUEUED",
      recovered: true,
    };
  return provider === "apimart"
    ? {
        data: [
          {
            task_id: taskId,
          },
        ],
        recovered: true,
      }
    : {
        id: taskId,
        status: "queued",
        recovered: true,
      };
}
function sendBufferedProxyResponse(res, response, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(response.status, proxyResponseHeaders(response, body.length));
  res.end(body);
}
function providerRequestModel(path, payload) {
  if (path === RUNNINGHUB_REQUEST_PATH || path === RUNNINGHUB_CREATE_PATH)
    return RUNNINGHUB_SEEDANCE_25_MODEL_ID;
  const runningHubGrokModel = runningHubGrokModelForPath(path);
  if (runningHubGrokModel) return runningHubGrokModel;
  const bodyModel = String(payload?.model || "").trim();
  if (/^[a-zA-Z0-9_.:/-]{1,200}$/.test(bodyModel)) return bodyModel;
  const gemini =
    /\/models\/([^/:]{1,200}):(?:generateContent|streamGenerateContent)\/?$/.exec(
      path,
    )?.[1] || "";
  if (/^[a-zA-Z0-9_.-]{1,200}$/.test(gemini)) return decodeURIComponent(gemini);
  throw Object.assign(new Error("无法从供应商请求确认模型"), {
    status: 400,
    code: "provider_model_unresolved",
  });
}
async function proxyAi(
  req,
  res,
  url,
  db,
  dataRoot,
  credentialResolver,
  credentialHosts,
  relayManager,
  videoProbeRunner,
  audioProbeRunner,
  onVolcAssetBindingsUpdated = () => undefined,
  providerEndpointPolicy = {},
  prepareGrokOfficialQuote,
  remoteObjectHosts,
  remoteImportPolicy,
) {
  const { channelId, requestPath: path } = aiProxyRequestIdentity(url.pathname);
  const channel = readAiChannel(
    db,
    channelId,
    credentialResolver,
    credentialHosts,
    providerEndpointPolicy,
  );
  const base = new URL(channel.baseUrl);
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && isLoopback(base.hostname))
  )
    throw Object.assign(new Error("安全策略仅允许 HTTPS 或本机回环模型接口"), {
      status: 403,
    });
  const target = joinUpstreamUrl(base, path, url.search);
  const fetchProvider = fetchApimartRoute.prepare(target, {
    dataRoot,
    provider: channel.provider,
  });
  const runningHubOperation =
    channel.provider === "runninghub"
      ? runningHubRoute(target, req.method)
      : "";
  if (channel.provider === API888_PROVIDER) {
    const createVideo =
      req.method === "POST" && target.pathname === "/v1/videos";
    const createImage =
      req.method === "POST" && target.pathname === "/v1/images/generations";
    const videoQuery =
      req.method === "GET" &&
      /^\/v1\/videos\/[a-zA-Z0-9_.:-]{3,200}$/.test(target.pathname);
    if (!createVideo && !createImage && !videoQuery)
      throw Object.assign(new Error("888API 当前支持图片/视频创建和任务查询"), {
        status: 403,
        code: "api888_route_not_ready",
      });
    if (
      (createVideo || createImage) &&
      providerEndpointPolicy.api888PilotEnabled !== true
    )
      throw Object.assign(new Error("888API 生成试点未启用"), {
        status: 409,
        code: "api888_pilot_not_enabled",
      });
  }
  if (channel.provider === "runninghub" && !runningHubOperation)
    throw Object.assign(
      new Error(
        "RunningHub 渠道只允许素材上传、已配置视频工作流创建和任务查询",
      ),
      {
        status: 403,
        code: "runninghub_video_path_only",
      },
    );
  if (channel.provider === "volcengine-ark") {
    const createTask =
      req.method === "POST" &&
      target.pathname === "/api/v3/contents/generations/tasks";
    const listTasks =
      req.method === "GET" &&
      target.pathname === "/api/v3/contents/generations/tasks";
    const queryTask =
      req.method === "GET" &&
      /^\/api\/v3\/contents\/generations\/tasks\/cgt-[a-zA-Z0-9_-]{3,180}$/.test(
        target.pathname,
      );
    if (!createTask && !listTasks && !queryTask)
      throw Object.assign(
        new Error("火山 Seedance 渠道只允许创建或查询视频生成任务"),
        {
          status: 403,
          code: "volcengine_video_path_only",
        },
      );
  }
  if (
    channel.provider === "apimart" &&
    target.pathname === "/v1/uploads/images" &&
    Number(req.headers["content-length"] || 0) > MAX_APIMART_IMAGE_UPLOAD
  )
    throw Object.assign(new Error("APIMart 参考图上传不得超过 20 MB"), {
      status: 413,
    });
  if (
    runningHubOperation === "upload" &&
    Number(req.headers["content-length"] || 0) > MAX_RUNNINGHUB_MEDIA_UPLOAD
  )
    throw Object.assign(new Error("RunningHub 参考素材上传不得超过 512 MB"), {
      status: 413,
      code: "runninghub_media_too_large",
    });
  const richBestMediaUpload =
    channel.provider === RICHBEST_CHANNEL_ID &&
    target.pathname === "/api/asset/upload-file";
  if (
    richBestMediaUpload &&
    Number(req.headers["content-length"] || 0) > MAX_RICHBEST_MEDIA_UPLOAD
  )
    throw Object.assign(new Error("火山瑞池参考素材上传不得超过 200 MB"), {
      status: 413,
      code: "richbest_media_too_large",
    });
  const takeId = localVideoTakeId(req);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      !value ||
      [
        "host",
        "origin",
        "authorization",
        "x-goog-api-key",
        "connection",
        LOCAL_VIDEO_TAKE_HEADER,
        "x-narralight-points-task-id",
      ].includes(name.toLowerCase())
    )
      continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  if (channel.provider === "volcengine-ark")
    assertVolcengineCredentialFormat(channel.apiKey);
  if (channel.apiFormat === "gemini")
    headers.set("x-goog-api-key", channel.apiKey);
  else headers.set("authorization", `Bearer ${channel.apiKey}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const bufferedProvider =
    channel.provider === "apimart" ||
    channel.provider === "volcengine-ark" ||
    channel.provider === "runninghub" ||
    channel.provider === "richbest" ||
    channel.provider === API888_PROVIDER ||
    Boolean(null);
  const bodyLimit =
    target.pathname === "/v1/uploads/images"
      ? MAX_APIMART_IMAGE_UPLOAD
      : runningHubOperation === "upload"
        ? MAX_RUNNINGHUB_MEDIA_UPLOAD
        : richBestMediaUpload
          ? MAX_RICHBEST_MEDIA_UPLOAD
          : MAX_JSON;
  let bufferedBody =
    hasBody && bufferedProvider ? await readBuffer(req, bodyLimit) : undefined;
  let requestPayload;
  const createProvider = videoTaskCreateProvider(channel, target, req.method);
  const imageCreateProvider = imageTaskCreateProvider(
    channel,
    target,
    req.method,
  );
  if (
    bufferedBody &&
    runningHubOperation !== "upload" &&
    (channel.provider === "volcengine-ark" ||
      channel.provider === "runninghub" ||
      takeId ||
      imageCreateProvider ||
      (channel.provider === "apimart" &&
        target.pathname === "/v1/videos/generations"))
  ) {
    try {
      requestPayload = JSON.parse(bufferedBody.toString("utf8"));
    } catch {
      throw Object.assign(new Error("模型任务请求必须是 JSON"), {
        status: 400,
        code: "invalid_model_task_json",
      });
    }
    if (channel.provider === "volcengine-ark") {
      validateVolcengineVideoPayload(requestPayload, {
        allowLocalVideoObjects: Boolean(
          takeId && createProvider === "volcengine-ark",
        ),
      });
      assertVolcAssetGenerationPayloadAllowed(db, requestPayload, channelId);
    }
    if (
      channel.provider === "apimart" &&
      createProvider === "apimart" &&
      ["seedance-2.5", "doubao-seedance-2.5"].includes(
        String(requestPayload?.model || "").toLowerCase(),
      )
    ) {
      validateApimartSeedance25Payload(requestPayload, {
        allowLocalMediaObjects: Boolean(takeId),
      });
    }
    if (
      channel.provider === "apimart" &&
      createProvider === "apimart" &&
      String(requestPayload?.model || "") === APIMART_MINIMAX_H3_MODEL_ID
    )
      validateApimartMiniMaxH3Payload(requestPayload);
    if (
      channel.provider === "apimart" &&
      createProvider === "apimart" &&
      isApimartGrokVideo(requestPayload?.model)
    )
      validateApimartGrokVideoPayload(requestPayload);
    if (
      channel.provider === "apimart" &&
      createProvider === "apimart" &&
      isGrokOfficialModel(requestPayload?.model)
    )
      validateGrokOfficialPayload(requestPayload, {
        allowLocalVideo: true,
      });
    if (runningHubOperation === "create") {
      const runningHubModel = providerRequestModel(
        target.pathname,
        requestPayload,
      );
      if (runningHubModel === RUNNINGHUB_SEEDANCE_25_MODEL_ID)
        validateRunningHubSeedancePayload(requestPayload);
      else validateRunningHubGrokPayload(runningHubModel, requestPayload);
    }
    if (runningHubOperation === "query")
      validateRunningHubQueryPayload(requestPayload);
    if (
      channel.provider === API888_PROVIDER &&
      createProvider === API888_PROVIDER
    ) {
      validate888ApiRequest(requestPayload, "video.generate", {
        allowLocalObjects: true,
      });
    }
    if (
      channel.provider === API888_PROVIDER &&
      target.pathname === "/v1/images/generations"
    )
      validate888ApiRequest(requestPayload, "image.generate");
  }
  if (imageCreateProvider && void 0 && null.task.providerTaskId)
    return sendJson(
      res,
      200,
      recoveredTaskPayload(imageCreateProvider, null.task.providerTaskId),
    );
  const submissionProvider = takeId ? createProvider : "";
  const managedCreationProvider = imageCreateProvider || createProvider;
  const managedMediaKind = imageCreateProvider ? "image" : "video";
  const managedCreation = Boolean(
    imageCreateProvider || MANAGED_VIDEO_PROVIDERS.has(createProvider),
  );
  if (createProvider && !takeId)
    throw Object.assign(
      new Error("视频任务必须先创建本机 Take，才能提交到供应商"),
      {
        status: 409,
        code: "video_take_required",
      },
    );
  if (takeId && !submissionProvider)
    throw Object.assign(
      new Error("视频版本只能绑定到受支持的异步视频创建接口"),
      {
        status: 400,
        code: "video_take_route_invalid",
      },
    );
  const submissionModel =
    createProvider &&
    (requestPayload || runningHubGrokModelForPath(target.pathname))
      ? providerRequestModel(target.pathname, requestPayload)
      : "";
  const officialRequest =
    channel.provider === "apimart" &&
    createProvider === "apimart" &&
    isGrokOfficialModel(requestPayload?.model);
  const originalTake = takeId
    ? db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId)
    : null;
  if (officialRequest && !originalTake?.taskId) {
    if (originalTake?.status !== "created")
      throw Object.assign(new Error("请恢复原 Grok 任务，不要重复提交"), {
        status: 409,
        code: "video_take_requires_new_version",
      });
    const quote = await prepareGrokOfficialQuote(requestPayload);
    void 0;
  }
  const submission = takeId
    ? beginVideoTakeSubmission(
        db,
        takeId,
        channelId,
        submissionProvider,
        requestPayload,
        submissionModel,
        () => void 0,
      )
    : null;
  if (submission?.recovered) {
    void 0;
    return sendJson(
      res,
      200,
      recoveredTaskPayload(submissionProvider, submission.row.taskId),
    );
  }
  if (submission?.requestPayload) requestPayload = submission.requestPayload;
  if (officialRequest) {
    headers.set("idempotency-key", takeId);
    headers.delete("x-apimart-response-version");
    if (requestPayload.video) {
      try {
        const reference = grokOfficialLocalVideo(requestPayload.video.url);
        if (!reference)
          throw Object.assign(
            new Error("编辑源视频须先保存为叙光对象以核实时长"),
            {
              status: 400,
              code: "grok_official_edit_source_unverified",
            },
          );
        const relay = await relayManager.start({
          key: `${seedanceRelayPrefix(takeId)}${reference.hash}`,
          filePath: objectPath(dataRoot, reference.hash),
          mimeType: reference.mimeType,
          fileName: `grok-edit.${reference.mimeType === "video/mp4" ? "mp4" : "mov"}`,
        });
        requestPayload = {
          ...requestPayload,
          video: {
            url: relay.publicUrl,
          },
        };
        validateGrokOfficialPayload(requestPayload);
      } catch (error) {
        stopSeedanceTakeRelays(relayManager, takeId);
        setUnresolvedVideoTake(
          db,
          takeId,
          "failed",
          safeReconcileError(error?.code || "grok_official_relay_failed"),
        );
        throw error;
      }
    }
  }
  if (
    channel.provider === "volcengine-ark" &&
    createProvider === "volcengine-ark"
  ) {
    try {
      const prepared = await prepareSeedanceLocalVideoInputs(
        db,
        dataRoot,
        takeId,
        requestPayload,
        relayManager,
        videoProbeRunner,
      );
      requestPayload = prepared.payload;
      validateVolcengineVideoPayload(requestPayload);
      if (prepared.authoritativeInputVideoDurationMs !== null) void 0;
    } catch (error) {
      stopSeedanceTakeRelays(relayManager, takeId);
      if (takeId)
        setUnresolvedVideoTake(
          db,
          takeId,
          "failed",
          safeReconcileError(error?.code || "local_video_preflight_failed"),
        );
      throw error;
    }
  }
  if (
    channel.provider === "apimart" &&
    createProvider === "apimart" &&
    ["seedance-2.5", "doubao-seedance-2.5"].includes(
      String(requestPayload?.model || "").toLowerCase(),
    )
  ) {
    try {
      const prepared = await prepareApimartSeedance25LocalInputs(
        db,
        dataRoot,
        takeId,
        requestPayload,
        relayManager,
        videoProbeRunner,
        audioProbeRunner,
      );
      requestPayload = prepared.payload;
      validateApimartSeedance25Payload(requestPayload);
      if (prepared.authoritativeInputVideoDurationMs !== null) void 0;
    } catch (error) {
      stopSeedanceTakeRelays(relayManager, takeId);
      if (takeId)
        setUnresolvedVideoTake(
          db,
          takeId,
          "failed",
          safeReconcileError(error?.code || "local_media_preflight_failed"),
        );
      throw error;
    }
  }
  if (
    channel.provider === API888_PROVIDER &&
    createProvider === API888_PROVIDER
  ) {
    try {
      requestPayload = await prepare888ApiReferences(
        dataRoot,
        takeId,
        requestPayload,
        relayManager,
      );
    } catch (error) {
      stopSeedanceTakeRelays(relayManager, takeId);
      setUnresolvedVideoTake(
        db,
        takeId,
        "failed",
        safeReconcileError(error?.code || "api888_reference_preflight_failed"),
      );
      throw error;
    }
  }
  if (
    requestPayload &&
    bufferedBody &&
    JSON.stringify(requestPayload) !== bufferedBody.toString("utf8")
  ) {
    bufferedBody = Buffer.from(JSON.stringify(requestPayload));
    headers.set("content-length", String(bufferedBody.length));
  }
  if (officialRequest) {
    const exactPayload = JSON.stringify(requestPayload);
    const requestHash = createHash("sha256").update(exactPayload).digest("hex");
    const existing = db
      .prepare(
        "SELECT idempotency_key,request_sha256 FROM grok_official_submission WHERE take_id=?",
      )
      .get(takeId);
    if (
      existing &&
      (existing.idempotency_key !== takeId ||
        existing.request_sha256 !== requestHash)
    )
      throw Object.assign(
        new Error("Grok 官方原请求体已冻结，不能变更幂等 Key 或请求体"),
        {
          status: 409,
          code: "grok_official_idempotency_body_mismatch",
          meterDisposition: "frozen",
        },
      );
    const now = isoNow();
    db.prepare(
      "INSERT OR IGNORE INTO grok_official_submission(take_id,idempotency_key,request_json,request_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).run(takeId, takeId, exactPayload, requestHash, now, now);
  }
  const body = !hasBody ? undefined : bufferedBody || Readable.toWeb(req);
  let response;
  try {
    response = await fetchProvider({
      method: req.method,
      headers,
      body,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: bufferedProvider || takeId ? undefined : req.signal,
    });
  } catch (error) {
    if (takeId)
      setUnresolvedVideoTake(
        db,
        takeId,
        "submission_unknown",
        "provider_connection_lost_after_submit",
      );
    throw error;
  }
  if (takeId || managedCreation) {
    let responseBody;
    try {
      responseBody = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (takeId)
        setUnresolvedVideoTake(
          db,
          takeId,
          "submission_unknown",
          "provider_response_interrupted",
        );
      throw error;
    }
    if (response.ok) {
      let responsePayload;
      try {
        responsePayload = JSON.parse(responseBody.toString("utf8"));
      } catch {}
      const taskId = providerTaskId(responsePayload, managedCreationProvider);
      if (taskId) {
        try {
          if (takeId)
            persistSubmittedVideoTask(
              db,
              takeId,
              submissionProvider,
              taskId,
              channelId,
              () => void 0,
            );
          else
            upsertGenerationTask(
              db,
              {
                provider: managedCreationProvider,
                taskId,
              },
              {
                mediaKind: managedMediaKind,
                model: `${channelId}::${String(requestPayload?.model || "unknown").slice(0, 180)}`,
                channelId,
                projectId: (void 0).projectId,
                status: "pending",
              },
            );
          if (!takeId) void 0;
          if (createProvider === "volcengine-ark")
            onVolcAssetBindingsUpdated(
              markVolcAssetGenerationVerified(db, requestPayload, channelId),
            );
        } catch (error) {
          if (takeId)
            setUnresolvedVideoTake(
              db,
              takeId,
              "submission_unknown",
              "local_task_persist_failed_after_provider_success",
            );
          throw error;
        }
      } else {
        if (takeId)
          setUnresolvedVideoTake(
            db,
            takeId,
            "submission_unknown",
            "provider_task_id_missing",
          );
      }
    } else {
      const failure = providerFailureFromResponse(
        response,
        responseBody,
        requestPayload,
      );
      const explicitRejection = officialRequest
        ? [400, 401, 402, 403].includes(response.status)
        : response.status >= 400 && response.status < 500;
      if (officialRequest)
        db.prepare(
          "UPDATE grok_official_submission SET last_http_status=?,updated_at=? WHERE take_id=?",
        ).run(response.status, isoNow(), takeId);
      if (takeId)
        setUnresolvedVideoTake(
          db,
          takeId,
          explicitRejection ? "failed" : "submission_unknown",
          explicitRejection
            ? `task_create_rejected_http_${response.status}`
            : `task_create_response_unknown_http_${response.status}`,
          failure,
        );
      stopSeedanceTakeRelays(relayManager, takeId);
      if (createProvider === "volcengine-ark")
        onVolcAssetBindingsUpdated(
          markVolcAssetGenerationInaccessible(
            db,
            requestPayload,
            channelId,
            failure,
          ),
        );
      logApiError(
        res,
        response.status,
        normalizedApiError(
          response.status,
          {
            error: failure?.message || `供应商接口返回 HTTP ${response.status}`,
            code: failure?.code || `provider_http_${response.status}`,
            providerError: failure,
          },
          res.narralightRequestId,
        ),
      );
    }
    return sendBufferedProxyResponse(res, response, responseBody);
  }
  if (
    channel.provider === API888_PROVIDER &&
    target.pathname === "/v1/images/generations" &&
    response.ok
  ) {
    try {
      if (!response.body)
        throw Object.assign(new Error("888API 图片响应为空"), {
          code: "api888_image_response_empty",
        });
      const bytes = await readBuffer(
        Readable.fromWeb(response.body),
        MAX_REMOTE_IMAGE_IMPORT * 2 + 65536,
      );
      const payload = JSON.parse(bytes.toString("utf8"));
      if (!Array.isArray(payload?.data) || payload.data.length !== 1)
        throw Object.assign(new Error("888API 图片响应数量不符"), {
          code: "api888_image_response_invalid",
        });
      const item = payload.data[0];
      let stored;
      if (typeof item?.b64_json === "string") {
        const encoded = item.b64_json;
        if (
          encoded.length > MAX_REMOTE_IMAGE_IMPORT * 2 ||
          encoded.length % 4 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        )
          throw Object.assign(new Error("888API 图片 Base64 无效"), {
            code: "api888_image_base64_invalid",
          });
        const decoded = Buffer.from(encoded, "base64");
        if (!decoded.length || decoded.length > MAX_REMOTE_IMAGE_IMPORT)
          throw Object.assign(new Error("888API 图片超出归档限制"), {
            code: "api888_image_size_invalid",
          });
        const staged = await receiveTemporaryObject(
          Object.assign(Readable.from([decoded]), {
            headers: {
              "content-type": "image/png",
              "content-length": String(decoded.length),
            },
          }),
          dataRoot,
          MAX_REMOTE_IMAGE_IMPORT,
          "64 MB",
        );
        const detected = detectVolcLocalMedia(staged.temp);
        if (
          detected.mediaKind !== "image" ||
          !["image/jpeg", "image/png", "image/webp"].includes(detected.mimeType)
        ) {
          unlinkSync(staged.temp);
          throw Object.assign(new Error("888API 图片格式无效"), {
            code: "api888_image_mime_invalid",
          });
        }
        stored = commitTemporaryObject(
          {
            ...staged,
            mimeType: detected.mimeType,
          },
          dataRoot,
          db,
          "",
        );
      } else if (typeof item?.url === "string") {
        stored = await importRemoteObject(
          {
            provider: API888_PROVIDER,
            url: item.url,
            mediaKind: "image",
          },
          dataRoot,
          db,
          remoteObjectHosts,
          {
            ...remoteImportPolicy,
            api888TrustedImage: true,
          },
        );
      } else
        throw Object.assign(new Error("888API 图片响应没有可归档结果"), {
          code: "api888_image_result_missing",
        });
      void 0;
      return sendJson(res, 200, {
        data: [
          {
            url: `${stored.url}?mime=${encodeURIComponent(stored.mimeType)}`,
          },
        ],
      });
    } catch (error) {
      void 0;
      error.meterDisposition = "frozen";
      throw error;
    }
  }
  if (
    channel.provider === API888_PROVIDER &&
    target.pathname === "/v1/images/generations" &&
    !response.ok
  ) {
    let body = Buffer.alloc(0);
    try {
      if (response.body)
        body = await readBuffer(Readable.fromWeb(response.body), 64 * 1024);
    } catch {}
    const failure = providerFailureFromResponse(
      response,
      body,
      requestPayload,
      [channel.apiKey],
    );
    const payload = {
      error: failure?.message || `供应商接口返回 HTTP ${response.status}`,
      code: failure?.code || `provider_http_${response.status}`,
      providerError: failure,
    };
    return sendJson(res, response.status, payload);
  }
  const responseHeaders = proxyResponseHeaders(response);
  res.writeHead(response.status, responseHeaders);
  if (!response.ok) {
    logApiError(
      res,
      response.status,
      normalizedApiError(
        response.status,
        {
          error: `供应商接口返回 HTTP ${response.status}`,
          code: `provider_http_${response.status}`,
        },
        res.narralightRequestId,
      ),
    );
    return pipeWebResponse(response, res);
  }
  try {
    const completed = await pipeWebResponse(response, res);
  } catch (error) {
    throw error;
  }
}
function loadAgentConfig(dataRoot) {
  try {
    const managedConfig = join(dataRoot, "agent", "canvas-agent.json");
    const legacyConfig = join(
      homedir(),
      ".infinite-canvas",
      "canvas-agent.json",
    );
    const configPath = existsSync(managedConfig) ? managedConfig : legacyConfig;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (
      !isLoopback(new URL(config.url).hostname) ||
      typeof config.token !== "string" ||
      !config.token
    )
      throw new Error("invalid agent config");
    return config;
  } catch {
    throw Object.assign(new Error("Canvas Agent 尚未启动或配置不可用"), {
      status: 503,
    });
  }
}
async function readAgentProxyBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_JSON)
      throw Object.assign(new Error("Agent 请求内容过大"), {
        status: 413,
      });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function proxyAgent(req, res, url, dataRoot, options = {}) {
  const config = options.config || loadAgentConfig(dataRoot);
  const suffix = url.pathname.slice("/api/local/agent-proxy".length) || "/";
  url.searchParams.delete("token");
  const body =
    options.body === undefined ? await readAgentProxyBody(req) : options.body;
  if (
    body &&
    (suffix === "/agent/local-image" || suffix === "/agent/local-file/reveal")
  ) {
    let requestedPath = "";
    try {
      requestedPath = JSON.parse(body.toString("utf8")).path || "";
    } catch {}
    const resolvedPath = resolve(requestedPath);
    if (
      resolvedPath !== dataRoot &&
      !resolvedPath.startsWith(`${dataRoot}${sep}`)
    )
      throw Object.assign(new Error("安全策略拒绝读取数据根之外的本地路径"), {
        status: 403,
      });
  }
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      !value ||
      [
        "host",
        "origin",
        "content-length",
        "connection",
        "x-narralight-points-task-id",
      ].includes(name.toLowerCase())
    )
      continue;
    headers[name] = Array.isArray(value) ? value.join(",") : value;
  }
  headers["x-canvas-agent-token"] = config.token;
  if (body) headers["content-length"] = String(body.length);
  const target = `${config.url.replace(/\/$/, "")}${suffix}${url.search}`;
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let upstreamResponded = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const upstream = httpRequest(
      target,
      {
        method: req.method,
        headers,
      },
      (upstreamResponse) => {
        upstreamResponded = true;
        try {
          options.onResponse?.(upstreamResponse.statusCode || 502);
        } catch (error) {
          upstreamResponse.destroy();
          settle(error);
          return;
        }
        const responseHeaders = {};
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (
            value === undefined ||
            [
              "access-control-allow-origin",
              "content-encoding",
              "transfer-encoding",
              "connection",
            ].includes(name.toLowerCase())
          )
            continue;
          responseHeaders[name] = value;
        }
        res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        const closeUpstream = () => {
          upstreamResponse.destroy();
          settle();
        };
        res.once("close", closeUpstream);
        res.once("error", closeUpstream);
        upstreamResponse.once("error", (error) => {
          if (res.destroyed) settle();
          else settle(error);
        });
        upstreamResponse.once("end", () => settle());
        upstreamResponse.once("close", () => settle());
        upstreamResponse.pipe(res);
      },
    );
    upstream.once("error", (error) => {
      if (!upstreamResponded) {
        try {
          options.onError?.(error);
        } catch {}
      }
      if (res.destroyed) settle();
      else settle(error);
    });
    req.once("aborted", () => {
      if (!upstreamResponded) {
        try {
          options.onError?.(
            Object.assign(new Error("Agent 请求在响应前中断"), {
              code: "agent_request_aborted",
            }),
          );
        } catch {}
      }
      upstream.destroy();
      settle();
    });
    if (body?.length) upstream.end(body);
    else upstream.end();
  });
}
function hashFromId(db, id) {
  const value = decodeURIComponent(id);
  const raw = value.startsWith("sha256:") ? value.slice(7) : value;
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return (
    db.prepare("SELECT hash FROM object_alias WHERE alias=?").get(value)
      ?.hash || ""
  );
}
function objectPath(root, hash) {
  return join(root, "objects", hash.slice(0, 2), hash.slice(2, 4), hash);
}
function videoPlaybackMedia(hash, bytes, mimeType = "video/mp4") {
  const storageKey = `sha256:${hash}`;
  const route = mimeType === "video/mp4" ? "video-objects" : "objects";
  return {
    storageKey,
    url: `/api/local/${route}/${encodeURIComponent(storageKey)}?mime=${encodeURIComponent(mimeType)}`,
    mimeType,
    bytes,
  };
}
function originalVideoMedia(hash, bytes, mimeType = "video/mp4") {
  const storageKey = `sha256:${hash}`;
  return {
    storageKey,
    url: `/api/local/objects/${encodeURIComponent(storageKey)}?mime=${encodeURIComponent(mimeType)}`,
    mimeType,
    bytes,
  };
}
async function hashFile(path) {
  const sha = createHash("sha256");
  for await (const chunk of createReadStream(path)) sha.update(chunk);
  return sha.digest("hex");
}
function runVideoFastStartWorker(sourcePath, targetPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(
      new URL("./video-faststart-worker.mjs", import.meta.url),
      {
        workerData: {
          sourcePath,
          targetPath,
        },
      },
    );
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    worker.once("message", (message) =>
      message?.ok
        ? settle(null, message)
        : settle(
            Object.assign(new Error("视频渐进读取整理失败"), {
              code: message?.code || "video_faststart_failed",
              retryable: message?.retryable === true,
            }),
          ),
    );
    worker.once("error", () =>
      settle(
        Object.assign(new Error("视频渐进读取整理失败"), {
          code: "video_faststart_worker_failed",
          retryable: true,
        }),
      ),
    );
    worker.once("exit", (code) => {
      if (code !== 0)
        settle(
          Object.assign(new Error("视频渐进读取整理失败"), {
            code: "video_faststart_worker_exit",
            retryable: true,
          }),
        );
    });
  });
}
async function prepareBrowserVideoPreview(db, root, source, previewRunner) {
  const existing = db
    .prepare(
      "SELECT target_hash AS targetHash,mime_type AS mimeType,bytes FROM media_derivative WHERE source_hash=? AND kind='browser-mp4'",
    )
    .get(source.hash);
  if (existing?.targetHash && existsSync(objectPath(root, existing.targetHash)))
    return {
      sourceStorageKey: `sha256:${source.hash}`,
      media: videoPlaybackMedia(
        existing.targetHash,
        existing.bytes,
        existing.mimeType,
      ),
      optimized: true,
      created: false,
      derivative: "browser-mp4",
    };
  if (source.bytes > MAX_REMOTE_VIDEO_IMPORT)
    return {
      sourceStorageKey: `sha256:${source.hash}`,
      media: originalVideoMedia(source.hash, source.bytes, source.mimeType),
      optimized: false,
      created: false,
      fallbackReason: "video_preview_source_too_large",
    };
  const temp = join(root, "tmp", `preview-${randomUUID()}.mp4`);
  try {
    await previewRunner(objectPath(root, source.hash), temp);
    const bytes = statSync(temp).size;
    if (!bytes || bytes > MAX_REMOTE_VIDEO_IMPORT)
      throw Object.assign(new Error("浏览器预览视频大小无效"), {
        code: "video_preview_size_invalid",
      });
    const targetHash = await hashFile(temp);
    const target = objectPath(root, targetHash);
    await mkdir(dirname(target), {
      recursive: true,
    });
    if (existsSync(target))
      await rm(temp, {
        force: true,
      });
    else {
      try {
        renameSync(temp, target);
      } catch {
        await copyFile(temp, target);
        await rm(temp, {
          force: true,
        });
      }
    }
    db.prepare(
      "INSERT INTO media_derivative(source_hash,kind,target_hash,mime_type,bytes,created_at) VALUES(?,'browser-mp4',?,'video/mp4',?,?) ON CONFLICT(source_hash,kind) DO UPDATE SET target_hash=excluded.target_hash,mime_type=excluded.mime_type,bytes=excluded.bytes",
    ).run(source.hash, targetHash, bytes, isoNow());
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('media.browser_preview',?,?,?)",
    ).run(
      source.hash,
      JSON.stringify({
        targetHash,
        bytes,
      }),
      isoNow(),
    );
    return {
      sourceStorageKey: `sha256:${source.hash}`,
      media: videoPlaybackMedia(targetHash, bytes, "video/mp4"),
      optimized: true,
      created: true,
      derivative: "browser-mp4",
    };
  } catch (error) {
    await rm(temp, {
      force: true,
    });
    const code = /^video_preview_[a-z_]+$/.test(String(error?.code || ""))
      ? error.code
      : "video_preview_failed";
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('media.browser_preview_failed',?,?,?)",
    ).run(
      source.hash,
      JSON.stringify({
        code,
        retryable: true,
      }),
      isoNow(),
    );
    return {
      sourceStorageKey: `sha256:${source.hash}`,
      media: originalVideoMedia(source.hash, source.bytes, source.mimeType),
      optimized: false,
      created: false,
      fallbackReason: code,
      retryable: true,
    };
  }
}
async function prepareVideoPlayback(
  db,
  root,
  body,
  maxBytes = MAX_FASTSTART_VIDEO_BYTES,
  fastStartRunner = runVideoFastStartWorker,
  probeRunner = probeVideoFile,
  previewRunner = transcodeVideoPreview,
) {
  rejectUnexpectedFields(body, new Set(["storageKey", "mimeType", "bytes"]));
  const source = localVideoObject(
    root,
    body?.storageKey,
    body?.mimeType || "video/mp4",
    body?.bytes,
  );
  const sourceMedia = videoPlaybackMedia(
    source.hash,
    source.bytes,
    source.mimeType,
  );
  let probe;
  try {
    probe = await probeRunner(objectPath(root, source.hash));
  } catch {
    return prepareBrowserVideoPreview(db, root, source, previewRunner);
  }
  const requiresPreview =
    source.mimeType === "video/quicktime" ||
    ["hevc", "h265"].includes(String(probe?.codec || "")) ||
    /(?:10|12)(?:le|be)?$/.test(String(probe?.pixelFormat || ""));
  if (requiresPreview)
    return prepareBrowserVideoPreview(db, root, source, previewRunner);
  if (source.mimeType !== "video/mp4")
    return {
      sourceStorageKey: sourceMedia.storageKey,
      media: sourceMedia,
      optimized: false,
      created: false,
      fallbackReason: "faststart_mp4_only",
      retryable: true,
    };
  const existing = db
    .prepare(
      "SELECT target_hash AS targetHash,mime_type AS mimeType,bytes FROM media_derivative WHERE source_hash=? AND kind='mp4-faststart'",
    )
    .get(source.hash);
  if (existing?.targetHash && existsSync(objectPath(root, existing.targetHash)))
    return {
      sourceStorageKey: sourceMedia.storageKey,
      media: videoPlaybackMedia(
        existing.targetHash,
        existing.bytes,
        existing.mimeType,
      ),
      optimized: existing.targetHash !== source.hash,
      created: false,
    };
  if (source.bytes > maxBytes) {
    db.prepare(
      "INSERT INTO media_derivative(source_hash,kind,target_hash,mime_type,bytes,created_at) VALUES(?,'mp4-faststart',?,?,?,?) ON CONFLICT(source_hash,kind) DO NOTHING",
    ).run(source.hash, source.hash, source.mimeType, source.bytes, isoNow());
    return {
      sourceStorageKey: sourceMedia.storageKey,
      media: sourceMedia,
      optimized: false,
      created: false,
      fallbackReason: "faststart_source_too_large",
    };
  }
  const temp = join(root, "tmp", `faststart-${randomUUID()}.mp4`);
  try {
    const result = await fastStartRunner(objectPath(root, source.hash), temp);
    if (!result.changed) {
      await rm(temp, {
        force: true,
      });
      db.prepare(
        "INSERT INTO media_derivative(source_hash,kind,target_hash,mime_type,bytes,created_at) VALUES(?,'mp4-faststart',?,?,?,?) ON CONFLICT(source_hash,kind) DO NOTHING",
      ).run(source.hash, source.hash, source.mimeType, source.bytes, isoNow());
      return {
        sourceStorageKey: sourceMedia.storageKey,
        media: sourceMedia,
        optimized: false,
        created: false,
      };
    }
    const bytes = statSync(temp).size;
    if (bytes !== source.bytes)
      throw Object.assign(new Error("视频渐进读取整理结果大小不匹配"), {
        code: "video_faststart_size_changed",
      });
    const targetHash = await hashFile(temp);
    const target = objectPath(root, targetHash);
    await mkdir(dirname(target), {
      recursive: true,
    });
    if (existsSync(target))
      await rm(temp, {
        force: true,
      });
    else {
      try {
        renameSync(temp, target);
      } catch {
        await copyFile(temp, target);
        await rm(temp, {
          force: true,
        });
      }
    }
    db.prepare(
      "INSERT INTO media_derivative(source_hash,kind,target_hash,mime_type,bytes,created_at) VALUES(?,'mp4-faststart',?,?,?,?) ON CONFLICT(source_hash,kind) DO UPDATE SET target_hash=excluded.target_hash,mime_type=excluded.mime_type,bytes=excluded.bytes",
    ).run(source.hash, targetHash, source.mimeType, bytes, isoNow());
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('media.faststart',?,?,?)",
    ).run(
      source.hash,
      JSON.stringify({
        targetHash,
        bytes,
      }),
      isoNow(),
    );
    return {
      sourceStorageKey: sourceMedia.storageKey,
      media: videoPlaybackMedia(targetHash, bytes, source.mimeType),
      optimized: true,
      created: true,
    };
  } catch (error) {
    await rm(temp, {
      force: true,
    });
    const code = /^video_faststart_[a-z_]+$/.test(String(error?.code || ""))
      ? error.code
      : "video_faststart_failed";
    const retryable =
      error?.retryable === true ||
      code === "video_faststart_worker_failed" ||
      code === "video_faststart_worker_exit" ||
      code === "video_faststart_io_failed";
    if (!retryable)
      db.prepare(
        "INSERT INTO media_derivative(source_hash,kind,target_hash,mime_type,bytes,created_at) VALUES(?,'mp4-faststart',?,?,?,?) ON CONFLICT(source_hash,kind) DO NOTHING",
      ).run(source.hash, source.hash, source.mimeType, source.bytes, isoNow());
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('media.faststart_failed',?,?,?)",
    ).run(
      source.hash,
      JSON.stringify({
        code,
        retryable,
      }),
      isoNow(),
    );
    return {
      sourceStorageKey: sourceMedia.storageKey,
      media: retryable
        ? originalVideoMedia(source.hash, source.bytes, source.mimeType)
        : sourceMedia,
      optimized: false,
      created: false,
      fallbackReason: code,
      retryable,
    };
  }
}
async function receiveTemporaryObject(
  req,
  root,
  maxBytes = MAX_OBJECT,
  sizeLabel = "2 GB",
) {
  if (Number(req.headers["content-length"] || 0) > maxBytes)
    throw Object.assign(new Error(`文件超过 ${sizeLabel} 限制`), {
      status: 413,
    });
  const temp = join(root, "tmp", `upload-${randomUUID()}.part`);
  const out = createWriteStream(temp, {
    flags: "wx",
  });
  const sha = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxBytes)
        throw Object.assign(new Error(`文件超过 ${sizeLabel} 限制`), {
          status: 413,
        });
      sha.update(chunk);
      if (!out.write(chunk))
        await new Promise((done) => out.once("drain", done));
    }
    await new Promise((done, fail) =>
      out.end((error) => (error ? fail(error) : done())),
    );
    const hash = sha.digest("hex");
    return {
      temp,
      hash,
      bytes,
      mimeType: String(
        req.headers["content-type"] || "application/octet-stream",
      ),
    };
  } catch (error) {
    out.destroy();
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}
function commitTemporaryObject(staged, root, db, alias, audit = true) {
  const target = objectPath(root, staged.hash);
  mkdirSync(dirname(target), {
    recursive: true,
  });
  let created = false;
  if (existsSync(target)) unlinkSync(staged.temp);
  else {
    try {
      renameSync(staged.temp, target);
    } catch {
      copyFileSync(staged.temp, target);
      unlinkSync(staged.temp);
    }
    created = true;
  }
  if (alias)
    db.prepare(
      "INSERT INTO object_alias(alias,hash,created_at) VALUES(?,?,?) ON CONFLICT(alias) DO UPDATE SET hash=excluded.hash",
    ).run(alias, staged.hash, isoNow());
  if (audit)
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('object.put',?,?,?)",
    ).run(
      staged.hash,
      JSON.stringify({
        bytes: staged.bytes,
        alias: alias || null,
      }),
      isoNow(),
    );
  return {
    storageKey: `sha256:${staged.hash}`,
    hash: staged.hash,
    bytes: staged.bytes,
    mimeType: staged.mimeType,
    url: `/api/local/objects/sha256:${staged.hash}`,
    created,
  };
}
async function receiveObject(
  req,
  root,
  db,
  alias,
  maxBytes = MAX_OBJECT,
  sizeLabel = "2 GB",
  audit = true,
) {
  return commitTemporaryObject(
    await receiveTemporaryObject(req, root, maxBytes, sizeLabel),
    root,
    db,
    alias,
    audit,
  );
}
async function importRemoteObject(
  body,
  root,
  db,
  remoteObjectHosts,
  policy = {},
  trustedProviderKey = "",
) {
  const requestedProvider = String(body?.provider || "apimart").toLowerCase();
  const provider = [
    "apimart",
    "volcengine-ark",
    "runninghub",
    RICHBEST_CHANNEL_ID,
    API888_PROVIDER,
  ].includes(requestedProvider)
    ? requestedProvider
    : "";
  let target;
  try {
    target = new URL(String(body?.url || ""));
  } catch {
    throw Object.assign(new Error("远程对象 URL 无效"), {
      status: 400,
      code: "invalid_remote_url",
    });
  }
  const pinned888Hosts = new Map();
  const validateTarget = async (url, redirect = false) => {
    const trustedApimart =
      provider === "apimart" && remoteObjectHosts.has(url.hostname);
    const trustedVolcengine =
      provider === "volcengine-ark" &&
      (/(^|\.)(volces|volcengine)\.com$/i.test(url.hostname) ||
        (isLoopback(url.hostname) && remoteObjectHosts.has(url.hostname)));
    const trustedRunningHub =
      provider === "runninghub" &&
      (/^rh-images(?:-[a-z0-9-]+)?\.cos\.[a-z0-9-]+\.myqcloud\.com$/i.test(
        url.hostname,
      ) ||
        (isLoopback(url.hostname) && remoteObjectHosts.has(url.hostname)));
    const trustedRichBest =
      provider === RICHBEST_CHANNEL_ID &&
      ((isLoopback(url.hostname) && remoteObjectHosts.has(url.hostname)) ||
        /(^|\.)(?:volces|volcengine|aliyuncs|minimax)\.(?:com|cn)$/i.test(
          url.hostname,
        ) ||
        /(^|\.)hailuoai\.video$/i.test(url.hostname));
    const trusted888 =
      provider === API888_PROVIDER &&
      !redirect &&
      url.hostname === "888api.xin" &&
      url.pathname ===
        `/v1/videos/${encodeURIComponent(String(body?.taskId || ""))}/content` &&
      !url.search &&
      !url.username &&
      !url.password &&
      !url.hash;
    const trusted888MediaHost =
      provider === API888_PROVIDER &&
      (redirect ||
        (policy.api888TrustedImage === true && body?.mediaKind === "image")) &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      !isIP(url.hostname) &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".local");
    if (trusted888MediaHost) {
      const addresses = await (policy.lookupHost || lookup)(url.hostname, {
        all: true,
        verbatim: true,
      });
      if (
        !addresses.length ||
        addresses.some(({ address, family }) => {
          if (family !== 4) return false;
          const [a, b] = address.split(".").map(Number);
          return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 198 && (b === 18 || b === 19))
          );
        })
      )
        throw Object.assign(new Error("888API 下载跳转地址不是公网主机"), {
          status: 403,
          code: "api888_download_host_untrusted",
        });
      const publicV4 = addresses.find(
        ({ address, family }) => family === 4 && isIP(address) === 4,
      );
      if (!publicV4)
        throw Object.assign(new Error("888API 下载节点缺少可固定的公网 IPv4"), {
          status: 403,
          code: "api888_download_host_untrusted",
        });
      pinned888Hosts.set(url.hostname, publicV4);
    }
    if (
      (!trustedApimart &&
        !trustedVolcengine &&
        !trustedRunningHub &&
        !trustedRichBest &&
        !trusted888 &&
        !trusted888MediaHost) ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopback(url.hostname)))
    )
      throw Object.assign(new Error("只允许导入受信任供应商的生成结果"), {
        status: 403,
        code: "untrusted_remote_url",
      });
  };
  await validateTarget(target);
  const taskId = String(body?.taskId || "");
  const resultIndex = Number(body?.resultIndex || 0);
  const mediaKind =
    body?.mediaKind === "video"
      ? "video"
      : body?.mediaKind === undefined || body?.mediaKind === "image"
        ? "image"
        : "";
  const expiresAt =
    body?.expiresAt === undefined || body?.expiresAt === null
      ? null
      : String(body.expiresAt).slice(0, 100);
  const validTaskId = !taskId || validProviderTaskId(provider, taskId);
  if (
    !provider ||
    !mediaKind ||
    !validTaskId ||
    !Number.isSafeInteger(resultIndex) ||
    resultIndex < 0 ||
    resultIndex > 100
  )
    throw Object.assign(new Error("生成任务标识无效"), {
      status: 400,
      code: "invalid_task_identity",
    });
  if (taskId) {
    const reused = db
      .prepare(
        "SELECT media_kind AS mediaKind,hash,mime_type AS mimeType,bytes FROM remote_result WHERE provider=? AND task_id=? AND result_index=?",
      )
      .get(provider, taskId, resultIndex);
    if (reused && reused.mediaKind !== mediaKind)
      throw Object.assign(new Error("任务结果媒体类型不匹配"), {
        status: 409,
        code: "remote_media_kind_conflict",
      });
    if (reused?.hash && existsSync(objectPath(root, reused.hash)))
      return {
        storageKey: `sha256:${reused.hash}`,
        hash: reused.hash,
        bytes: reused.bytes,
        mimeType: reused.mimeType,
        url: `/api/local/objects/sha256:${reused.hash}`,
        taskId,
        resultIndex,
        reused: true,
      };
  }
  const maxBytes =
    mediaKind === "video"
      ? Number(policy.maxVideoBytes || MAX_REMOTE_VIDEO_IMPORT)
      : Number(policy.maxImageBytes || MAX_REMOTE_IMAGE_IMPORT);
  const sizeLabel = mediaKind === "video" ? "512 MB" : "64 MB";
  const timeoutMs = Number(
    policy.timeoutMs || DEFAULT_REMOTE_IMPORT_TIMEOUT_MS,
  );
  const maxAttempts = Number(policy.attempts || DEFAULT_REMOTE_IMPORT_ATTEMPTS);
  const maxRedirects = Number(
    policy.redirects ?? DEFAULT_REMOTE_IMPORT_REDIRECTS,
  );
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const downloadAgents = [];
    try {
      let current = target;
      let response;
      for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
        const authorized888Content =
          provider === API888_PROVIDER &&
          trustedProviderKey &&
          current.hostname === "888api.xin" &&
          current.pathname ===
            `/v1/videos/${encodeURIComponent(taskId)}/content`;
        const pinned = pinned888Hosts.get(current.hostname);
        const dispatcher = pinned
          ? new PinnedDownloadAgent({
              connect: {
                lookup: (_hostname, _options, callback) =>
                  callback(null, pinned.address, pinned.family),
              },
            })
          : null;
        if (dispatcher) downloadAgents.push(dispatcher);
        response = await fetchApimartRoute(
          current,
          {
            redirect: "manual",
            headers: authorized888Content
              ? {
                  authorization: `Bearer ${trustedProviderKey}`,
                }
              : undefined,
            signal: AbortSignal.timeout(timeoutMs),
            ...(dispatcher
              ? {
                  dispatcher,
                }
              : {}),
          },
          {
            dataRoot: root,
            provider,
          },
        );
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirect === maxRedirects)
          throw Object.assign(new Error("生成结果跳转过多或缺少地址"), {
            status: 502,
            code: "remote_redirect_invalid",
          });
        current = new URL(location, current);
        await validateTarget(current, provider === API888_PROVIDER);
      }
      if (!response?.ok || !response.body) {
        const status = Number(response?.status || 0);
        const retryable = [408, 425, 429, 500, 502, 503, 504].includes(status);
        throw Object.assign(
          new Error(`下载生成结果失败：HTTP ${status || "unknown"}`),
          {
            status: 502,
            code: "remote_http_error",
            retryable,
          },
        );
      }
      const contentType = String(response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const contentLength = Number(response.headers.get("content-length") || 0);
      const mimeAllowed =
        mediaKind === "video"
          ? ["video/mp4", "video/webm", "video/quicktime"].includes(contentType)
          : /^image\/(jpeg|png|webp|gif)$/.test(contentType);
      if (!mimeAllowed)
        throw Object.assign(
          new Error(
            `远程生成结果不是受支持的${mediaKind === "video" ? "视频" : "图片"}`,
          ),
          {
            status: 415,
            code: `remote_not_${mediaKind}`,
          },
        );
      if (contentLength > maxBytes)
        throw Object.assign(
          new Error(
            `远程生成${mediaKind === "video" ? "视频" : "图片"}超过 ${sizeLabel} 限制`,
          ),
          {
            status: 413,
            code: `remote_${mediaKind}_too_large`,
          },
        );
      const stream = Readable.fromWeb(response.body);
      stream.headers = {
        "content-type": contentType,
        "content-length": String(contentLength || ""),
      };
      const stored = await receiveObject(
        stream,
        root,
        db,
        "",
        maxBytes,
        sizeLabel,
      );
      if (taskId)
        db.prepare(
          "INSERT INTO remote_result(provider,task_id,result_index,media_kind,hash,mime_type,bytes,source_url_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,task_id,result_index) DO UPDATE SET media_kind=excluded.media_kind,hash=excluded.hash,mime_type=excluded.mime_type,bytes=excluded.bytes,source_url_hash=excluded.source_url_hash,expires_at=excluded.expires_at",
        ).run(
          provider,
          taskId,
          resultIndex,
          mediaKind,
          stored.hash,
          stored.mimeType,
          stored.bytes,
          createHash("sha256").update(target.toString()).digest("hex"),
          expiresAt,
          isoNow(),
        );
      return {
        ...stored,
        ...(taskId
          ? {
              taskId,
              resultIndex,
            }
          : {}),
        reused: false,
        attempts: attempt,
      };
    } catch (error) {
      const normalized =
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? Object.assign(new Error("下载生成结果超时"), {
              status: 504,
              code: "remote_timeout",
              retryable: true,
            })
          : error?.status
            ? error
            : Object.assign(new Error("下载生成结果失败：网络连接异常"), {
                status: 502,
                code: "remote_network_error",
                retryable: true,
              });
      lastError = normalized;
      if (!normalized.retryable || attempt === maxAttempts) {
        normalized.attempts = attempt;
        throw normalized;
      }
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 250 * attempt),
      );
    } finally {
      // A rejected HTTP or MIME response may still own an unread body.
      // Force-close pinned connections so archive reconciliation cannot hang.
      await Promise.all(downloadAgents.map((agent) => agent.destroy()));
    }
  }
  throw lastError;
}
const PROVIDER_ATTEMPT_SELECT =
  "SELECT a.take_id AS takeId,a.channel_id AS channelId,a.provider,a.model,a.submitted_at AS submittedAt,a.seed,a.resolution,a.ratio,a.duration,a.generate_audio AS generateAudio,a.reconcile_status AS reconcileStatus,a.attempt_count AS attemptCount,a.consecutive_error_count AS consecutiveErrorCount,a.poll_phase AS pollPhase,a.phase_attempt_count AS phaseAttemptCount,a.last_checked_at AS lastCheckedAt,a.last_successful_check_at AS lastSuccessfulCheckAt,a.last_provider_status AS lastProviderStatus,a.next_check_at AS nextCheckAt,a.last_error AS lastError,a.candidates_json AS candidatesJson,a.expires_at AS expiresAt,t.status AS takeStatus,t.task_id AS taskId,t.model AS takeModel,t.project_id AS projectId,t.node_id AS nodeId FROM provider_submission_attempt a JOIN video_generation_take t ON t.take_id=a.take_id";
function providerTaskPayload(payload) {
  if (
    payload &&
    typeof payload === "object" &&
    (payload.code === 0 || payload.code === "0") &&
    payload.data
  )
    return payload.data;
  return payload;
}
function apimartTaskRecord(payload) {
  if (!payload || typeof payload !== "object") return {};
  const data = payload.data;
  if (Array.isArray(data))
    return data[0] && typeof data[0] === "object" ? data[0] : {};
  return data && typeof data === "object" ? data : payload;
}
function appendProviderUrls(target, value, expiresAt) {
  for (const candidate of Array.isArray(value) ? value.slice(0, 20) : [value]) {
    if (
      typeof candidate === "string" &&
      /^https?:\/\//i.test(candidate) &&
      !target.has(candidate)
    )
      target.set(candidate, expiresAt);
  }
}
function apimartMediaResults(payload, mediaKind) {
  const task = apimartTaskRecord(payload);
  const result =
    task.result &&
    typeof task.result === "object" &&
    !Array.isArray(task.result)
      ? task.result
      : {};
  const collectionKey = mediaKind === "image" ? "images" : "videos";
  const urlKeys =
    mediaKind === "image" ? ["image_url", "url"] : ["video_url", "url"];
  const taskExpiresAt =
    task.expires_at ?? task.expiresAt ?? result.expires_at ?? result.expiresAt;
  const values = new Map();
  for (const container of [result, task]) {
    const containerExpiresAt =
      container.expires_at ?? container.expiresAt ?? taskExpiresAt;
    const collection = Array.isArray(container[collectionKey])
      ? container[collectionKey].slice(0, 100)
      : [];
    for (const item of collection) {
      if (typeof item === "string" || Array.isArray(item))
        appendProviderUrls(values, item, containerExpiresAt);
      else if (item && typeof item === "object") {
        const itemExpiresAt =
          item.expires_at ?? item.expiresAt ?? containerExpiresAt;
        for (const key of urlKeys)
          appendProviderUrls(values, item[key], itemExpiresAt);
      }
    }
    for (const key of urlKeys)
      appendProviderUrls(values, container[key], containerExpiresAt);
  }
  return [...values].map(([url, expiresAt], resultIndex) => ({
    url,
    resultIndex,
    expiresAt:
      typeof expiresAt === "string" || typeof expiresAt === "number"
        ? String(expiresAt).slice(0, 100)
        : undefined,
  }));
}
function providerTaskRecord(provider, payload) {
  return provider === "apimart"
    ? apimartTaskRecord(payload)
    : providerTaskPayload(payload) || {};
}
function runningHubVideoResult(payload) {
  const task = providerTaskPayload(payload) || {};
  const results = Array.isArray(task.results) ? task.results.slice(0, 100) : [];
  const resultIndex = results.findIndex((item) => {
    if (!item || typeof item !== "object") return false;
    const outputType = String(item.outputType || "").toLowerCase();
    const url = String(item.url || "");
    return (
      outputType.startsWith("video") ||
      ["mp4", "mov", "webm"].includes(outputType) ||
      /\.(?:mp4|mov|webm)(?:[?#]|$)/i.test(url)
    );
  });
  if (resultIndex < 0) return null;
  const url = results[resultIndex]?.url;
  return typeof url === "string" && /^https?:\/\//i.test(url)
    ? {
        url,
        resultIndex,
        expiresAt: new Date(
          Date.now() + RUNNINGHUB_TASK_MAX_AGE_MS,
        ).toISOString(),
      }
    : null;
}
function providerTaskUsage(task, payload, model = "") {
  // Official Grok's final amount is data.cost; usage.cost is not authoritative for this contract.
  if (isGrokOfficialModel(model || task?.model))
    return {
      cost: task?.cost,
    };
  for (const value of [
    task?.usage,
    task?.response?.usage,
    providerTaskPayload(payload)?.usage,
    providerTaskPayload(payload)?.response?.usage,
    payload?.usage,
    payload?.response?.usage,
  ]) {
    if (value && typeof value === "object" && !Array.isArray(value))
      return value;
  }
  for (const value of [task, providerTaskPayload(payload), payload]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const usage = {};
    for (const key of ["cost", "credits_cost"])
      if (value[key] !== undefined) usage[key] = value[key];
    if (Object.keys(usage).length) return usage;
  }
  return undefined;
}
function providerVideoResult(provider, payload, expectedTaskId = "") {
  if (provider === "apimart")
    return apimartMediaResults(payload, "video")[0] || null;
  if (provider === "runninghub") return runningHubVideoResult(payload);
  if (provider === API888_PROVIDER)
    return api888VideoResult(
      providerTaskRecord(provider, payload),
      expectedTaskId,
    );
  const task = providerTaskRecord(provider, payload);
  const url = providerResultUrl(task);
  return url
    ? {
        url,
        resultIndex: 0,
        expiresAt: providerResultExpiresAt(task),
      }
    : null;
}
function providerMediaResults(provider, payload, mediaKind) {
  if (provider === "apimart") return apimartMediaResults(payload, mediaKind);
  const video =
    mediaKind === "video" ? providerVideoResult(provider, payload) : null;
  return video ? [video] : [];
}
function providerTaskItems(payload) {
  const root = providerTaskPayload(payload);
  const candidates = [
    root?.items,
    root?.tasks,
    root?.list,
    root?.data?.items,
    root?.data?.tasks,
    root?.data,
  ];
  return candidates.find(Array.isArray) || [];
}
function providerTaskCreatedAt(task) {
  const value = task?.created_at ?? task?.createdAt;
  if (typeof value === "number" && Number.isFinite(value))
    return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}
function providerTaskSafeSummary(task) {
  return {
    taskId: String(task?.id || task?.task_id || "").slice(0, 200),
    status: String(task?.status || "unknown").slice(0, 40),
    createdAt: Number.isFinite(providerTaskCreatedAt(task))
      ? new Date(providerTaskCreatedAt(task)).toISOString()
      : undefined,
    model: String(task?.model || "").slice(0, 200),
  };
}
function providerTaskMatchesAttempt(task, attempt) {
  const taskId = String(task?.id || task?.task_id || "");
  if (
    !/^cgt-[a-zA-Z0-9_-]{3,180}$/.test(taskId) ||
    String(task?.model || "") !== attempt.model
  )
    return false;
  if (attempt.seed === null || attempt.seed === undefined) return false;
  const submittedAt = Date.parse(attempt.submittedAt);
  const createdAt = providerTaskCreatedAt(task);
  if (
    !Number.isFinite(submittedAt) ||
    !Number.isFinite(createdAt) ||
    createdAt < submittedAt - PROVIDER_RECONCILE_TIME_BEFORE_MS ||
    createdAt > submittedAt + PROVIDER_RECONCILE_TIME_AFTER_MS
  )
    return false;
  if (
    attempt.seed !== null &&
    attempt.seed !== undefined &&
    Number(task?.seed) !== Number(attempt.seed)
  )
    return false;
  if (
    attempt.resolution &&
    normalizeReconcileResolution(task?.resolution) !== attempt.resolution
  )
    return false;
  if (attempt.ratio && normalizeReconcileRatio(task?.ratio) !== attempt.ratio)
    return false;
  if (
    attempt.duration !== null &&
    attempt.duration !== undefined &&
    Number(task?.duration) !== Number(attempt.duration)
  )
    return false;
  if (
    attempt.generateAudio !== null &&
    attempt.generateAudio !== undefined &&
    normalizedReconcileBoolean(task?.generate_audio) !==
      Number(attempt.generateAudio)
  )
    return false;
  return true;
}
function providerResultUrl(task) {
  const content = task?.content;
  return [
    task?.video_url,
    task?.result_url,
    task?.url,
    content?.video_url,
    content?.file_url,
    content?.url,
  ].find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
}
function providerResultExpiresAt(task) {
  const value =
    task?.expires_at ??
    task?.expiresAt ??
    task?.content?.expires_at ??
    task?.content?.expiresAt;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}
function stagedDelay(schedule, attemptCount) {
  return schedule[Math.min(schedule.length - 1, Math.max(0, attemptCount - 1))];
}
function retryAfterDelayMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now()) || undefined;
}
function providerPendingDelay(startedAt) {
  const parsed = Date.parse(String(startedAt || ""));
  const elapsed = Number.isFinite(parsed)
    ? Math.max(0, Date.now() - parsed)
    : 0;
  if (elapsed < 2 * 60_000) return 60_000;
  if (elapsed < 10 * 60_000) return 30_000;
  if (elapsed < 30 * 60_000) return 60_000;
  return 2 * 60_000;
}
function providerInitialPollDelay(mediaKind) {
  return mediaKind === "video"
    ? PROVIDER_INITIAL_VIDEO_POLL_DELAY_MS
    : PROVIDER_INITIAL_POLL_DELAY_MS;
}
function providerPollSubject(provider, identity) {
  return createHash("sha256")
    .update(`${provider}:${identity}`)
    .digest("hex")
    .slice(0, 16);
}
export function providerPollFailureDiagnostics(
  errorCode,
  providerError,
  error,
) {
  const failure = normalizeProviderFailure(providerError);
  const transportCode = diagnosticNetworkCode(error);
  const safeErrorCode = safeReconcileError(
    transportCode || errorCode || "provider_query_failed",
  );
  const match = /^provider_query_http_(\d{3})$/.exec(safeErrorCode);
  const parsedStatus = match ? Number(match[1]) : undefined;
  const providerHttpStatus =
    failure?.httpStatus ??
    (parsedStatus >= 100 && parsedStatus <= 599 ? parsedStatus : undefined);
  const classificationCode =
    `${transportCode || ""}:${safeErrorCode}`.toUpperCase();
  const errorName = String(error?.name || "");
  const errorKind =
    providerHttpStatus === 429
      ? "rate_limit"
      : providerHttpStatus >= 500
        ? "http_5xx"
        : providerHttpStatus >= 400
          ? "http_4xx"
          : /(?:ERR_TLS_|CERT_|SELF_SIGNED|VERIFY_LEAF)/.test(
                classificationCode,
              )
            ? "tls"
            : /(?:TIMEOUT|TIMEDOUT|ABORT)/.test(classificationCode) ||
                errorName === "TimeoutError" ||
                errorName === "AbortError"
              ? "timeout"
              : transportCode || errorName === "TypeError"
                ? "network"
                : "provider";
  return {
    errorCode: safeErrorCode,
    errorKind,
    providerHttpStatus,
  };
}
function writeProviderPollLog(db, kind, subject, detail) {
  const event = {
    event: kind,
    at: isoNow(),
    subject,
    ...detail,
  };
  console.error(JSON.stringify(event));
  try {
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES(?,?,?,?)",
    ).run(kind, subject, JSON.stringify(detail), event.at);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "provider_poll.audit_write_failed",
        at: isoNow(),
        subject,
        code: safeReconcileError(error?.code || "audit_write_failed"),
      }),
    );
  }
}
function scheduleProviderAttempt(
  db,
  attempt,
  reconcileStatus,
  lastError,
  candidates = [],
  options = {},
) {
  const nextCount = Number(attempt.attemptCount || 0) + 1;
  const now = isoNow();
  const phase = String(
    options.phase ||
      (attempt.taskId ? "provider_pending" : "submission_reconcile"),
  );
  const phaseAttemptCount =
    attempt.pollPhase === phase
      ? Number(attempt.phaseAttemptCount || 0) + 1
      : 1;
  const consecutiveErrorCount =
    phase === "query_error"
      ? Number(attempt.consecutiveErrorCount || 0) + 1
      : 0;
  const subject = providerPollSubject(attempt.provider, attempt.takeId);
  if (Date.now() >= Date.parse(attempt.expiresAt)) {
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='expired',attempt_count=?,consecutive_error_count=?,poll_phase='expired',phase_attempt_count=1,last_checked_at=?,next_check_at=?,last_error='reconcile_window_expired',candidates_json=?,updated_at=? WHERE take_id=?",
    ).run(
      nextCount,
      consecutiveErrorCount,
      now,
      now,
      JSON.stringify(candidates),
      now,
      attempt.takeId,
    );
    db.prepare(
      "UPDATE video_generation_take SET error_code='reconcile_window_expired',updated_at=? WHERE take_id=? AND task_id IS NULL",
    ).run(now, attempt.takeId);
    writeProviderPollLog(db, "video_task.poll", subject, {
      provider: attempt.provider,
      model: attempt.model,
      phase: "expired",
      outcome: "expired",
      totalCheckCount: nextCount,
      providerSubmitted: Boolean(attempt.taskId),
      chargeExpected: false,
    });
    return;
  }
  const delayMs =
    Number.isFinite(options.retryAfterMs) && options.retryAfterMs > 0
      ? Math.min(15 * 60_000, Math.max(5_000, options.retryAfterMs))
      : phase === "query_error"
        ? stagedDelay(PROVIDER_QUERY_ERROR_BACKOFF_MS, consecutiveErrorCount)
        : phase === "result_pending"
          ? stagedDelay(PROVIDER_RESULT_PENDING_BACKOFF_MS, phaseAttemptCount)
          : phase === "archive_pending"
            ? stagedDelay(PROVIDER_ARCHIVE_BACKOFF_MS, phaseAttemptCount)
            : phase === "provider_pending"
              ? providerPendingDelay(attempt.submittedAt)
              : stagedDelay(
                  PROVIDER_SUBMISSION_RECONCILE_BACKOFF_MS,
                  phaseAttemptCount,
                );
  const nextCheckAt = new Date(Date.now() + delayMs).toISOString();
  const successfulAt = options.successful ? now : null;
  db.prepare(
    "UPDATE provider_submission_attempt SET reconcile_status=?,attempt_count=?,consecutive_error_count=?,poll_phase=?,phase_attempt_count=?,last_checked_at=?,last_successful_check_at=COALESCE(?,last_successful_check_at),last_provider_status=COALESCE(?,last_provider_status),next_check_at=?,last_error=?,candidates_json=?,updated_at=? WHERE take_id=?",
  ).run(
    reconcileStatus,
    nextCount,
    consecutiveErrorCount,
    phase,
    phaseAttemptCount,
    now,
    successfulAt,
    options.providerStatus || null,
    nextCheckAt,
    lastError ? safeReconcileError(lastError) : null,
    JSON.stringify(candidates),
    now,
    attempt.takeId,
  );
  const failureDiagnostics =
    phase === "query_error"
      ? providerPollFailureDiagnostics(
          lastError,
          options.providerError,
          options.error,
        )
      : {};
  writeProviderPollLog(
    db,
    phase === "query_error" ? "video_task.poll_error" : "video_task.poll",
    subject,
    {
      provider: attempt.provider,
      model: attempt.model,
      phase,
      outcome: options.outcome || reconcileStatus,
      providerStatus: options.providerStatus || undefined,
      ...failureDiagnostics,
      totalCheckCount: nextCount,
      consecutiveErrorCount,
      nextCheckAt,
      delayMs,
      durationMs: Number.isFinite(options.durationMs)
        ? options.durationMs
        : undefined,
      providerSubmitted: Boolean(attempt.taskId),
      chargeExpected: false,
    },
  );
}
async function fetchVolcengineTaskJson(channel, path, search = "") {
  const base = new URL(channel.baseUrl);
  const target = joinUpstreamUrl(base, path, search);
  if (
    target.protocol !== "https:" &&
    !(target.protocol === "http:" && isLoopback(target.hostname))
  )
    throw Object.assign(
      new Error("火山任务恢复只允许受信 HTTPS 或测试回环地址"),
      {
        code: "provider_reconcile_target_invalid",
      },
    );
  assertVolcengineCredentialFormat(channel.apiKey);
  const response = await fetch(target, {
    method: "GET",
    headers: {
      authorization: `Bearer ${channel.apiKey}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  let payload = {};
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {}
  if (!response.ok)
    throw Object.assign(
      new Error(`火山任务恢复查询失败：HTTP ${response.status}`),
      {
        code: `provider_query_http_${response.status}`,
        providerError: providerFailureFromResponse(response, body),
      },
    );
  return payload;
}
async function fetchManagedTask(channel, provider, taskId, dataRoot) {
  if (!validProviderTaskId(provider, taskId))
    throw Object.assign(new Error("供应商任务 ID 无效"), {
      status: 400,
      code: "provider_task_id_invalid",
    });
  const path =
    provider === "apimart"
      ? `/tasks/${encodeURIComponent(taskId)}`
      : provider === "runninghub"
        ? "/query"
        : provider === RICHBEST_CHANNEL_ID || provider === API888_PROVIDER
          ? `/v1/videos/${encodeURIComponent(taskId)}`
          : `/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  const target = joinUpstreamUrl(new URL(channel.baseUrl), path, "");
  if (
    target.protocol !== "https:" &&
    !(target.protocol === "http:" && isLoopback(target.hostname))
  )
    throw Object.assign(
      new Error("供应商任务查询只允许受信 HTTPS 或测试回环地址"),
      {
        code: "provider_query_target_invalid",
      },
    );
  if (provider === "volcengine-ark")
    assertVolcengineCredentialFormat(channel.apiKey);
  const response = await fetchApimartRoute(
    target,
    {
      method: provider === "runninghub" ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${channel.apiKey}`,
        accept: "application/json",
        ...(provider === "runninghub"
          ? {
              "content-type": "application/json",
            }
          : {}),
      },
      body:
        provider === "runninghub"
          ? JSON.stringify({
              taskId,
            })
          : undefined,
      signal: AbortSignal.timeout(15_000),
    },
    {
      dataRoot,
      provider,
    },
  );
  const body = Buffer.from(await response.arrayBuffer());
  let payload = {};
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {}
  if (!response.ok) {
    const providerError = providerFailureFromResponse(response, body);
    const retryAfterMs =
      response.status === 429
        ? retryAfterDelayMs(response.headers.get("retry-after"))
        : undefined;
    throw Object.assign(
      new Error(`供应商任务查询失败：HTTP ${response.status}`),
      {
        code: `provider_query_http_${response.status}`,
        providerError,
        ...(retryAfterMs
          ? {
              retryAfterMs,
            }
          : {}),
      },
    );
  }
  return payload;
}
async function fetchVolcengineTaskList(channel, attempt) {
  const items = [];
  const submittedAt = Date.parse(attempt.submittedAt);
  const oldestNeeded = submittedAt - PROVIDER_RECONCILE_TIME_BEFORE_MS;
  const pageSize = 100;
  for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
    const search = `?page_num=${pageNum}&page_size=${pageSize}&filter.model=${encodeURIComponent(attempt.model)}`;
    const payload = await fetchVolcengineTaskJson(
      channel,
      "/contents/generations/tasks",
      search,
    );
    const pageItems = providerTaskItems(payload);
    items.push(...pageItems);
    const total = Number(
      providerTaskPayload(payload)?.total ?? payload?.total ?? 0,
    );
    const pageTimes = pageItems
      .map(providerTaskCreatedAt)
      .filter(Number.isFinite);
    const oldestOnPage = pageTimes.length ? Math.min(...pageTimes) : NaN;
    if (
      pageItems.length < pageSize ||
      (total > 0 && items.length >= total) ||
      (Number.isFinite(oldestOnPage) && oldestOnPage < oldestNeeded)
    )
      break;
  }
  return items;
}
function setProviderTaskState(
  db,
  attempt,
  status,
  errorCode = null,
  providerError,
) {
  const taskStatus =
    status === "cancelled"
      ? "cancelled"
      : status === "failed"
        ? "failed"
        : status;
  const failure = normalizeProviderFailure(providerError);
  upsertGenerationTask(
    db,
    {
      provider: attempt.provider,
      taskId: attempt.taskId,
    },
    {
      mediaKind: "video",
      model: attempt.takeModel || attempt.model,
      channelId: attempt.channelId,
      projectId: attempt.projectId,
      nodeId: attempt.nodeId,
      status: taskStatus,
      errorCode,
      providerError: failure,
    },
  );
  updateVideoTake(db, "", attempt.takeId, {
    status: status === "cancelled" ? "failed" : status,
    provider: attempt.provider,
    taskId: attempt.taskId,
    errorCode,
  });
  if (failure)
    db.prepare(
      "UPDATE video_generation_take SET provider_http_status=?,provider_error_code=?,provider_error_message=?,provider_request_id=?,updated_at=? WHERE take_id=?",
    ).run(
      failure.httpStatus ?? null,
      failure.code ?? null,
      failure.message ?? null,
      failure.requestId ?? null,
      isoNow(),
      attempt.takeId,
    );
}
async function monitorProviderTask(
  db,
  dataRoot,
  attempt,
  channel,
  remoteObjectHosts,
  remoteImportPolicy,
  relayManager,
) {
  const checkedAt = Date.now();
  const payload = await fetchManagedTask(
    channel,
    attempt.provider,
    attempt.taskId,
    dataRoot,
  );
  const task = providerTaskRecord(attempt.provider, payload);
  const usage = providerTaskUsage(task, payload, attempt.model);
  let status;
  try {
    status =
      attempt.provider === "runninghub"
        ? runningHubTaskStatus(task.status).toLowerCase()
        : String(task.status || "").toLowerCase();
  } catch (error) {
    stopSeedanceTakeRelays(relayManager, attempt.takeId);
    const now = isoNow();
    setProviderTaskState(
      db,
      attempt,
      "submission_unknown",
      error?.code || "runninghub_task_status_invalid",
    );
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='status_invalid',attempt_count=attempt_count+1,last_error=?,next_check_at=?,updated_at=? WHERE take_id=?",
    ).run(
      error?.code || "runninghub_task_status_invalid",
      now,
      now,
      attempt.takeId,
    );
    return;
  }
  const now = isoNow();
  const official =
    attempt.provider === "apimart" && isGrokOfficialModel(attempt.model);
  if (
    official
      ? status === "failed"
      : ["failed", "error", "cancelled", "canceled", "expired"].includes(status)
  ) {
    stopSeedanceTakeRelays(relayManager, attempt.takeId);
    const normalizedStatus =
      status === "cancelled" || status === "canceled" ? "cancelled" : "failed";
    const providerError = providerFailureFromTask(task);
    setProviderTaskState(
      db,
      attempt,
      normalizedStatus,
      `provider_task_${status}`,
      providerError,
    );
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='failed',attempt_count=attempt_count+1,consecutive_error_count=0,poll_phase='terminal',phase_attempt_count=1,last_checked_at=?,last_successful_check_at=?,last_provider_status=?,last_error=?,next_check_at=?,updated_at=? WHERE take_id=?",
    ).run(
      now,
      now,
      status || null,
      `provider_task_${status}`,
      now,
      now,
      attempt.takeId,
    );
    writeProviderPollLog(
      db,
      "video_task.poll",
      providerPollSubject(attempt.provider, attempt.takeId),
      {
        provider: attempt.provider,
        model: attempt.model,
        phase: "terminal",
        outcome: normalizedStatus,
        providerStatus: status || undefined,
        durationMs: Date.now() - checkedAt,
        providerSubmitted: true,
        chargeExpected: false,
      },
    );
    return;
  }
  if (official && status !== "completed") {
    setProviderTaskState(db, attempt, "pending");
    scheduleProviderAttempt(db, attempt, "monitoring", null, [], {
      phase: "provider_pending",
      successful: true,
      providerStatus: status || "unknown",
      outcome: "pending",
      durationMs: Date.now() - checkedAt,
    });
    return;
  }
  const result = providerVideoResult(attempt.provider, payload, attempt.taskId);
  const succeeded =
    ["succeeded", "completed"].includes(status) ||
    (attempt.provider === API888_PROVIDER && status === "success");
  if (result || succeeded) stopSeedanceTakeRelays(relayManager, attempt.takeId);
  if (!result) {
    const pendingStatus = succeeded ? "result_pending" : "pending";
    setProviderTaskState(db, attempt, pendingStatus);
    scheduleProviderAttempt(
      db,
      attempt,
      "monitoring",
      pendingStatus === "result_pending" ? "provider_result_not_ready" : null,
      [],
      {
        phase:
          pendingStatus === "result_pending"
            ? "result_pending"
            : "provider_pending",
        successful: true,
        providerStatus: status || "unknown",
        outcome: pendingStatus,
        durationMs: Date.now() - checkedAt,
      },
    );
    return;
  }
  try {
    const stored = await importRemoteObject(
      {
        url: result.url,
        provider: attempt.provider,
        taskId: attempt.taskId,
        resultIndex: result.resultIndex,
        mediaKind: "video",
        expiresAt: result.expiresAt,
      },
      dataRoot,
      db,
      remoteObjectHosts,
      remoteImportPolicy,
      attempt.provider === API888_PROVIDER ? channel.apiKey : "",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      upsertGenerationTask(
        db,
        {
          provider: attempt.provider,
          taskId: attempt.taskId,
        },
        {
          mediaKind: "video",
          model: attempt.takeModel || attempt.model,
          channelId: attempt.channelId,
          projectId: attempt.projectId,
          nodeId: attempt.nodeId,
          status: "completed",
          resultIndex: result.resultIndex,
        },
      );
      updateVideoTake(db, dataRoot, attempt.takeId, {
        status: "completed",
        provider: attempt.provider,
        taskId: attempt.taskId,
        resultIndex: result.resultIndex,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        durationMs:
          Number(attempt.duration) > 0
            ? Number(attempt.duration) * 1000
            : undefined,
      });
      db.prepare(
        "UPDATE provider_submission_attempt SET reconcile_status='archived',attempt_count=attempt_count+1,consecutive_error_count=0,poll_phase='archived',phase_attempt_count=1,last_checked_at=?,last_successful_check_at=?,last_provider_status=?,last_error=NULL,candidates_json='[]',next_check_at=?,updated_at=? WHERE take_id=?",
      ).run(now, now, status || null, now, now, attempt.takeId);
      db.prepare(
        "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.auto_archived',?,?,?)",
      ).run(
        attempt.takeId,
        JSON.stringify({
          provider: attempt.provider,
          taskId: attempt.taskId,
          resultIndex: result.resultIndex,
          bytes: stored.bytes,
        }),
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    writeProviderPollLog(
      db,
      "video_task.completed",
      providerPollSubject(attempt.provider, attempt.takeId),
      {
        provider: attempt.provider,
        model: attempt.model,
        phase: "archived",
        outcome: "completed",
        providerStatus: status || undefined,
        durationMs: Date.now() - checkedAt,
        resultPresent: true,
        providerSubmitted: true,
        chargeExpected: false,
      },
    );
  } catch (error) {
    setProviderTaskState(db, attempt, "result_pending", "archive_pending");
    scheduleProviderAttempt(
      db,
      attempt,
      "archive_pending",
      error?.code || "archive_failed",
      [],
      {
        phase: "archive_pending",
        successful: true,
        providerStatus: status || "completed",
        outcome: "archive_pending",
        durationMs: Date.now() - checkedAt,
      },
    );
  }
}
async function reconcileProviderAttempt(
  db,
  dataRoot,
  attempt,
  credentialResolver,
  credentialHosts,
  remoteObjectHosts,
  remoteImportPolicy,
  relayManager,
  providerEndpointPolicy = {},
) {
  if (
    !attempt.taskId &&
    attempt.provider === "apimart" &&
    isGrokOfficialModel(attempt.model)
  ) {
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='official_idempotency_pending',next_check_at=?,last_error='grok_official_original_key_requires_provider_verification',updated_at=? WHERE take_id=?",
    ).run(isoNow(), isoNow(), attempt.takeId);
    return;
  }
  if (Date.now() >= Date.parse(attempt.expiresAt))
    return scheduleProviderAttempt(
      db,
      attempt,
      "expired",
      "reconcile_window_expired",
    );
  if (
    !attempt.taskId &&
    (attempt.provider !== "volcengine-ark" ||
      attempt.seed === null ||
      attempt.seed === undefined)
  ) {
    const now = isoNow();
    const reason =
      attempt.provider === "volcengine-ark"
        ? "legacy_request_missing_correlation_seed"
        : "provider_task_id_missing_no_safe_list_match";
    db.prepare(
      "UPDATE provider_submission_attempt SET reconcile_status='legacy_untracked',next_check_at=?,last_error=?,candidates_json='[]',updated_at=? WHERE take_id=?",
    ).run(now, reason, now, attempt.takeId);
    return;
  }
  const channel = readAiChannel(
    db,
    attempt.channelId,
    credentialResolver,
    credentialHosts,
    providerEndpointPolicy,
  );
  if (
    channel.provider !== attempt.provider ||
    !MANAGED_VIDEO_PROVIDERS.has(channel.provider)
  )
    throw Object.assign(new Error("任务恢复渠道与原供应商不一致"), {
      code: "provider_reconcile_channel_changed",
    });
  if (attempt.taskId)
    return monitorProviderTask(
      db,
      dataRoot,
      attempt,
      channel,
      remoteObjectHosts,
      remoteImportPolicy,
      relayManager,
    );
  const candidates = (await fetchVolcengineTaskList(channel, attempt)).filter(
    (task) => providerTaskMatchesAttempt(task, attempt),
  );
  const safeCandidates = candidates.map(providerTaskSafeSummary);
  if (candidates.length !== 1) {
    scheduleProviderAttempt(
      db,
      attempt,
      candidates.length ? "candidates" : "no_match",
      candidates.length ? "multiple_strong_candidates" : "no_strong_candidate",
      safeCandidates,
      {
        phase: "submission_reconcile",
        successful: true,
        outcome: candidates.length ? "multiple_candidates" : "no_match",
      },
    );
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.reconcile_scan',?,?,?)",
    ).run(
      attempt.takeId,
      JSON.stringify({
        candidateCount: candidates.length,
        attempt: Number(attempt.attemptCount || 0) + 1,
      }),
      isoNow(),
    );
    return;
  }
  const taskId = safeCandidates[0].taskId;
  const currentAttempt = db
    .prepare(`${PROVIDER_ATTEMPT_SELECT} WHERE a.take_id=?`)
    .get(attempt.takeId);
  if (currentAttempt?.taskId)
    return monitorProviderTask(
      db,
      dataRoot,
      currentAttempt,
      channel,
      remoteObjectHosts,
      remoteImportPolicy,
      relayManager,
    );
  persistSubmittedVideoTask(
    db,
    attempt.takeId,
    attempt.provider,
    taskId,
    attempt.channelId,
  );
  db.prepare(
    "UPDATE provider_submission_attempt SET candidates_json=?,last_error=NULL,updated_at=? WHERE take_id=?",
  ).run(JSON.stringify(safeCandidates), isoNow(), attempt.takeId);
  const matched = db
    .prepare(`${PROVIDER_ATTEMPT_SELECT} WHERE a.take_id=?`)
    .get(attempt.takeId);
  await monitorProviderTask(
    db,
    dataRoot,
    matched,
    channel,
    remoteObjectHosts,
    remoteImportPolicy,
    relayManager,
  );
}
function scheduleStandaloneGenerationTask(
  db,
  task,
  errorCode,
  providerError,
  options = {},
) {
  const nextCount = Number(task.pollAttemptCount || 0) + 1;
  const now = isoNow();
  const phase = String(
    options.phase || (errorCode ? "query_error" : "provider_pending"),
  );
  const phaseAttemptCount =
    task.pollPhase === phase ? Number(task.phaseAttemptCount || 0) + 1 : 1;
  const consecutiveErrorCount =
    phase === "query_error" ? Number(task.consecutiveErrorCount || 0) + 1 : 0;
  const delayMs =
    Number.isFinite(options.retryAfterMs) && options.retryAfterMs > 0
      ? Math.min(15 * 60_000, Math.max(5_000, options.retryAfterMs))
      : phase === "query_error"
        ? stagedDelay(PROVIDER_QUERY_ERROR_BACKOFF_MS, consecutiveErrorCount)
        : phase === "result_pending"
          ? stagedDelay(PROVIDER_RESULT_PENDING_BACKOFF_MS, phaseAttemptCount)
          : phase === "archive_pending"
            ? stagedDelay(PROVIDER_ARCHIVE_BACKOFF_MS, phaseAttemptCount)
            : providerPendingDelay(task.createdAt);
  const nextPollAt = new Date(Date.now() + delayMs).toISOString();
  const failure = normalizeProviderFailure(providerError);
  db.prepare(
    "UPDATE generation_task SET poll_attempt_count=?,consecutive_error_count=?,poll_phase=?,phase_attempt_count=?,last_checked_at=?,last_successful_check_at=COALESCE(?,last_successful_check_at),last_provider_status=COALESCE(?,last_provider_status),next_poll_at=?,error_code=?,provider_http_status=COALESCE(?,provider_http_status),provider_error_code=COALESCE(?,provider_error_code),provider_error_message=COALESCE(?,provider_error_message),provider_request_id=COALESCE(?,provider_request_id),updated_at=? WHERE provider=? AND task_id=?",
  ).run(
    nextCount,
    consecutiveErrorCount,
    phase,
    phaseAttemptCount,
    now,
    options.successful ? now : null,
    options.providerStatus || null,
    nextPollAt,
    errorCode ? safeReconcileError(errorCode) : null,
    failure?.httpStatus ?? null,
    failure?.code ?? null,
    failure?.message ?? null,
    failure?.requestId ?? null,
    now,
    task.provider,
    task.taskId,
  );
  if (options.successful)
    db.prepare(
      "UPDATE generation_task SET provider_http_status=NULL,provider_error_code=NULL,provider_error_message=NULL,provider_request_id=NULL WHERE provider=? AND task_id=?",
    ).run(task.provider, task.taskId);
  const failureDiagnostics =
    phase === "query_error"
      ? providerPollFailureDiagnostics(errorCode, providerError, options.error)
      : {};
  writeProviderPollLog(
    db,
    phase === "query_error"
      ? "generation_task.poll_error"
      : "generation_task.poll",
    providerPollSubject(task.provider, task.taskId),
    {
      provider: task.provider,
      model: task.model,
      mediaKind: task.mediaKind,
      phase,
      outcome: options.outcome || task.status,
      providerStatus: options.providerStatus || undefined,
      ...failureDiagnostics,
      totalCheckCount: nextCount,
      consecutiveErrorCount,
      nextCheckAt: nextPollAt,
      delayMs,
      durationMs: Number.isFinite(options.durationMs)
        ? options.durationMs
        : undefined,
      providerSubmitted: true,
      chargeExpected: false,
    },
  );
}
async function monitorStandaloneGenerationTask(
  db,
  dataRoot,
  task,
  credentialResolver,
  credentialHosts,
  remoteObjectHosts,
  remoteImportPolicy,
  providerEndpointPolicy = {},
) {
  const checkedAt = Date.now();
  const channelId =
    task.channelId ||
    (String(task.model).includes("::")
      ? String(task.model).split("::", 1)[0]
      : task.provider === "apimart"
        ? "apimart"
        : task.provider === "runninghub"
          ? "runninghub"
          : "volcengine-ark-gx");
  const channel = readAiChannel(
    db,
    channelId,
    credentialResolver,
    credentialHosts,
    providerEndpointPolicy,
  );
  if (
    channel.provider !== task.provider ||
    !MANAGED_STANDALONE_MEDIA.has(`${channel.provider}:${task.mediaKind}`)
  )
    throw Object.assign(new Error("后台任务渠道、媒体类型与原供应商不一致"), {
      code: "provider_task_channel_changed",
    });
  const payload = await fetchManagedTask(
    channel,
    task.provider,
    task.taskId,
    dataRoot,
  );
  const providerTask = providerTaskRecord(task.provider, payload);
  const usage = providerTaskUsage(providerTask, payload, task.model);
  let status;
  try {
    status =
      task.provider === "runninghub"
        ? runningHubTaskStatus(providerTask.status).toLowerCase()
        : String(providerTask.status || "").toLowerCase();
  } catch (error) {
    upsertGenerationTask(
      db,
      {
        provider: task.provider,
        taskId: task.taskId,
      },
      {
        mediaKind: "video",
        model: task.model,
        channelId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        status: "failed",
        errorCode: error?.code || "runninghub_task_status_invalid",
      },
    );
    return;
  }
  const official =
    task.provider === "apimart" && isGrokOfficialModel(task.model);
  if (
    official
      ? status === "failed"
      : ["failed", "error", "cancelled", "canceled", "expired"].includes(status)
  ) {
    const cancelled = status === "cancelled" || status === "canceled";
    upsertGenerationTask(
      db,
      {
        provider: task.provider,
        taskId: task.taskId,
      },
      {
        mediaKind: task.mediaKind,
        model: task.model,
        channelId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        status: cancelled ? "cancelled" : "failed",
        errorCode: `provider_task_${status}`,
        providerError: providerFailureFromTask(providerTask),
      },
    );
    writeProviderPollLog(
      db,
      "generation_task.poll",
      providerPollSubject(task.provider, task.taskId),
      {
        provider: task.provider,
        model: task.model,
        mediaKind: task.mediaKind,
        phase: "terminal",
        outcome: cancelled ? "cancelled" : "failed",
        providerStatus: status,
        durationMs: Date.now() - checkedAt,
        providerSubmitted: true,
        chargeExpected: false,
      },
    );
    return;
  }
  const results =
    official && status !== "completed"
      ? []
      : providerMediaResults(task.provider, payload, task.mediaKind);
  if (!results.length) {
    const finalizing = official
      ? status === "completed"
      : ["success", "succeeded", "completed"].includes(status);
    upsertGenerationTask(
      db,
      {
        provider: task.provider,
        taskId: task.taskId,
      },
      {
        mediaKind: task.mediaKind,
        model: task.model,
        channelId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        status: finalizing ? "result_pending" : "pending",
        errorCode: finalizing ? "provider_result_not_ready" : undefined,
      },
    );
    const refreshed = db
      .prepare(`${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`)
      .get(task.provider, task.taskId);
    scheduleStandaloneGenerationTask(
      db,
      refreshed,
      finalizing ? "provider_result_not_ready" : null,
      undefined,
      {
        phase: finalizing ? "result_pending" : "provider_pending",
        successful: true,
        providerStatus: status || "unknown",
        outcome: finalizing ? "result_pending" : "pending",
        durationMs: Date.now() - checkedAt,
      },
    );
    return;
  }
  try {
    const storedResults = [];
    for (const result of results) {
      const stored = await importRemoteObject(
        {
          url: result.url,
          provider: task.provider,
          taskId: task.taskId,
          resultIndex: result.resultIndex,
          mediaKind: task.mediaKind,
          expiresAt: result.expiresAt,
        },
        dataRoot,
        db,
        remoteObjectHosts,
        remoteImportPolicy,
      );
      storedResults.push({
        resultIndex: result.resultIndex,
        bytes: stored.bytes,
      });
    }
    const primary = results[0];
    upsertGenerationTask(
      db,
      {
        provider: task.provider,
        taskId: task.taskId,
      },
      {
        mediaKind: task.mediaKind,
        model: task.model,
        channelId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        status: "completed",
        resultIndex: primary.resultIndex,
      },
    );
    db.prepare(
      "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('generation_task.auto_archived',?,?,?)",
    ).run(
      `${task.provider}:${task.taskId}`,
      JSON.stringify({
        mediaKind: task.mediaKind,
        resultCount: storedResults.length,
        bytes: storedResults.reduce((sum, item) => sum + item.bytes, 0),
      }),
      isoNow(),
    );
    writeProviderPollLog(
      db,
      "generation_task.completed",
      providerPollSubject(task.provider, task.taskId),
      {
        provider: task.provider,
        model: task.model,
        mediaKind: task.mediaKind,
        phase: "archived",
        outcome: "completed",
        providerStatus: status || undefined,
        durationMs: Date.now() - checkedAt,
        resultPresent: true,
        providerSubmitted: true,
        chargeExpected: false,
      },
    );
  } catch (error) {
    upsertGenerationTask(
      db,
      {
        provider: task.provider,
        taskId: task.taskId,
      },
      {
        mediaKind: task.mediaKind,
        model: task.model,
        channelId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        status: "result_pending",
        errorCode: "archive_pending",
      },
    );
    const refreshed = db
      .prepare(`${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`)
      .get(task.provider, task.taskId);
    scheduleStandaloneGenerationTask(
      db,
      refreshed,
      error?.code || "archive_failed",
      undefined,
      {
        phase: "archive_pending",
        successful: true,
        providerStatus: status || "completed",
        outcome: "archive_pending",
        durationMs: Date.now() - checkedAt,
      },
    );
  }
}
async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from(
    {
      length: Math.min(concurrency, items.length),
    },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}
async function reconcileStandaloneGenerationTasks(
  db,
  dataRoot,
  credentialResolver,
  credentialHosts,
  remoteObjectHosts,
  remoteImportPolicy,
  providerEndpointPolicy = {},
) {
  const due = db
    .prepare(
      `${GENERATION_TASK_SELECT} WHERE g.imported_history=0 AND ((g.provider IN ('apimart','volcengine-ark','runninghub','richbest','888api') AND g.media_kind='video') OR (g.provider='apimart' AND g.media_kind='image')) AND g.status IN ('pending','result_pending') AND COALESCE(g.next_poll_at,g.updated_at)<=? AND NOT EXISTS(SELECT 1 FROM video_generation_take t WHERE t.provider=g.provider AND t.task_id=g.task_id) ORDER BY COALESCE(g.next_poll_at,g.updated_at) ASC LIMIT ${PROVIDER_RECONCILE_BATCH_SIZE}`,
    )
    .all(isoNow());
  await mapConcurrent(due, PROVIDER_RECONCILE_CONCURRENCY, async (task) => {
    const checkedAt = Date.now();
    try {
      await monitorStandaloneGenerationTask(
        db,
        dataRoot,
        task,
        credentialResolver,
        credentialHosts,
        remoteObjectHosts,
        remoteImportPolicy,
        providerEndpointPolicy,
      );
    } catch (error) {
      scheduleStandaloneGenerationTask(
        db,
        task,
        diagnosticNetworkCode(error) || error?.code || "provider_query_failed",
        error?.providerError,
        {
          phase: "query_error",
          retryAfterMs: error?.retryAfterMs,
          outcome: "query_failed",
          durationMs: Date.now() - checkedAt,
          error,
        },
      );
    }
  });
  return {
    checked: due.length,
  };
}
async function reconcileProviderAttempts(
  db,
  dataRoot,
  credentialResolver,
  credentialHosts,
  remoteObjectHosts,
  remoteImportPolicy,
  relayManager,
  providerEndpointPolicy = {},
  runAttempt,
) {
  const due = db
    .prepare(
      `${PROVIDER_ATTEMPT_SELECT} WHERE a.reconcile_status IN ('pending','no_match','candidates','monitoring','archive_pending','submitting') AND a.next_check_at<=? ORDER BY a.next_check_at ASC LIMIT ${PROVIDER_RECONCILE_BATCH_SIZE}`,
    )
    .all(isoNow());
  const worker =
    runAttempt ||
    (async (attempt) => {
      const checkedAt = Date.now();
      try {
        await reconcileProviderAttempt(
          db,
          dataRoot,
          attempt,
          credentialResolver,
          credentialHosts,
          remoteObjectHosts,
          remoteImportPolicy,
          relayManager,
          providerEndpointPolicy,
        );
      } catch (error) {
        scheduleProviderAttempt(
          db,
          attempt,
          attempt.taskId ? "monitoring" : "pending",
          diagnosticNetworkCode(error) ||
            error?.code ||
            "provider_reconcile_failed",
          [],
          {
            phase: "query_error",
            retryAfterMs: error?.retryAfterMs,
            outcome: "query_failed",
            durationMs: Date.now() - checkedAt,
            providerError: error?.providerError,
            error,
          },
        );
      }
    });
  await mapConcurrent(due, PROVIDER_RECONCILE_CONCURRENCY, worker);
  const standalone = await reconcileStandaloneGenerationTasks(
    db,
    dataRoot,
    credentialResolver,
    credentialHosts,
    remoteObjectHosts,
    remoteImportPolicy,
    providerEndpointPolicy,
  );
  return {
    checked: due.length + standalone.checked,
  };
}
const GENERATION_TASK_STATUSES = new Set([
  "created",
  "pending",
  "result_pending",
  "submission_unknown",
  "completed",
  "failed",
  "cancelled",
]);
const GENERATION_MEDIA_KINDS = new Set(["image", "video", "audio"]);
const GENERATION_PROVIDERS = new Set([
  "apimart",
  "openai",
  "gemini",
  "seedance",
  "volcengine-ark",
  "runninghub",
  "richbest",
  API888_PROVIDER,
  LOCAL_H3_PROVIDER,
  "plugin",
]);
const VIDEO_TAKE_STATUSES = new Set([
  "created",
  "submitting",
  "submission_unknown",
  "pending",
  "result_pending",
  "completed",
  "failed",
]);
const VIDEO_TAKE_PARAMETER_KEYS = new Set([
  "duration",
  "resolution",
  "aspectRatio",
  "generateAudio",
  "watermark",
  "referenceMode",
  "outputFormat",
]);
const VIDEO_TAKE_CREATE_FIELDS = new Set([
  "projectId",
  "nodeId",
  "prompt",
  "parameters",
  "model",
]);
const VIDEO_TAKE_UPDATE_FIELDS = new Set([
  "status",
  "provider",
  "taskId",
  "model",
  "resultIndex",
  "errorCode",
  "storageKey",
  "mimeType",
  "bytes",
  "durationMs",
]);
const VIDEO_TAKE_REFERENCE_MODES = new Set([
  "text_to_video",
  "omni",
  "video_edit",
  "video_extend",
  "first_frame",
  "last_frame",
  "first_last_frame",
  "multi_image",
  "motion_transfer",
  "draft",
]);
const APIMART_VIDEO_TAKE_REFERENCE_MODES = new Set([
  "omni",
  "video_edit",
  "first_last_frame",
  "multi_image",
  "motion_transfer",
]);
const APIMART_25_VIDEO_TAKE_REFERENCE_MODES = new Set([
  "text_to_video",
  "omni",
  "video_edit",
  "video_extend",
  "first_frame",
  "first_last_frame",
  "multi_image",
  "motion_transfer",
]);
const RUNNINGHUB_VIDEO_TAKE_REFERENCE_MODES = new Set([
  "text_to_video",
  "omni",
  "video_edit",
  "video_extend",
  "multi_image",
  "motion_transfer",
]);
const VIDEO_TAKE_RATIOS = new Set([
  "16:9",
  "9:16",
  "1:1",
  "21:9",
  "3:4",
  "4:3",
  "adaptive",
]);
const SEEDANCE_TAKE_MODELS = new Map([
  [
    "doubao-seedance-2.5",
    {
      resolutions: new Set(["480p", "720p", "1080p"]),
      referenceModes: APIMART_25_VIDEO_TAKE_REFERENCE_MODES,
      minDuration: 4,
      maxDuration: 30,
      family: "2.5",
      smartEdit: true,
      outputFormats: new Set(["mp4", "mov"]),
    },
  ],
  [
    "seedance-2.5",
    {
      resolutions: new Set(["480p", "720p", "1080p"]),
      referenceModes: APIMART_25_VIDEO_TAKE_REFERENCE_MODES,
      minDuration: 4,
      maxDuration: 30,
      family: "2.5",
      smartEdit: true,
      outputFormats: new Set(["mp4", "mov"]),
    },
  ],
  [
    RUNNINGHUB_SEEDANCE_25_MODEL_ID,
    {
      resolutions: RUNNINGHUB_RESOLUTIONS,
      referenceModes: RUNNINGHUB_VIDEO_TAKE_REFERENCE_MODES,
      minDuration: 4,
      maxDuration: 30,
      family: "2.5",
      smartEdit: true,
      outputFormats: new Set(["mp4"]),
    },
  ],
  [
    "doubao-seedance-2.0",
    {
      resolutions: new Set(["480p", "720p", "1080p", "4k"]),
      referenceModes: APIMART_VIDEO_TAKE_REFERENCE_MODES,
      minDuration: 4,
      maxDuration: 15,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2.0-fast",
    {
      resolutions: new Set(["480p", "720p"]),
      referenceModes: APIMART_VIDEO_TAKE_REFERENCE_MODES,
      minDuration: 4,
      maxDuration: 15,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2.0-mini",
    {
      resolutions: new Set(["480p", "720p"]),
      referenceModes: APIMART_VIDEO_TAKE_REFERENCE_MODES,
      minDuration: 4,
      maxDuration: 15,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2-5-260628",
    {
      resolutions: new Set(["480p", "720p", "1080p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      minDuration: 4,
      maxDuration: 30,
      family: "2.5",
      smartEdit: true,
      outputFormats: new Set(["mp4", "mov"]),
    },
  ],
  [
    "doubao-seedance-2-0-260128",
    {
      resolutions: new Set(["480p", "720p", "1080p", "4k"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      minDuration: 4,
      maxDuration: 15,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2-0-fast-260128",
    {
      resolutions: new Set(["480p", "720p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      minDuration: 4,
      maxDuration: 15,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-2-0-mini-260615",
    {
      resolutions: new Set(["480p", "720p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_20,
      minDuration: 4,
      maxDuration: 15,
      family: "2.0",
    },
  ],
  [
    "doubao-seedance-1-5-pro-251215",
    {
      resolutions: new Set(["480p", "720p", "1080p"]),
      referenceModes: VOLCENGINE_REFERENCE_MODES_15,
      minDuration: 4,
      maxDuration: 12,
      family: "1.5",
    },
  ],
]);
function generationTaskIdentity(pathname) {
  const match = /^\/api\/local\/generation-tasks\/([^/]+)\/([^/]+)$/.exec(
    pathname,
  );
  if (!match) return null;
  const provider = decodeURIComponent(match[1]).toLowerCase();
  const taskId = decodeURIComponent(match[2]);
  if (
    !GENERATION_PROVIDERS.has(provider) ||
    !validProviderTaskId(provider, taskId)
  )
    throw Object.assign(new Error("生成任务标识无效"), {
      status: 400,
      code: "invalid_task_identity",
    });
  return {
    provider,
    taskId,
  };
}
function generationTaskRow(row) {
  if (!row) return null;
  const providerError = normalizeProviderFailure({
    httpStatus: row.providerHttpStatus,
    code: row.providerErrorCode,
    message: row.providerErrorMessage,
    requestId: row.providerRequestId,
  });
  return {
    provider: row.provider,
    taskId: row.taskId,
    mediaKind: row.mediaKind,
    model: row.model,
    channelId: row.channelId || undefined,
    projectId: row.projectId || undefined,
    nodeId: row.nodeId || undefined,
    status: row.status,
    resultIndex: row.resultIndex ?? undefined,
    errorCode: row.errorCode || undefined,
    importedHistory: Boolean(row.importedHistory),
    readOnly: Boolean(row.importedHistory),
    ...(providerError
      ? {
          providerError,
        }
      : {}),
    ...(row.nextPollAt || row.lastCheckedAt
      ? {
          polling: {
            totalCheckCount: Number(row.pollAttemptCount || 0),
            consecutiveErrorCount: Number(row.consecutiveErrorCount || 0),
            phase: row.pollPhase || undefined,
            lastCheckedAt: row.lastCheckedAt || undefined,
            lastSuccessfulCheckAt: row.lastSuccessfulCheckAt || undefined,
            lastProviderStatus: row.lastProviderStatus || undefined,
            nextCheckAt: row.nextPollAt || undefined,
          },
        }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.hash
      ? {
          archivedResult: {
            storageKey: `sha256:${row.hash}`,
            url: `/api/local/objects/sha256:${row.hash}?mime=${encodeURIComponent(row.archivedMimeType || "application/octet-stream")}`,
            mimeType: row.archivedMimeType,
            bytes: row.archivedBytes,
          },
        }
      : {}),
  };
}
const GENERATION_TASK_SELECT =
  "SELECT g.provider,g.task_id AS taskId,g.media_kind AS mediaKind,g.model,g.channel_id AS channelId,g.project_id AS projectId,g.node_id AS nodeId,g.status,g.result_index AS resultIndex,g.error_code AS errorCode,g.provider_http_status AS providerHttpStatus,g.provider_error_code AS providerErrorCode,g.provider_error_message AS providerErrorMessage,g.provider_request_id AS providerRequestId,g.poll_attempt_count AS pollAttemptCount,g.consecutive_error_count AS consecutiveErrorCount,g.poll_phase AS pollPhase,g.phase_attempt_count AS phaseAttemptCount,g.last_checked_at AS lastCheckedAt,g.last_successful_check_at AS lastSuccessfulCheckAt,g.last_provider_status AS lastProviderStatus,g.next_poll_at AS nextPollAt,g.imported_history AS importedHistory,g.created_at AS createdAt,g.updated_at AS updatedAt,r.hash,r.mime_type AS archivedMimeType,r.bytes AS archivedBytes FROM generation_task g LEFT JOIN remote_result r ON r.provider=g.provider AND r.task_id=g.task_id AND r.result_index=COALESCE(g.result_index,0)";
function upsertGenerationTask(db, identity, body) {
  if (
    ["prompt", "url", "remoteUrl", "apiKey", "token"].some((key) =>
      Object.prototype.hasOwnProperty.call(body || {}, key),
    )
  )
    throw Object.assign(new Error("生成任务记录不得包含提示词、地址或凭据"), {
      status: 400,
      code: "sensitive_task_field",
    });
  const mediaKind = String(body?.mediaKind || "");
  const model = String(body?.model || "").slice(0, 200);
  const channelId =
    safeProviderIdentifier(
      body?.channelId ||
        (model.includes("::")
          ? model.split("::", 1)[0]
          : identity.provider === "apimart"
            ? "apimart"
            : identity.provider === "runninghub"
              ? "runninghub"
              : identity.provider === "volcengine-ark"
                ? "volcengine-ark-gx"
                : identity.provider === RICHBEST_CHANNEL_ID
                  ? RICHBEST_CHANNEL_ID
                  : ""),
      100,
    ) || null;
  const projectId = body?.projectId
    ? String(body.projectId).slice(0, 200)
    : null;
  const nodeId = body?.nodeId ? String(body.nodeId).slice(0, 200) : null;
  const status = String(body?.status || "pending");
  const resultIndex =
    body?.resultIndex === undefined || body?.resultIndex === null
      ? null
      : Number(body.resultIndex);
  const errorCode = body?.errorCode
    ? String(body.errorCode)
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
        .slice(0, 100)
    : null;
  const providerError = normalizeProviderFailure(body?.providerError);
  if (
    !GENERATION_MEDIA_KINDS.has(mediaKind) ||
    !model ||
    !GENERATION_TASK_STATUSES.has(status) ||
    (resultIndex !== null &&
      (!Number.isSafeInteger(resultIndex) ||
        resultIndex < 0 ||
        resultIndex > 100))
  )
    throw Object.assign(new Error("生成任务状态无效"), {
      status: 400,
      code: "invalid_task_state",
    });
  const existing = db
    .prepare(
      "SELECT created_at AS createdAt,imported_history AS importedHistory FROM generation_task WHERE provider=? AND task_id=?",
    )
    .get(identity.provider, identity.taskId);
  if (existing?.importedHistory)
    throw Object.assign(new Error("迁入的生成历史为只读记录"), {
      status: 409,
      code: "imported_history_read_only",
    });
  const now = isoNow();
  const nextPollAt =
    MANAGED_STANDALONE_MEDIA.has(`${identity.provider}:${mediaKind}`) &&
    ["pending", "result_pending"].includes(status)
      ? new Date(Date.now() + providerInitialPollDelay(mediaKind)).toISOString()
      : null;
  db.prepare(
    "INSERT INTO generation_task(provider,task_id,media_kind,model,channel_id,project_id,node_id,status,result_index,error_code,provider_http_status,provider_error_code,provider_error_message,provider_request_id,poll_attempt_count,next_poll_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?) ON CONFLICT(provider,task_id) DO UPDATE SET media_kind=excluded.media_kind,model=excluded.model,channel_id=COALESCE(excluded.channel_id,generation_task.channel_id),project_id=COALESCE(excluded.project_id,generation_task.project_id),node_id=COALESCE(excluded.node_id,generation_task.node_id),status=excluded.status,result_index=excluded.result_index,error_code=excluded.error_code,provider_http_status=CASE WHEN excluded.status='completed' THEN NULL ELSE COALESCE(excluded.provider_http_status,generation_task.provider_http_status) END,provider_error_code=CASE WHEN excluded.status='completed' THEN NULL ELSE COALESCE(excluded.provider_error_code,generation_task.provider_error_code) END,provider_error_message=CASE WHEN excluded.status='completed' THEN NULL ELSE COALESCE(excluded.provider_error_message,generation_task.provider_error_message) END,provider_request_id=CASE WHEN excluded.status='completed' THEN NULL ELSE COALESCE(excluded.provider_request_id,generation_task.provider_request_id) END,next_poll_at=CASE WHEN excluded.status IN ('pending','result_pending') THEN COALESCE(generation_task.next_poll_at,excluded.next_poll_at) ELSE NULL END,updated_at=excluded.updated_at",
  ).run(
    identity.provider,
    identity.taskId,
    mediaKind,
    model,
    channelId,
    projectId,
    nodeId,
    status,
    resultIndex,
    errorCode,
    providerError?.httpStatus ?? null,
    providerError?.code ?? null,
    providerError?.message ?? null,
    providerError?.requestId ?? null,
    nextPollAt,
    existing?.createdAt || now,
    now,
  );
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('generation_task.state',?,?,?)",
  ).run(
    `${identity.provider}:${identity.taskId}`,
    JSON.stringify({
      mediaKind,
      status,
      resultIndex,
      errorCode,
      ...(providerError
        ? {
            providerError,
          }
        : {}),
    }),
    now,
  );
  return generationTaskRow(
    db
      .prepare(`${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`)
      .get(identity.provider, identity.taskId),
  );
}
function videoTakeIdentity(pathname) {
  const match = /^\/api\/local\/video-generation-takes\/([^/]+)$/.exec(
    pathname,
  );
  if (!match) return null;
  const takeId = decodeURIComponent(match[1]);
  if (!/^take_[a-zA-Z0-9-]{8,100}$/.test(takeId))
    throw Object.assign(new Error("视频版本标识无效"), {
      status: 400,
      code: "invalid_video_take_id",
    });
  return takeId;
}
function videoTakeOwner(body) {
  const projectId = String(body?.projectId || "");
  const nodeId = String(body?.nodeId || "");
  if (
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(projectId) ||
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(nodeId)
  )
    throw Object.assign(new Error("视频节点归属无效"), {
      status: 400,
      code: "invalid_video_take_owner",
    });
  return {
    projectId,
    nodeId,
  };
}
function rejectUnexpectedFields(body, allowed) {
  const unexpected = Object.keys(body || {}).filter((key) => !allowed.has(key));
  if (unexpected.length)
    throw videoTakeValidationError(
      "video_take_field_unsupported",
      "视频版本包含未允许字段",
      {
        field: unexpected[0],
        actual: unexpected,
        allowed: [...allowed],
      },
    );
}
function videoTakeValidationError(code, message, details) {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    details,
  });
}
function sanitizeTakePrompt(value) {
  const sanitized = String(value || "")
    .slice(0, 16000)
    .replace(/https?:\/\/\S+\?\S+/gi, "[signed-url-redacted]")
    .replace(/\bfile:\/\/\S+/gi, "[absolute-path-redacted]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{12,}/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[secret-redacted]")
    .replace(
      /\b(api[_-]?key|token|signature|authorization)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    );
  return redactTakePercentEncodedAbsolutePaths(
    redactTakeAbsolutePaths(sanitized),
  );
}
function containsAbsolutePathSyntax(value) {
  return /(?:^|[\s("'`=,:;\[{<])(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(value);
}
function redactTakeAbsolutePaths(value) {
  return value
    .replace(
      /(["'`])(?:\/|[a-zA-Z]:[\\/]|\\\\)[^"'`\r\n]*\1/g,
      (_match, quote) => `${quote}[absolute-path-redacted]${quote}`,
    )
    .replace(
      /(^|[\s("'`=,;\[{<])(?:\/|[a-zA-Z]:[\\/]|\\\\)[^\s"'`\]}>;,]*/g,
      "$1[absolute-path-redacted]",
    );
}
const TAKE_PROMPT_PERCENT_DECODE_LIMIT = 3;
const ENCODED_FORWARD_SLASH_PATTERN = "%(?:25)*2f";
const ENCODED_BACKSLASH_PATTERN = "%(?:25)*5c";
const ENCODED_COLON_PATTERN = "%(?:25)*3a";
const ENCODED_ABSOLUTE_PATH_PATTERN = new RegExp(
  "(?:^|[\\s(\"'\\x60=,:;\\[{<])(?:" +
    ENCODED_FORWARD_SLASH_PATTERN +
    "|[a-z]" +
    ENCODED_COLON_PATTERN +
    "(?:" +
    ENCODED_FORWARD_SLASH_PATTERN +
    "|" +
    ENCODED_BACKSLASH_PATTERN +
    ")|" +
    ENCODED_BACKSLASH_PATTERN +
    ENCODED_BACKSLASH_PATTERN +
    ")",
  "i",
);
function containsPercentEncodedAbsolutePathSyntax(segment) {
  let candidate = segment;
  for (let depth = 0; depth < TAKE_PROMPT_PERCENT_DECODE_LIMIT; depth += 1) {
    if (depth > 0 && containsAbsolutePathSyntax(candidate)) return true;
    if (!/%[0-9a-f]{2}/i.test(candidate)) return false;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return ENCODED_ABSOLUTE_PATH_PATTERN.test(candidate);
    }
  }
  return (
    containsAbsolutePathSyntax(candidate) ||
    ENCODED_ABSOLUTE_PATH_PATTERN.test(candidate)
  );
}
function redactTakePercentEncodedAbsolutePaths(value) {
  return value.replace(/\S+/g, (segment) =>
    containsPercentEncodedAbsolutePathSyntax(segment)
      ? "[absolute-path-redacted]"
      : segment,
  );
}
function rejectSensitiveTakeString(value) {
  if (
    /\b(?:https?|file|data):\/\//i.test(value) ||
    /(?:^|[?&\s])(?:x-amz-(?:signature|credential)|token|access_token|signature|authorization|api[_-]?key)\s*=/i.test(
      value,
    ) ||
    /\bBearer\s+\S+/i.test(value) ||
    /\bsk-[a-zA-Z0-9_-]{8,}\b/i.test(value) ||
    containsAbsolutePathSyntax(value)
  )
    throw Object.assign(new Error("视频版本字符串包含敏感或路径内容"), {
      status: 400,
      code: "sensitive_video_take_value",
    });
}
function videoTakeModel(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string")
    throw Object.assign(new Error("视频版本模型无效"), {
      status: 400,
      code: "invalid_video_take_model",
    });
  const model = value.trim();
  rejectSensitiveTakeString(model);
  if (!/^[a-zA-Z0-9_.:@\/-]{1,200}$/.test(model))
    throw Object.assign(new Error("视频版本模型无效"), {
      status: 400,
      code: "invalid_video_take_model",
    });
  return model;
}
function requiredVideoTakeModel(value) {
  const model = videoTakeModel(value);
  if (!model)
    throw Object.assign(new Error("旧视频版本模型无效"), {
      status: 400,
      code: "invalid_video_take_model",
    });
  return model;
}
function videoTakeParameterString(value, field) {
  if (typeof value !== "string")
    throw videoTakeValidationError(
      "video_parameter_type_invalid",
      "视频版本参数值类型无效",
      {
        field,
        actual: typeof value,
        allowed: "string",
      },
    );
  const normalized = value.trim().toLowerCase();
  rejectSensitiveTakeString(normalized);
  if (!normalized || normalized.length > 64)
    throw videoTakeValidationError(
      "video_parameter_value_invalid",
      "视频版本参数值无效",
      {
        field,
        actual: normalized ? `${normalized.length} characters` : "empty",
        allowed: "1-64 characters",
      },
    );
  return normalized;
}
function videoTakeResolution(value, modelName, grok = false) {
  const token = videoTakeParameterString(value, "resolution");
  const aliases = {
    low: "480p",
    auto: "720p",
    medium: "720p",
    high: "720p",
    480: "480p",
    720: "720p",
    1080: "1080p",
  };
  const normalized = aliases[token] || token;
  if (grok) {
    if (!["480p", "720p"].includes(normalized))
      throw videoTakeValidationError(
        "video_resolution_unsupported",
        "Grok 1.5 视频分辨率只能是 480p 或 720p",
        {
          field: "resolution",
          actual: normalized,
          allowed: ["480p", "720p"],
        },
      );
    return normalized;
  }
  const seedanceProfile = SEEDANCE_TAKE_MODELS.get(modelName);
  if (seedanceProfile) {
    if (!seedanceProfile.resolutions.has(normalized))
      throw videoTakeValidationError(
        "video_resolution_unsupported",
        "视频版本分辨率不受当前模型支持",
        {
          field: "resolution",
          actual: normalized,
          allowed: [...seedanceProfile.resolutions],
        },
      );
    return normalized;
  }
  if (normalized === "4k") return normalized;
  const match = /^(\d{1,4})p?$/.exec(normalized);
  const pixels = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > 8192)
    throw videoTakeValidationError(
      "video_resolution_invalid",
      "视频版本分辨率无效",
      {
        field: "resolution",
        actual: normalized,
        allowed: "1-8192p or 4k",
      },
    );
  return String(pixels);
}
function videoTakeAspectRatio(value, isSeedance, grok = false) {
  const token = videoTakeParameterString(value, "aspectRatio");
  const normalized = token === "auto" ? "adaptive" : token;
  if (grok) {
    const allowed = ["16:9", "9:16", "1:1", "3:2", "2:3"];
    if (!allowed.includes(normalized))
      throw videoTakeValidationError(
        "video_aspect_ratio_unsupported",
        "Grok 1.5 视频不支持当前宽高比",
        {
          field: "aspectRatio",
          actual: normalized,
          allowed,
        },
      );
    return normalized;
  }
  if (VIDEO_TAKE_RATIOS.has(normalized)) return normalized;
  if (isSeedance)
    throw videoTakeValidationError(
      "video_aspect_ratio_unsupported",
      "视频版本比例不受当前模型支持",
      {
        field: "aspectRatio",
        actual: normalized,
        allowed: [...VIDEO_TAKE_RATIOS],
      },
    );
  const ratioMatch = /^(\d{1,3}):(\d{1,3})$/.exec(normalized);
  const ratioWidth = ratioMatch ? Number(ratioMatch[1]) : 0;
  const ratioHeight = ratioMatch ? Number(ratioMatch[2]) : 0;
  if (
    ratioWidth >= 1 &&
    ratioWidth <= 100 &&
    ratioHeight >= 1 &&
    ratioHeight <= 100
  )
    return `${ratioWidth}:${ratioHeight}`;
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(normalized);
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    width > 8192 ||
    height < 1 ||
    height > 8192
  )
    throw videoTakeValidationError(
      "video_aspect_ratio_invalid",
      "视频版本比例无效",
      {
        field: "aspectRatio",
        actual: normalized,
        allowed: "W:H or WIDTHxHEIGHT",
      },
    );
  return `${width}x${height}`;
}
function videoTakeParameters(value, model) {
  const modelName = String(model || "")
    .split("::")
    .pop()
    .toLowerCase();
  if (value === undefined) {
    if (modelName === LOCAL_H3_MODEL)
      throw videoTakeValidationError(
        "local_h3_profile_fixed",
        "本地 H3 必须使用固定生成规格",
        {
          field: "parameters",
        },
      );
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw videoTakeValidationError(
      "video_parameters_invalid",
      "视频版本参数无效",
      {
        field: "parameters",
        actual: Array.isArray(value) ? "array" : typeof value,
        allowed: "object",
      },
    );
  if (String(model || "").startsWith(`${API888_CHANNEL_ID}::`)) {
    if (
      Object.keys(value).some(
        (key) => !["duration", "aspectRatio"].includes(key),
      )
    )
      throw videoTakeValidationError(
        "video_parameter_field_unsupported",
        "888API 视频版本只支持时长和比例",
      );
    const candidate = {
      model: modelName,
      prompt: "parameter validation",
      ...(modelName === "wan3.0-video"
        ? {
            seconds: value.duration,
          }
        : {
            duration: value.duration,
          }),
      ratio: value.aspectRatio,
    };
    validate888ApiRequest(candidate, "video.generate");
    return {
      duration: value.duration,
      aspectRatio: value.aspectRatio,
    };
  }
  if (modelName === LOCAL_H3_MODEL) {
    try {
      return normalizeLocalH3Parameters(value);
    } catch (error) {
      throw videoTakeValidationError(
        error?.code || "local_h3_profile_invalid",
        error?.message || "本地 H3 生成规格无效",
        error?.details,
      );
    }
  }
  const seedanceProfile = SEEDANCE_TAKE_MODELS.get(modelName);
  const isSeedance = Boolean(seedanceProfile);
  const grok = isApimartGrokVideo(modelName);
  if (isGrokOfficialModel(modelName)) {
    const edit = isGrokOfficialEditModel(modelName);
    const allowed = edit
      ? ["referenceMode"]
      : ["duration", "resolution", "aspectRatio", "referenceMode"];
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw videoTakeValidationError(
        "video_parameter_field_unsupported",
        "Grok 官方当前模式不支持所选参数",
        {
          allowed,
        },
      );
    const mode = value.referenceMode || (edit ? "video_edit" : "text_to_video");
    if (
      !(edit ? ["video_edit"] : ["text_to_video", "multi_image"]).includes(mode)
    )
      throw videoTakeValidationError(
        "video_reference_mode_unsupported",
        "Grok 官方当前模型不支持所选模式",
        {
          allowed,
        },
      );
    if (edit)
      return {
        referenceMode: mode,
      };
    const payload = {
      model: grokOfficialRequestModel(modelName),
      prompt: "parameter validation",
      duration: value.duration ?? 8,
      resolution: value.resolution ?? "480p",
      aspect_ratio: value.aspectRatio ?? "auto",
    };
    validateGrokOfficialPayload(payload);
    return {
      referenceMode: mode,
      duration: payload.duration,
      resolution: payload.resolution,
      aspectRatio: payload.aspect_ratio,
    };
  }
  const runningHubGrok = runningHubGrokContractFor(modelName);
  if (runningHubGrok) {
    const fieldsByWorkflow = {
      text_to_video: ["duration", "resolution", "aspectRatio", "referenceMode"],
      first_frame: ["duration", "resolution", "referenceMode"],
      multi_image: ["duration", "resolution", "aspectRatio", "referenceMode"],
      video_edit: ["resolution", "referenceMode"],
      video_extend: ["duration", "referenceMode"],
    };
    const allowed = fieldsByWorkflow[runningHubGrok.workflow];
    const unsupported = Object.keys(value).find(
      (key) => !allowed.includes(key),
    );
    if (unsupported)
      throw videoTakeValidationError(
        "video_parameter_field_unsupported",
        "RunningHub Grok 视频版本包含当前工作流未允许字段",
        {
          field: unsupported,
          actual: unsupported,
          allowed,
        },
      );
    const missing = allowed.find(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    );
    if (missing)
      throw videoTakeValidationError(
        "video_parameter_field_required",
        "RunningHub Grok 视频版本缺少当前工作流必需字段",
        {
          field: missing,
          actual: "missing",
          allowed,
        },
      );
    const referenceMode = videoTakeParameterString(
      value.referenceMode,
      "referenceMode",
    );
    if (referenceMode !== runningHubGrok.workflow)
      throw videoTakeValidationError(
        "video_reference_mode_unsupported",
        "RunningHub Grok 视频版本工作流与模型不一致",
        {
          field: "referenceMode",
          actual: referenceMode,
          allowed: [runningHubGrok.workflow],
        },
      );
    const output = {
      referenceMode,
    };
    if (Object.prototype.hasOwnProperty.call(value, "duration")) {
      const duration = value.duration;
      const valid = runningHubGrok.durationValues
        ? runningHubGrok.durationValues.includes(duration)
        : Number.isSafeInteger(duration) &&
          duration >= runningHubGrok.duration[0] &&
          duration <= runningHubGrok.duration[1];
      if (!valid)
        throw videoTakeValidationError(
          "video_duration_out_of_range",
          "RunningHub Grok 视频版本时长不受当前工作流支持",
          {
            field: "duration",
            actual: duration,
            allowed:
              runningHubGrok.durationValues ||
              `${runningHubGrok.duration[0]}-${runningHubGrok.duration[1]} seconds integer`,
          },
        );
      output.duration = duration;
    }
    if (Object.prototype.hasOwnProperty.call(value, "resolution")) {
      const resolution = videoTakeParameterString(
        value.resolution,
        "resolution",
      );
      if (!runningHubGrok.resolutions.includes(resolution))
        throw videoTakeValidationError(
          "video_resolution_unsupported",
          "RunningHub Grok 视频版本分辨率不受当前工作流支持",
          {
            field: "resolution",
            actual: resolution,
            allowed: runningHubGrok.resolutions,
          },
        );
      output.resolution = resolution;
    }
    if (Object.prototype.hasOwnProperty.call(value, "aspectRatio")) {
      const ratio = videoTakeParameterString(value.aspectRatio, "aspectRatio");
      if (!["16:9", "1:1", "9:16", "3:2", "2:3"].includes(ratio))
        throw videoTakeValidationError(
          "video_aspect_ratio_unsupported",
          "RunningHub Grok 视频版本比例不受当前工作流支持",
          {
            field: "aspectRatio",
            actual: ratio,
            allowed: ["16:9", "1:1", "9:16", "3:2", "2:3"],
          },
        );
      output.aspectRatio = ratio;
    }
    return output;
  }
  if (grok) {
    const unsupported = Object.keys(value).find(
      (key) => !["duration", "resolution", "aspectRatio"].includes(key),
    );
    if (unsupported)
      throw videoTakeValidationError(
        "video_parameter_field_unsupported",
        "Grok 1.5 视频版本只保存时长、分辨率和比例",
        {
          field: unsupported,
          actual: unsupported,
          allowed: ["duration", "resolution", "aspectRatio"],
        },
      );
  }
  const output = {};
  let referenceMode;
  if (Object.prototype.hasOwnProperty.call(value, "referenceMode")) {
    referenceMode = videoTakeParameterString(
      value.referenceMode,
      "referenceMode",
    );
    const allowed =
      seedanceProfile?.referenceModes || VIDEO_TAKE_REFERENCE_MODES;
    if (!allowed.has(referenceMode))
      throw videoTakeValidationError(
        "video_reference_mode_unsupported",
        "视频版本参考方式不受当前模型支持",
        {
          field: "referenceMode",
          actual: referenceMode,
          allowed: [...allowed],
        },
      );
    output.referenceMode = referenceMode;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!VIDEO_TAKE_PARAMETER_KEYS.has(key))
      throw videoTakeValidationError(
        "video_parameter_field_unsupported",
        "视频版本参数包含未允许字段",
        {
          field: key,
          actual: key,
          allowed: [...VIDEO_TAKE_PARAMETER_KEYS],
        },
      );
    if (key === "referenceMode") continue;
    if (key === "duration") {
      const min = grok ? 6 : seedanceProfile?.minDuration || 1;
      const max = grok ? 15 : seedanceProfile?.maxDuration || 20;
      const smartEdit =
        seedanceProfile?.smartEdit === true &&
        referenceMode === "video_edit" &&
        item === -1;
      if (
        typeof item !== "number" ||
        !Number.isSafeInteger(item) ||
        (!smartEdit && (item < min || item > max))
      )
        throw videoTakeValidationError(
          "video_duration_out_of_range",
          "视频版本时长不受当前模型或模式支持",
          {
            field: "duration",
            actual: item,
            allowed:
              seedanceProfile?.smartEdit === true &&
              referenceMode === "video_edit"
                ? [-1, `${min}-${max}`]
                : `${min}-${max} seconds integer`,
          },
        );
      output[key] = item;
    } else if (key === "resolution")
      output[key] = videoTakeResolution(item, modelName, grok);
    else if (key === "aspectRatio")
      output[key] = videoTakeAspectRatio(item, isSeedance, grok);
    else if (key === "generateAudio" || key === "watermark") {
      if (typeof item !== "boolean")
        throw videoTakeValidationError(
          "video_boolean_parameter_invalid",
          "视频版本布尔参数类型无效",
          {
            field: key,
            actual: typeof item,
            allowed: "boolean",
          },
        );
      output[key] = item;
    } else if (key === "outputFormat") {
      const format = videoTakeParameterString(item, "outputFormat");
      if (!seedanceProfile?.outputFormats?.has(format))
        throw videoTakeValidationError(
          "video_output_format_unsupported",
          "视频版本输出格式不受当前模型支持",
          {
            field: "outputFormat",
            actual: format,
            allowed: [...(seedanceProfile?.outputFormats || [])],
          },
        );
      output[key] = format;
    }
  }
  return output;
}
function videoTakeRow(row) {
  if (!row) return null;
  const mimeType = row.mimeType || "video/mp4";
  let candidates = [];
  try {
    candidates = JSON.parse(row.reconcileCandidates || "[]");
  } catch {}
  const providerError = normalizeProviderFailure({
    httpStatus: row.providerHttpStatus,
    code: row.providerErrorCode,
    message: row.providerErrorMessage,
    requestId: row.providerRequestId,
  });
  return {
    takeId: row.takeId,
    projectId: row.projectId,
    nodeId: row.nodeId,
    status: row.status,
    provider: row.provider || undefined,
    taskId: row.taskId || undefined,
    model: row.model || undefined,
    prompt: row.prompt,
    parameters: JSON.parse(row.paramsJson || "{}"),
    resultIndex: row.resultIndex ?? undefined,
    errorCode: row.errorCode || undefined,
    importedHistory: Boolean(row.importedHistory),
    readOnly: Boolean(row.importedHistory),
    ...(providerError
      ? {
          providerError,
        }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.reconcileStatus
      ? {
          reconciliation: {
            status: row.reconcileStatus,
            attemptCount: Number(row.reconcileAttemptCount || 0),
            consecutiveErrorCount: Number(
              row.reconcileConsecutiveErrorCount || 0,
            ),
            phase: row.reconcilePollPhase || undefined,
            lastCheckedAt: row.reconcileLastCheckedAt || undefined,
            lastSuccessfulCheckAt:
              row.reconcileLastSuccessfulCheckAt || undefined,
            lastProviderStatus: row.reconcileLastProviderStatus || undefined,
            nextCheckAt: row.reconcileNextCheckAt || undefined,
            lastError: row.reconcileLastError || undefined,
            expiresAt: row.reconcileExpiresAt || undefined,
            candidates: Array.isArray(candidates) ? candidates : [],
          },
        }
      : {}),
    ...(row.hash
      ? {
          media: {
            storageKey: `sha256:${row.hash}`,
            url: `/api/local/objects/sha256:${row.hash}?mime=${encodeURIComponent(mimeType)}`,
            mimeType,
            bytes: row.bytes,
            durationMs: row.durationMs ?? undefined,
          },
        }
      : {}),
  };
}
const VIDEO_TAKE_SELECT =
  "SELECT take_id AS takeId,project_id AS projectId,node_id AS nodeId,status,provider,task_id AS taskId,model,prompt,params_json AS paramsJson,hash,mime_type AS mimeType,bytes,duration_ms AS durationMs,result_index AS resultIndex,error_code AS errorCode,provider_http_status AS providerHttpStatus,provider_error_code AS providerErrorCode,provider_error_message AS providerErrorMessage,provider_request_id AS providerRequestId,imported_history AS importedHistory,created_at AS createdAt,updated_at AS updatedAt,(SELECT reconcile_status FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileStatus,(SELECT attempt_count FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileAttemptCount,(SELECT consecutive_error_count FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileConsecutiveErrorCount,(SELECT poll_phase FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcilePollPhase,(SELECT last_checked_at FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileLastCheckedAt,(SELECT last_successful_check_at FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileLastSuccessfulCheckAt,(SELECT last_provider_status FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileLastProviderStatus,(SELECT next_check_at FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileNextCheckAt,(SELECT last_error FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileLastError,(SELECT expires_at FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileExpiresAt,(SELECT candidates_json FROM provider_submission_attempt a WHERE a.take_id=video_generation_take.take_id) AS reconcileCandidates FROM video_generation_take";
function createVideoTake(db, body) {
  rejectUnexpectedFields(body, VIDEO_TAKE_CREATE_FIELDS);
  const { projectId, nodeId } = videoTakeOwner(body);
  const model = videoTakeModel(body?.model);
  const takeId = `take_${randomUUID()}`;
  const now = isoNow();
  db.prepare(
    "INSERT INTO video_generation_take(take_id,project_id,node_id,status,model,prompt,params_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    takeId,
    projectId,
    nodeId,
    "created",
    model,
    sanitizeTakePrompt(body?.prompt),
    JSON.stringify(videoTakeParameters(body?.parameters, model)),
    now,
    now,
  );
  db.prepare(
    "INSERT INTO video_node_history(project_id,node_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id,node_id) DO NOTHING",
  ).run(projectId, nodeId, now, now);
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.create',?,?,?)",
  ).run(
    takeId,
    JSON.stringify({
      projectId,
      nodeId,
      status: "created",
    }),
    now,
  );
  return videoTakeRow(
    db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId),
  );
}
function localVideoObject(root, storageKey, mimeType, bytes) {
  const match = /^sha256:([a-f0-9]{64})$/.exec(String(storageKey || ""));
  const safeMime = String(mimeType || "").toLowerCase();
  if (
    !match ||
    !["video/mp4", "video/webm", "video/quicktime"].includes(safeMime)
  )
    throw Object.assign(new Error("视频版本必须引用受支持的本地对象"), {
      status: 400,
      code: "invalid_video_take_media",
    });
  const file = objectPath(root, match[1]);
  if (!existsSync(file))
    throw Object.assign(new Error("视频版本引用的本地对象不存在"), {
      status: 409,
      code: "video_take_object_missing",
    });
  const actualBytes = statSync(file).size;
  if (bytes !== undefined && bytes !== null && Number(bytes) !== actualBytes)
    throw Object.assign(new Error("视频版本对象大小不匹配"), {
      status: 409,
      code: "video_take_size_mismatch",
    });
  return {
    hash: match[1],
    mimeType: safeMime,
    bytes: actualBytes,
  };
}
function updateVideoTake(db, root, takeId, body) {
  rejectUnexpectedFields(body, VIDEO_TAKE_UPDATE_FIELDS);
  const current = db
    .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
    .get(takeId);
  if (!current)
    throw Object.assign(new Error("视频版本不存在"), {
      status: 404,
      code: "video_take_not_found",
    });
  if (current.status === "completed")
    throw Object.assign(new Error("已完成的视频版本不可覆盖"), {
      status: 409,
      code: "video_take_final",
    });
  const status = String(body?.status || current.status);
  if (!VIDEO_TAKE_STATUSES.has(status))
    throw Object.assign(new Error("视频版本状态无效"), {
      status: 400,
      code: "invalid_video_take_status",
    });
  const provider =
    body?.provider === undefined
      ? current.provider
      : String(body.provider).toLowerCase();
  const taskId =
    body?.taskId === undefined ? current.taskId : String(body.taskId);
  const model =
    body?.model === undefined ? current.model : videoTakeModel(body.model);
  const resultIndex =
    body?.resultIndex === undefined || body?.resultIndex === null
      ? current.resultIndex
      : Number(body.resultIndex);
  const errorCode = body?.errorCode
    ? String(body.errorCode)
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
        .slice(0, 100)
    : null;
  if (
    (provider && !GENERATION_PROVIDERS.has(provider)) ||
    (taskId && (!provider || !validProviderTaskId(provider, taskId))) ||
    (resultIndex !== null &&
      resultIndex !== undefined &&
      (!Number.isSafeInteger(resultIndex) ||
        resultIndex < 0 ||
        resultIndex > 100))
  )
    throw Object.assign(new Error("视频版本任务标识无效"), {
      status: 400,
      code: "invalid_video_take_task",
    });
  if (
    (current.provider && provider !== current.provider) ||
    (current.taskId && taskId !== current.taskId) ||
    (current.model && model !== current.model) ||
    (current.resultIndex !== null &&
      current.resultIndex !== undefined &&
      resultIndex !== current.resultIndex)
  )
    throw Object.assign(new Error("视频版本任务身份不可覆盖"), {
      status: 409,
      code: "video_take_identity_immutable",
    });
  if (!validVideoTakeTransition(current.status, status, taskId))
    throw Object.assign(new Error("视频版本状态转换无效"), {
      status: 409,
      code: "invalid_video_take_transition",
    });
  let hash = current.hash;
  let mimeType = current.mimeType;
  let bytes = current.bytes;
  let durationMs = current.durationMs;
  if (status === "completed") {
    const media = localVideoObject(
      root,
      body?.storageKey,
      body?.mimeType,
      body?.bytes,
    );
    hash = media.hash;
    mimeType = media.mimeType;
    bytes = media.bytes;
    durationMs =
      body?.durationMs === undefined ? null : Number(body.durationMs);
    if (
      durationMs !== null &&
      (!Number.isSafeInteger(durationMs) || durationMs < 0)
    )
      throw Object.assign(new Error("视频版本时长无效"), {
        status: 400,
        code: "invalid_video_take_duration",
      });
  }
  const now = isoNow();
  db.prepare(
    "UPDATE video_generation_take SET status=?,provider=?,task_id=?,model=?,hash=?,mime_type=?,bytes=?,duration_ms=?,result_index=?,error_code=?,updated_at=? WHERE take_id=?",
  ).run(
    status,
    provider || null,
    taskId || null,
    model || null,
    hash || null,
    mimeType || null,
    bytes ?? null,
    durationMs ?? null,
    resultIndex ?? null,
    errorCode,
    now,
    takeId,
  );
  if (status === "completed")
    db.prepare(
      "UPDATE video_generation_take SET provider_http_status=NULL,provider_error_code=NULL,provider_error_message=NULL,provider_request_id=NULL WHERE take_id=?",
    ).run(takeId);
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.state',?,?,?)",
  ).run(
    takeId,
    JSON.stringify({
      status,
      resultIndex: resultIndex ?? null,
      errorCode,
    }),
    now,
  );
  return videoTakeRow(
    db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId),
  );
}
function validVideoTakeTransition(current, next, taskId) {
  if (current === next) return true;
  if (current === "created")
    return (
      next === "submitting" ||
      next === "submission_unknown" ||
      next === "completed" ||
      next === "failed" ||
      (["pending", "result_pending"].includes(next) && Boolean(taskId))
    );
  if (current === "submitting")
    return (
      next === "submission_unknown" ||
      next === "failed" ||
      (next === "pending" && Boolean(taskId))
    );
  if (current === "submission_unknown")
    return next === "pending" && Boolean(taskId);
  if (current === "pending")
    return [
      "submission_unknown",
      "result_pending",
      "completed",
      "failed",
    ].includes(next);
  if (current === "result_pending")
    return ["submission_unknown", "pending", "completed", "failed"].includes(
      next,
    );
  if (current === "failed")
    return (
      next === "submission_unknown" || (next === "pending" && Boolean(taskId))
    );
  return false;
}
function adoptVideoTake(db, root, takeId) {
  const row = db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId);
  if (!row)
    throw Object.assign(new Error("视频版本不存在"), {
      status: 404,
      code: "video_take_not_found",
    });
  if (
    row.status !== "completed" ||
    !row.hash ||
    !existsSync(objectPath(root, row.hash))
  )
    throw Object.assign(new Error("只有已本地归档的视频版本可采纳"), {
      status: 409,
      code: "video_take_not_adoptable",
    });
  const now = isoNow();
  db.prepare(
    "INSERT INTO video_node_history(project_id,node_id,active_take_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,node_id) DO UPDATE SET active_take_id=excluded.active_take_id,updated_at=excluded.updated_at",
  ).run(row.projectId, row.nodeId, takeId, now, now);
  db.prepare(
    "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('video_take.adopt',?,?,?)",
  ).run(
    takeId,
    JSON.stringify({
      projectId: row.projectId,
      nodeId: row.nodeId,
    }),
    now,
  );
  return videoTakeRow(row);
}
function bootstrapVideoTake(db, root, body) {
  const allowed = new Set([
    ...VIDEO_TAKE_CREATE_FIELDS,
    ...VIDEO_TAKE_UPDATE_FIELDS,
  ]);
  rejectUnexpectedFields(body, allowed);
  const { projectId, nodeId } = videoTakeOwner(body);
  const provider = String(body?.provider || "").toLowerCase();
  const taskId = String(body?.taskId || "");
  const resultIndex =
    body?.resultIndex === undefined || body?.resultIndex === null
      ? 0
      : Number(body.resultIndex);
  if (
    !GENERATION_PROVIDERS.has(provider) ||
    !validProviderTaskId(provider, taskId) ||
    !Number.isSafeInteger(resultIndex) ||
    resultIndex < 0 ||
    resultIndex > 100
  )
    throw Object.assign(new Error("旧视频版本任务标识无效"), {
      status: 400,
      code: "invalid_video_take_task",
    });
  const model = requiredVideoTakeModel(body?.model);
  const prompt = sanitizeTakePrompt(body?.prompt);
  const parameters = videoTakeParameters(body?.parameters, model);
  let row = db
    .prepare(
      `${VIDEO_TAKE_SELECT} WHERE project_id=? AND node_id=? AND provider=? AND task_id=? AND result_index=?`,
    )
    .get(projectId, nodeId, provider, taskId, resultIndex);
  const created = !row;
  if (!row) {
    const media = localVideoObject(
      root,
      body?.storageKey,
      body?.mimeType,
      body?.bytes,
    );
    const takeId = `take_${randomUUID()}`;
    const now = isoNow();
    const durationMs =
      body?.durationMs === undefined ? null : Number(body.durationMs);
    if (
      durationMs !== null &&
      (!Number.isSafeInteger(durationMs) || durationMs < 0)
    )
      throw Object.assign(new Error("视频版本时长无效"), {
        status: 400,
        code: "invalid_video_take_duration",
      });
    db.prepare(
      "INSERT INTO video_generation_take(take_id,project_id,node_id,status,provider,task_id,model,prompt,params_json,hash,mime_type,bytes,duration_ms,result_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      takeId,
      projectId,
      nodeId,
      "completed",
      provider,
      taskId,
      model,
      prompt,
      JSON.stringify(parameters),
      media.hash,
      media.mimeType,
      media.bytes,
      durationMs,
      resultIndex,
      now,
      now,
    );
    row = db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(takeId);
  }
  if (created) adoptVideoTake(db, root, row.takeId);
  return {
    take: videoTakeRow(row),
    created,
  };
}
function sendObject(req, res, path, mimeType, accelRedirect = "") {
  const size = statSync(path).size;
  const common = {
    "content-type": mimeType || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
  };
  if (accelRedirect) {
    res.writeHead(200, {
      ...common,
      "x-accel-redirect": accelRedirect,
    });
    return res.end();
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  if (!req.headers.range) {
    res.writeHead(200, {
      ...common,
      "content-length": size,
    });
    return req.method === "HEAD" ? res.end() : createReadStream(path).pipe(res);
  }
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !match ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    res.writeHead(416, {
      "content-range": `bytes */${size}`,
    });
    return res.end();
  }
  res.writeHead(206, {
    ...common,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${size}`,
  });
  return req.method === "HEAD"
    ? res.end()
    : createReadStream(path, {
        start,
        end,
      }).pipe(res);
}
export function createLocalPlatformServer(options = {}) {
  const dataRoot = resolve(
    options.dataRoot || process.env.INFINITE_CANVAS_DATA_ROOT || DEFAULT_ROOT,
  );
  const host = options.host || process.env.INFINITE_CANVAS_HOST || "127.0.0.1";
  const projectExportTtlMs = Math.max(
    25,
    Number(options.projectExportTtlMs ?? PROJECT_EXPORT_TTL_MS),
  );
  const projectImportSourceTtlMs = Math.max(
    25,
    Number(options.projectImportSourceTtlMs ?? PROJECT_IMPORT_SOURCE_TTL_MS),
  );
  const runtimeId = String(options.runtimeId || randomUUID());
  if (!isLoopback(host))
    throw new Error("安全策略拒绝：本阶段只允许绑定回环地址");
  const deploymentProfile = resolveDeploymentProfile(options.deploymentProfile);
  const instanceKind = String(
    options.instanceKind ??
      process.env.INFINITE_CANVAS_INSTANCE_KIND ??
      "standard",
  ).trim();
  if (instanceKind !== "standard") {
    throw Object.assign(new Error("实例类型与部署档不匹配"), {
      status: 500,
      code: "instance_kind_invalid",
    });
  }
  const allowTestProviderEndpoints =
    options.allowTestProviderEndpoints === true;
  const profileMetadata = deploymentProfileMetadata(deploymentProfile);
  const { db, dbPath } = initialize(dataRoot);
  const providerEndpointPolicy = {
    allowRichBestLoopback: allowTestProviderEndpoints,
    api888PilotEnabled: options.api888PilotEnabled === true || false,
  };
  normalizePersistedRichBestEndpoints(db, providerEndpointPolicy);
  const grokOfficialPricing = createGrokOfficialPricing({
    fetchCatalog:
      options.grokOfficialPricingFetch ??
      (async () => {
        const response = await fetchApimartRoute(
          "https://apimart.ai/api/pricing/models/all",
          {
            signal: AbortSignal.timeout(15_000),
            redirect: "error",
          },
          {
            dataRoot,
            provider: "apimart",
          },
        );
        if (!response.ok) throw new Error("catalog unavailable");
        return response.json();
      }),
    maxAgeMs: options.grokOfficialPricingMaxAgeMs,
    now: options.grokOfficialPricingNow,
  });
  const grokOfficialExchangeRate = () => {
    const source =
      options.usdCnyRateSource ??
      process.env.INFINITE_CANVAS_USD_CNY_RATE_SOURCE;
    const capturedAt =
      options.usdCnyRateCapturedAt ??
      process.env.INFINITE_CANVAS_USD_CNY_RATE_CAPTURED_AT;
    return source && Number.isFinite(Date.parse(capturedAt))
      ? parseUsdCnyRate(
          options.usdCnyRate ?? process.env.INFINITE_CANVAS_USD_CNY_RATE,
        )
      : 0;
  };
  const grokSubmissionPolicy = "strict";
  const prepareGrokOfficialQuote = async (input) => {
    const payload = {
      ...input,
    };
    for (const key of [
      "input_image_count",
      "input_video_count",
      "input_audio_count",
      "input_video_duration_ms",
    ])
      delete payload[key];
    const counts = grokOfficialInputCounts(payload);
    for (const [field, value] of [
      ["input_image_count", counts.inputImageCount],
      ["input_video_count", counts.inputVideoCount],
      ["input_audio_count", 0],
    ])
      if (input[field] !== undefined && input[field] !== value)
        throw Object.assign(new Error("Grok 官方素材数量与计量声明不一致"), {
          status: 409,
          code: "provider_input_contract_mismatch",
        });
    const validationPayload = {
      ...payload,
      prompt: payload.prompt ?? "request preflight",
    };
    if (validationPayload.image_urls)
      validationPayload.image_urls = validationPayload.image_urls.map(
        (value) =>
          value === "metered-image" ? "https://pending.invalid/image" : value,
      );
    validateGrokOfficialPayload(validationPayload, {
      allowLocalVideo: true,
    });
    let sourceDurationMs = 0;
    if (payload.video) {
      if (!volcAssetRelayManager.available())
        throw Object.assign(new Error("Grok 官方编辑的源视频公网中继不可用"), {
          status: 503,
          code: "grok_official_edit_relay_unavailable",
        });
      const reference = grokOfficialLocalVideo(payload.video.url);
      if (!reference)
        throw Object.assign(
          new Error("编辑源视频须先保存为叙光对象以核实时长"),
          {
            status: 400,
            code: "grok_official_edit_source_unverified",
          },
        );
      const file = objectPath(dataRoot, reference.hash);
      if (!existsSync(file) || !statSync(file).isFile())
        throw Object.assign(new Error("Grok 编辑源视频对象不存在"), {
          status: 404,
          code: "grok_official_edit_source_missing",
        });
      const detected = detectVolcLocalMedia(file);
      if (
        detected.mediaKind !== "video" ||
        !ISO_BMFF_VIDEO_MIMES.has(detected.mimeType) ||
        statSync(file).size > 200 * 1024 * 1024
      )
        throw Object.assign(
          new Error(
            "Grok 编辑源视频须为有效 MP4/MOV，且不超过叙光 200 MB 保护上限",
          ),
          {
            status: 415,
            code: "grok_official_edit_source_invalid",
          },
        );
      const probe = await videoProbeRunner(file);
      sourceDurationMs = Math.ceil(Number(probe?.durationSeconds || 0) * 1000);
      if (
        !Number.isSafeInteger(sourceDurationMs) ||
        sourceDurationMs <= 0 ||
        sourceDurationMs > GROK_OFFICIAL_PLATFORM_EDIT_MAX_MS ||
        !probe.formatNames?.some((value) => ["mp4", "mov"].includes(value))
      )
        throw Object.assign(
          new Error("Grok 编辑源视频时长不可核实或超过叙光 30 秒保护上限"),
          {
            status: 422,
            code: "grok_official_edit_duration_invalid",
          },
        );
    }
    const catalog = await grokOfficialPricing.get();
    const fx = grokOfficialExchangeRate();
    return quoteGrokOfficial(
      payload,
      catalog,
      fx,
      sourceDurationMs,
      options.grokOfficialPricingNow?.() ?? Date.now(),
      grokOfficialPricing.maxAgeMs,
    );
  };

  // POSIX shells drop environment names that start with a digit. The Linux
  // entrypoint therefore receives the path under a shell-safe alias and
  // restores the credential target expected by the shared credential reader.
  if (
    process.platform !== "win32" &&
    process.env.API888_API_KEY_FILE &&
    !process.env[`${API888_CREDENTIAL_TARGET}_FILE`]
  )
    process.env[`${API888_CREDENTIAL_TARGET}_FILE`] =
      process.env.API888_API_KEY_FILE;
  const credentialResolver =
    options.credentialResolver || readWindowsCredential;
  const remoteEnvironment =
    process.env.INFINITE_CANVAS_VOLC_ASSET_REMOTE_INTEGRATION_ENABLED;
  const volcAssetRemoteRequested =
    options.volcAssetRemoteIntegrationEnabled ?? remoteEnvironment !== "false";
  const volcAssetRemoteIntegrationEnabled = volcAssetRemoteRequested === true;
  const volcAssetProjectName = safeVolcAssetProjectName(
    options.volcAssetProjectName ??
      process.env.INFINITE_CANVAS_VOLC_ASSET_PROJECT_NAME ??
      VOLC_ASSET_DEFAULT_PROJECT_NAME,
  );
  const volcAssetClient = createVolcAssetOpenApiClient({
    enabled: volcAssetRemoteIntegrationEnabled,
    credentialResolver,
    contract: options.volcAssetContract,
    fetchImpl: options.volcAssetFetch,
    now: options.volcAssetNow,
    timeoutMs: options.volcAssetRequestTimeoutMs,
    createTimeoutMs: options.volcAssetCreateTimeoutMs,
    allowTestEndpoint: options.volcAssetAllowTestEndpoint === true,
  });
  const volcAssetRelayDiagnostics = createVolcAssetRelayDiagnostics({
    db,
    fetchImpl: options.volcAssetRelayFetch,
    writeLine: options.volcAssetRelayDiagnosticSink,
    now: options.volcAssetDiagnosticNow,
    correlationId: options.volcAssetDiagnosticCorrelationId,
  });
  const rawVolcAssetRelayManager =
    options.volcAssetRelayManager ||
    createVolcAssetRelayManager({
      cloudflaredPath: options.cloudflaredPath,
      fetchImpl: volcAssetRelayDiagnostics.fetch,
      ttlMs: options.volcAssetRelayTtlMs,
    });
  const volcAssetRelayManager = instrumentVolcAssetRelayManager(
    rawVolcAssetRelayManager,
    volcAssetRelayDiagnostics,
  );
  let volcAigcGroupPromise;
  const volcAigcGroupResolver = () => {
    if (!volcAigcGroupPromise)
      volcAigcGroupPromise = resolveVolcAigcGroup(
        db,
        volcAssetClient,
        volcAssetProjectName,
      ).catch((error) => {
        volcAigcGroupPromise = null;
        throw error;
      });
    return volcAigcGroupPromise;
  };
  const credentialHosts = new Set(
    options.credentialHosts || [
      "api.apimart.ai",
      "ark.cn-beijing.volces.com",
      "www.runninghub.ai",
      "888api.xin",
    ],
  );
  const remoteObjectHosts = new Set(
    options.remoteObjectHosts || ALLOWED_REMOTE_OBJECT_HOSTS,
  );
  const remoteImportPolicy = {
    timeoutMs: options.remoteImportTimeoutMs,
    attempts: options.remoteImportAttempts,
    redirects: options.remoteImportRedirects,
    maxImageBytes: options.maxRemoteImageBytes,
    maxVideoBytes: options.maxRemoteVideoBytes,
    lookupHost: options.api888LookupHost,
  };
  const reconcileIntervalMs = Math.max(
    0,
    Number(
      options.providerReconcileIntervalMs ??
        process.env.INFINITE_CANVAS_PROVIDER_RECONCILE_INTERVAL_MS ??
        15_000,
    ),
  );
  const reconcileStartupDelayMs = Math.max(
    0,
    Number(options.providerReconcileStartupDelayMs ?? 1_000),
  );
  const volcAssetPollIntervalMs = volcAssetRemoteIntegrationEnabled
    ? Math.max(1_000, Number(options.volcAssetPollIntervalMs ?? 1_000))
    : 0;
  const volcAssetPollStartupDelayMs = Math.max(
    0,
    Number(options.volcAssetPollStartupDelayMs ?? 1_000),
  );
  const volcAssetTimings = {
    reconcileAfterMs: Math.max(
      10,
      Number(
        options.volcAssetReconcileAfterMs ?? VOLC_ASSET_RECONCILE_AFTER_MS,
      ),
    ),
    hedgeAfterMs: Math.max(
      20,
      Number(options.volcAssetHedgeAfterMs ?? VOLC_ASSET_HEDGE_AFTER_MS),
    ),
    backupAfterMs: Math.max(
      20,
      Number(options.volcAssetBackupAfterMs ?? VOLC_ASSET_BACKUP_AFTER_MS),
    ),
    generationHedgeAfterMs: Math.max(
      20,
      Number(
        options.volcAssetGenerationHedgeAfterMs ??
          VOLC_ASSET_GENERATION_HEDGE_AFTER_MS,
      ),
    ),
  };
  const requestedVolcAssetConcurrency = Number(
    options.volcAssetConcurrency ??
      process.env.INFINITE_CANVAS_VOLC_ASSET_CONCURRENCY ??
      VOLC_ASSET_DEFAULT_CONCURRENCY,
  );
  const volcAssetConcurrency = Number.isSafeInteger(
    requestedVolcAssetConcurrency,
  )
    ? Math.max(
        1,
        Math.min(VOLC_ASSET_DEFAULT_CONCURRENCY, requestedVolcAssetConcurrency),
      )
    : VOLC_ASSET_DEFAULT_CONCURRENCY;
  const volcAssetSubmissionQueue = createBoundedJobQueue({
    maxActive: volcAssetConcurrency,
    maxQueued: VOLC_ASSET_BATCH_MAX * 4,
  });
  const backgroundJobs = createBoundedJobQueue({
    maxActive: Number(
      options.maxBackgroundJobs ||
        process.env.INFINITE_CANVAS_JOB_CONCURRENCY ||
        3,
    ),
    maxQueued: Number(
      options.maxQueuedJobs ||
        process.env.INFINITE_CANVAS_JOB_QUEUE_LIMIT ||
        12,
    ),
  });
  const mediaJobs = createBoundedJobQueue({
    maxActive: 1,
    maxQueued: 4,
  });
  const projectPackageJobs = createBoundedJobQueue({
    maxActive: 1,
    maxQueued: 3,
  });
  const projectExportJobs = new Map();
  const projectImportSourceTimers = new Map();
  const videoFastStartRunner =
    typeof options.videoFastStartRunner === "function"
      ? options.videoFastStartRunner
      : runVideoFastStartWorker;
  const videoProbeRunner =
    typeof options.videoProbeRunner === "function"
      ? options.videoProbeRunner
      : (filePath) =>
          probeVideoFile(filePath, {
            ffprobePath: options.ffprobePath,
          });
  const audioProbeRunner =
    typeof options.audioProbeRunner === "function"
      ? options.audioProbeRunner
      : (filePath) =>
          probeAudioFile(filePath, {
            ffprobePath: options.ffprobePath,
          });
  const videoPreviewRunner =
    typeof options.videoPreviewRunner === "function"
      ? options.videoPreviewRunner
      : (sourcePath, targetPath) =>
          transcodeVideoPreview(sourcePath, targetPath, {
            ffmpegPath: options.ffmpegPath,
          });
  const requestedFastStartBytes = Number(
    options.maxFastStartVideoBytes || MAX_FASTSTART_VIDEO_BYTES,
  );
  const maxFastStartBytes =
    Number.isFinite(requestedFastStartBytes) && requestedFastStartBytes > 0
      ? Math.min(MAX_FASTSTART_VIDEO_BYTES, Math.floor(requestedFastStartBytes))
      : MAX_FASTSTART_VIDEO_BYTES;
  const mediaDirectPrefix =
    String(
      options.mediaDirectPrefix ||
        process.env.INFINITE_CANVAS_MEDIA_X_ACCEL_PREFIX ||
        "",
    ) === "/__local_video_objects"
      ? "/__local_video_objects"
      : "";
  const clients = new Set();
  const leases = new Map();
  const promptImportRollbacks = new Map();
  const promptImportObjects = new Map();
  let reconcileRunning = false;
  let reconcileTimer;
  let reconcileStartupTimer;
  let volcAssetPollPromise = null;
  let volcAssetPollTimer;
  let volcAssetPollStartupTimer;
  const volcAssetInflightSubmissions = new Map();
  const providerAttemptChecks = new Map();
  const runProviderAttemptCheck = (attempt) => {
    const existing = providerAttemptChecks.get(attempt.takeId);
    if (existing) return existing;
    const checkedAt = Date.now();
    const pending = (async () => {
      try {
        await reconcileProviderAttempt(
          db,
          dataRoot,
          attempt,
          credentialResolver,
          credentialHosts,
          remoteObjectHosts,
          remoteImportPolicy,
          volcAssetRelayManager,
          providerEndpointPolicy,
        );
      } catch (error) {
        scheduleProviderAttempt(
          db,
          attempt,
          attempt.taskId ? "monitoring" : "pending",
          diagnosticNetworkCode(error) ||
            error?.code ||
            "provider_reconcile_failed",
          [],
          {
            phase: "query_error",
            retryAfterMs: error?.retryAfterMs,
            outcome: "query_failed",
            durationMs: Date.now() - checkedAt,
            providerError: error?.providerError,
            error,
          },
        );
      }
    })().finally(() => providerAttemptChecks.delete(attempt.takeId));
    providerAttemptChecks.set(attempt.takeId, pending);
    return pending;
  };
  const runProviderReconciliation = async () => {
    if (reconcileRunning)
      return {
        checked: 0,
        skipped: true,
      };
    reconcileRunning = true;
    try {
      return await reconcileProviderAttempts(
        db,
        dataRoot,
        credentialResolver,
        credentialHosts,
        remoteObjectHosts,
        remoteImportPolicy,
        volcAssetRelayManager,
        providerEndpointPolicy,
        runProviderAttemptCheck,
      );
    } finally {
      reconcileRunning = false;
    }
  };
  const runVolcAssetPolling = () => {
    if (!volcAssetRemoteIntegrationEnabled)
      return Promise.resolve({
        checked: 0,
        skipped: true,
      });
    if (volcAssetPollPromise) return volcAssetPollPromise;
    volcAssetPollPromise = (async () => {
      try {
        const publish = (registration) => {
          if (["active", "failed"].includes(registration.status))
            volcAssetRelayManager.stop(registration.localRef);
          const binding = readVolcAssetBinding(db, registration.localRef);
          if (binding)
            broadcast("volc-asset-validation", {
              localRef: registration.localRef,
              binding,
              registration,
              updatedAt: binding.updatedAt,
            });
        };
        const result = await pollDueVolcAssetRegistrations(
          db,
          dataRoot,
          volcAssetClient,
          volcAigcGroupResolver,
          volcAssetRelayManager,
          volcAssetInflightSubmissions,
          volcAssetTimings,
          volcAssetSubmissionQueue,
          volcAssetConcurrency,
          publish,
        );
        return {
          checked: result.checked,
          failed: result.failed,
        };
      } finally {
        volcAssetPollPromise = null;
      }
    })();
    return volcAssetPollPromise;
  };
  const broadcast = (type, event) => {
    const payload = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of [...clients]) {
      if (client.destroyed || client.writableEnded) {
        clients.delete(client);
        continue;
      }
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  };
  const localH3Worker = createLocalH3WorkerService({
    db,
    dataRoot,
    probeVideoFile: videoProbeRunner,
    broadcast,
    allowInsecureTransport: options.allowInsecureH3WorkerTransport === true,
    allowInsecureLoopback: deploymentProfile === "personal_local",
    workflowSha256: options.localH3WorkflowSha256,
    maxQueued: options.localH3MaxQueued,
    leaseMs: options.localH3LeaseMs,
    onlineTtlMs: options.localH3OnlineTtlMs,
    signatureSkewMs: options.localH3SignatureSkewMs,
    chunkSize: options.localH3ChunkSize,
    maxUploadBytes: options.localH3MaxUploadBytes,
    now: options.localH3Now,
  });
  const presentGenerationTask = (row) => {
    const task = generationTaskRow(row);
    return task?.provider === LOCAL_H3_PROVIDER
      ? {
          ...task,
          localH3: localH3Worker.taskOverlay(task.taskId),
        }
      : task;
  };
  const leaseResource = (pathname) => {
    const resource = decodeURIComponent(
      pathname.slice("/api/local/leases/".length),
    );
    if (!resource || resource.length > 300 || resource.includes("\0"))
      throw Object.assign(new Error("编辑租约资源无效"), {
        status: 400,
      });
    return resource;
  };
  const activeLease = (resource) => {
    const lease = leases.get(resource);
    if (!lease) return null;
    if (lease.expiresAt <= Date.now()) {
      leases.delete(resource);
      broadcast("lease", {
        resource,
        released: true,
        expired: true,
        at: isoNow(),
      });
      return null;
    }
    return lease;
  };
  const server = createServer(async (req, res) => {
    res.narralightRequestId = createDiagnosticRequestId();
    res.narralightRequestMethod = String(req.method || "UNKNOWN").toUpperCase();
    res.setHeader("x-request-id", res.narralightRequestId);
    try {
      if (!isLocalRequest(req))
        return sendJson(res, 403, {
          error: "只允许本机回环来源访问",
        });
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "127.0.0.1"}`,
      );
      const path = url.pathname;
      res.narralightRequestPath = path;
      const browserMutation =
        !["GET", "HEAD", "OPTIONS"].includes(
          String(req.method || "GET").toUpperCase(),
        ) &&
        path.startsWith("/api/local/") &&
        Boolean(
          req.headers["sec-fetch-site"] ||
          req.headers.referer ||
          req.headers.origin,
        );
      if (
        browserMutation &&
        (req.headers["x-narralight-web-version"] !== PLATFORM_APP_VERSION ||
          req.headers["x-narralight-runtime-id"] !== runtimeId)
      ) {
        return sendJson(res, 409, {
          error: "当前页面版本已停止操作，请刷新后继续",
          code: "client_runtime_stale",
          currentVersion: PLATFORM_APP_VERSION,
        });
      }
      if (path.startsWith("/api/local/worker/v1")) {
        const response = await localH3Worker.handleWorkerRequest(req, url);
        if (response?.status === 204) {
          res.writeHead(204, {
            "cache-control": "no-store",
            "x-request-id": res.narralightRequestId,
          });
          return res.end();
        }
        if (response?.binary) {
          res.writeHead(response.status || 200, {
            ...response.headers,
            "x-request-id": res.narralightRequestId,
          });
          return res.end(response.binary);
        }
        return sendJson(
          res,
          response?.status || 404,
          response?.body || {
            error: "not_found",
          },
          response?.headers,
        );
      }
      if (req.method === "GET" && path === "/api/local/health")
        return sendJson(res, 200, {
          ok: true,
          service: "infinite-canvas-local-platform",
          schemaVersion: 3,
          loopbackOnly: true,
          deploymentProfile,
          instanceKind,
          appVersion: PLATFORM_APP_VERSION,
          runtimeId,
        });
      if (req.method === "GET" && path === "/api/local/provider-catalog") {
        const row = db
          .prepare(
            "SELECT value FROM app_state WHERE key='infinite-canvas:ai_config_store'",
          )
          .get();
        const channels = row?.value
          ? parseAiConfigState(row.value).config.channels
          : [];
        const catalog = projectProviderCatalog(channels);
        return sendJson(res, 200, catalog);
      }
      if (
        req.method === "GET" &&
        path === "/api/local/provider-catalog/888api/readiness"
      ) {
        return sendJson(res, 404, {
          error: "接口不存在",
        });
      }
      if (path === "/api/local/provider-catalog/888api/probe") {
        return sendJson(res, 404, {
          error: "接口不存在",
        });
      }
      if (req.method === "GET" && path === "/api/local/meta") {
        const publicMeta = {
          network: "loopback-only",
          remoteAccessEnabled: false,
          autoUpdate: false,
          instanceKind,
          ...profileMetadata,
        };
        return sendJson(res, 200, {
          dataRoot,
          database: dbPath,
          ...publicMeta,
        });
      }
      if (
        req.method === "GET" &&
        path === "/api/local/apimart/grok-official/pricing"
      ) {
        const policy = {
          submissionPolicy: grokSubmissionPolicy,
          platformImageLimit: GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT,
          editSourceRelayAvailable: volcAssetRelayManager.available(),
        };
        try {
          const catalog = await grokOfficialPricing.get();
          const fx = grokOfficialExchangeRate();
          if (!fx)
            throw Object.assign(new Error("USD/CNY 汇率待配置"), {
              code: "grok_official_fx_missing",
            });
          return sendJson(res, 200, {
            status: "verified",
            ...catalog,
            exchangeRateMicrormbPerUnit: fx,
            expiresAt: new Date(
              Date.parse(catalog.capturedAt) + grokOfficialPricing.maxAgeMs,
            ).toISOString(),
            platformImageLimit: GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT,
            editSourceRelayAvailable: volcAssetRelayManager.available(),
          });
        } catch (error) {
          return sendJson(res, 200, {
            status: "blocked",
            models: {},
            platformImageLimit: GROK_OFFICIAL_PLATFORM_IMAGE_LIMIT,
            editSourceRelayAvailable: volcAssetRelayManager.available(),
            code: error.code || "grok_official_pricing_unavailable",
            message: "Grok 官方实时价格待验证，已阻止付费提交",
          });
        }
      }
      if (req.method === "GET" && path === "/api/local/capacity")
        return sendJson(res, 200, {
          profile: "local",
          backgroundJobs: backgroundJobs.status(),
          mediaJobs: mediaJobs.status(),
          remoteAccessEnabled: false,
        });
      if (req.method === "GET" && path === "/api/local/storage/usage")
        return sendJson(res, 200, platformStorageUsage(dataRoot, dbPath));
      if (req.method === "GET" && path === "/api/local/network-proxy/status") {
        return sendJson(res, 200, {
          ok: true,
          enabled: readNetworkProxyConfig(db).enabled,
          service: "narralight-local-platform-proxy",
        });
      }
      if (path === "/api/local/network-proxy") {
        return await proxyConfiguredNetworkRequest(
          req,
          res,
          url,
          db,
          credentialResolver,
          credentialHosts,
          providerEndpointPolicy,
        );
      }
      if (path === "/api/local/agent-proxy/config")
        return sendJson(res, 200, {
          ok: true,
          protocolVersion: 6,
          url: "/api/local/agent-proxy",
          token: "server-managed",
          hasToken: true,
        });
      if (path.startsWith("/api/local/agent-proxy/")) {
        const agentPath = path.slice("/api/local/agent-proxy".length);
        const normalizedAgentPath =
          agentPath.length > 1 ? agentPath.replace(/\/+$/, "") : agentPath;
        return await proxyAgent(req, res, url, dataRoot);
      }
      if (path.startsWith("/api/local/ai/")) {
        const { channelId, requestPath } = aiProxyRequestIdentity(path);
        const channelDescriptor = readAiChannelDescriptor(
          db,
          channelId,
          providerEndpointPolicy,
        );
        const videoCreation =
          req.method === "POST" &&
          (requestPath === "/v1/videos" ||
            requestPath === "/v1/videos/generations" ||
            /\/contents\/generations\/tasks$/.test(requestPath) ||
            requestPath === RUNNINGHUB_CREATE_PATH ||
            isRunningHubGrokCreatePath(requestPath));
        const imageCreation =
          req.method === "POST" &&
          /\/images\/(?:generations|edits)\/?$/.test(requestPath);
        const proxy = () =>
          proxyAi(
            req,
            res,
            url,
            db,
            dataRoot,
            credentialResolver,
            credentialHosts,
            volcAssetRelayManager,
            videoProbeRunner,
            audioProbeRunner,
            (bindings) => {
              for (const binding of bindings)
                broadcast("volc-asset-validation", {
                  localRef: binding.localRef,
                  binding,
                  updatedAt: binding.updatedAt,
                });
            },
            providerEndpointPolicy,
            prepareGrokOfficialQuote,
            remoteObjectHosts,
            remoteImportPolicy,
          );
        try {
          const backgroundVideoCreate =
            req.method === "POST" &&
            (requestPath === "/v1/videos/generations" ||
              requestPath === "/v1/videos" ||
              requestPath === RUNNINGHUB_REQUEST_PATH);
          return backgroundVideoCreate
            ? await backgroundJobs.run(proxy)
            : await proxy();
        } catch (error) {
          throw error;
        }
      }
      if (req.method === "GET" && path === "/api/local/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        res.write(
          `event: ready\ndata: ${JSON.stringify({
            at: isoNow(),
          })}\n\n`,
        );
        clients.add(res);
        const removeClient = () => clients.delete(res);
        req.on("close", removeClient);
        res.on("close", removeClient);
        res.on("error", removeClient);
        return;
      }
      if (path.startsWith("/api/local/leases/")) {
        const resource = leaseResource(path);
        const queryClientId = String(url.searchParams.get("clientId") || "");
        if (req.method === "GET") {
          const lease = activeLease(resource);
          return sendJson(res, 200, {
            resource,
            owned: Boolean(lease && lease.clientId === queryClientId),
            available: !lease,
            expiresAt: lease ? new Date(lease.expiresAt).toISOString() : null,
          });
        }
        if (req.method === "PUT") {
          const body = await readJson(req, 16 * 1024);
          const requestClientId = String(body.clientId || "");
          if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestClientId))
            return sendJson(res, 400, {
              error: "client_id_invalid",
            });
          const current = activeLease(resource);
          if (
            current &&
            current.clientId !== requestClientId &&
            body.force !== true
          )
            return sendJson(res, 409, {
              error: "lease_held",
              resource,
              owned: false,
              expiresAt: new Date(current.expiresAt).toISOString(),
            });
          const lease = {
            clientId: requestClientId,
            expiresAt: Date.now() + EDIT_LEASE_TTL_MS,
          };
          leases.set(resource, lease);
          if (!current || current.clientId !== requestClientId)
            db.prepare(
              "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('lease.acquire',?,?,?)",
            ).run(
              resource,
              JSON.stringify({
                takeover: Boolean(current),
                owner: createHash("sha256")
                  .update(requestClientId)
                  .digest("hex")
                  .slice(0, 12),
              }),
              isoNow(),
            );
          broadcast("lease", {
            resource,
            clientId: requestClientId,
            expiresAt: new Date(lease.expiresAt).toISOString(),
            takeover: Boolean(current && current.clientId !== requestClientId),
          });
          return sendJson(res, 200, {
            resource,
            owned: true,
            expiresAt: new Date(lease.expiresAt).toISOString(),
          });
        }
        if (req.method === "DELETE") {
          const body = await readJson(req, 16 * 1024);
          const requestClientId = String(body.clientId || "");
          const current = activeLease(resource);
          if (current?.clientId === requestClientId) {
            leases.delete(resource);
            db.prepare(
              "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('lease.release',?,?,?)",
            ).run(
              resource,
              JSON.stringify({
                owner: createHash("sha256")
                  .update(requestClientId)
                  .digest("hex")
                  .slice(0, 12),
              }),
              isoNow(),
            );
            broadcast("lease", {
              resource,
              clientId: requestClientId,
              released: true,
              at: isoNow(),
            });
          }
          return sendJson(res, 200, {
            resource,
            released: !leases.has(resource),
          });
        }
      }
      if (path.startsWith("/api/local/state/")) {
        const key = stateKey(path);
        if (req.method === "GET") {
          const row = db
            .prepare(
              "SELECT value,version,updated_at AS updatedAt FROM app_state WHERE key=?",
            )
            .get(key);
          if (!row)
            return sendJson(res, 404, {
              error: "not_found",
            });
          const value =
            key === "infinite-canvas:ai_config_store"
              ? projectAiConfigState(row.value)
              : row.value;
          return sendJson(
            res,
            200,
            {
              ...row,
              value,
            },
            {
              etag: `\"${row.version}\"`,
            },
          );
        }
        if (req.method === "PUT") {
          const body = await readJson(req);
          if (typeof body.value !== "string")
            return sendJson(res, 400, {
              error: "value 必须是字符串",
            });
          const requiredLease =
            typeof body.leaseResource === "string" ? body.leaseResource : "";
          if (requiredLease) {
            const lease = activeLease(requiredLease);
            if (!lease || lease.clientId !== body.clientId)
              return sendJson(res, 423, {
                error: "edit_lease_required",
                resource: requiredLease,
              });
          }
          const current = db
            .prepare(
              "SELECT value,version,updated_at AS updatedAt FROM app_state WHERE key=?",
            )
            .get(key);
          const actual = Number(current?.version || 0);
          const expected =
            body.expectedVersion === undefined
              ? actual
              : Number(body.expectedVersion);
          if (current?.value === body.value)
            return sendJson(
              res,
              200,
              {
                key,
                version: actual,
                updatedAt: current.updatedAt,
                unchanged: true,
              },
              {
                etag: `\"${actual}\"`,
              },
            );
          if (!Number.isSafeInteger(expected) || expected !== actual)
            return sendJson(res, 409, {
              error: "version_conflict",
              expectedVersion: expected,
              actualVersion: actual,
            });
          const mergedValue = body.value;
          let safeValue = sanitizePersistedState(db, key, mergedValue, {
            allowRichBestLoopback: allowTestProviderEndpoints,
          });
          if (current?.value === safeValue)
            return sendJson(
              res,
              200,
              {
                key,
                version: actual,
                updatedAt: current.updatedAt,
                unchanged: true,
              },
              {
                etag: `\"${actual}\"`,
              },
            );
          const updatedAt = isoNow();
          const version = actual + 1;
          db.prepare(
            "INSERT INTO app_state(key,value,version,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at",
          ).run(key, safeValue, version, updatedAt);
          db.prepare(
            "INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('state.put',?,?,?)",
          ).run(
            key,
            JSON.stringify({
              version,
            }),
            updatedAt,
          );
          broadcast("state", {
            key,
            version,
            updatedAt,
            clientId:
              typeof body.clientId === "string" ? body.clientId : undefined,
            leaseResource: requiredLease || undefined,
          });
          return sendJson(
            res,
            200,
            {
              key,
              version,
              updatedAt,
            },
            {
              etag: `\"${version}\"`,
            },
          );
        }
        if (req.method === "DELETE") {
          db.prepare("DELETE FROM app_state WHERE key=?").run(key);
          broadcast("state", {
            key,
            version: 0,
            deleted: true,
            updatedAt: isoNow(),
          });
          return sendJson(res, 200, {
            key,
            deleted: true,
          });
        }
      }
      if (req.method === "GET" && path === "/api/local/volc-assets/config")
        return sendJson(res, 200, {
          credentialsConfigured: hasVolcAssetCredentials(credentialResolver),
          relayAvailable: volcAssetRelayManager.available(),
          remoteIntegrationEnabled: volcAssetRemoteIntegrationEnabled,
          publicUrlRequired: false,
          projectName: volcAssetProjectName,
        });
      if (
        req.method === "POST" &&
        path === "/api/local/volc-assets/registrations"
      ) {
        if (!volcAssetRemoteIntegrationEnabled)
          return sendJson(res, 503, {
            error: "volc_asset_remote_disabled",
            code: "volc_asset_remote_disabled",
          });
        if (!hasVolcAssetCredentials(credentialResolver))
          return sendJson(res, 409, {
            error: "火山虚拟人像资产 AK/SK 未配置",
            code: "volc_asset_credentials_missing",
          });
        if (!volcAssetRelayManager.available())
          return sendJson(res, 409, {
            error: "临时公网素材通道未安装",
            code: "volc_asset_relay_missing",
          });
        const body = await readJson(req, 16 * 1024);
        const result = startVolcAssetReview(
          db,
          dataRoot,
          body,
          volcAssetProjectName,
        );
        const binding = readVolcAssetBinding(db, result.registration.localRef);
        broadcast("volc-asset-validation", {
          localRef: result.registration.localRef,
          binding,
          registration: result.registration,
          updatedAt: result.registration.updatedAt,
        });
        void runVolcAssetPolling();
        return sendJson(res, 201, result);
      }
      if (
        req.method === "POST" &&
        path === "/api/local/volc-assets/registrations/batch"
      ) {
        if (!volcAssetRemoteIntegrationEnabled)
          return sendJson(res, 503, {
            error: "volc_asset_remote_disabled",
            code: "volc_asset_remote_disabled",
          });
        if (!hasVolcAssetCredentials(credentialResolver))
          return sendJson(res, 409, {
            error: "火山虚拟人像资产 AK/SK 未配置",
            code: "volc_asset_credentials_missing",
          });
        if (!volcAssetRelayManager.available())
          return sendJson(res, 409, {
            error: "临时公网素材通道未安装",
            code: "volc_asset_relay_missing",
          });
        const body = await readJson(req, 64 * 1024);
        const references = Array.isArray(body.references)
          ? body.references
          : [];
        if (references.length > VOLC_ASSET_BATCH_MAX)
          return sendJson(res, 400, {
            error: `单次最多提交 ${VOLC_ASSET_BATCH_MAX} 份素材`,
            code: "volc_asset_batch_too_large",
          });
        const items = startVolcAssetReviewBatch(
          db,
          dataRoot,
          references,
          volcAssetProjectName,
          credentialResolver,
        ).map((item) =>
          item.error
            ? {
                ...item,
                requestId: res.narralightRequestId,
              }
            : item,
        );
        items.forEach((item) => {
          if (!item.localRef) return;
          broadcast("volc-asset-validation", {
            localRef: item.localRef,
            binding: item.binding,
            registration: item.registration,
            updatedAt:
              item.registration?.updatedAt ||
              item.binding?.updatedAt ||
              isoNow(),
          });
        });
        void runVolcAssetPolling();
        return sendJson(res, 202, {
          items,
        });
      }
      if (path.startsWith("/api/local/volc-assets/visual-"))
        return sendJson(res, 410, {
          error: "刷脸认证流程已撤销，请刷新叙光并使用“提交火山素材审核”",
          code: "volc_asset_visual_identity_removed",
        });
      if (req.method === "POST" && path === "/api/local/volc-assets/register")
        return sendJson(res, 410, {
          error: "请改用叙光的“提交火山素材审核”入口",
          code: "volc_asset_manual_registration_removed",
        });
      const volcRegistrationMatch =
        /^\/api\/local\/volc-assets\/registrations\/([^/]+)$/.exec(path);
      if (req.method === "GET" && volcRegistrationMatch) {
        const localRef = volcAssetReference(
          decodeURIComponent(volcRegistrationMatch[1]),
        );
        const registration = readVolcAssetRegistration(db, localRef);
        return registration
          ? sendJson(res, 200, {
              registration,
              binding: readVolcAssetBinding(db, localRef),
              remoteIntegrationEnabled: volcAssetRemoteIntegrationEnabled,
            })
          : sendJson(res, 404, {
              error: "volc_asset_registration_not_found",
            });
      }
      const volcGenerationRetryMatch =
        /^\/api\/local\/volc-assets\/bindings\/([^/]+)\/generation-retry$/.exec(
          path,
        );
      if (req.method === "POST" && volcGenerationRetryMatch) {
        const localRef = volcAssetReference(
          decodeURIComponent(volcGenerationRetryMatch[1]),
        );
        const binding = resetVolcAssetGenerationVisibility(db, localRef);
        broadcast("volc-asset-validation", {
          localRef,
          binding,
          updatedAt: binding.updatedAt,
        });
        return sendJson(res, 200, {
          binding,
        });
      }
      const volcBindingMatch =
        /^\/api\/local\/volc-assets\/bindings\/([^/]+)$/.exec(path);
      if (volcBindingMatch) {
        const localRef = volcAssetReference(
          decodeURIComponent(volcBindingMatch[1]),
        );
        if (req.method === "GET") {
          const binding = readVolcAssetBinding(db, localRef);
          return binding
            ? sendJson(res, 200, {
                binding,
              })
            : sendJson(res, 404, {
                error: "volc_asset_binding_not_found",
              });
        }
        if (req.method === "PUT") {
          const body = await readJson(req, 16 * 1024);
          const binding = classifyVolcAssetBinding(
            db,
            {
              ...body,
              localRef,
            },
            credentialResolver,
          );
          broadcast("volc-asset-validation", {
            localRef,
            binding,
            updatedAt: binding.updatedAt,
          });
          return sendJson(res, 200, {
            binding,
            credentialsConfigured: hasVolcAssetCredentials(credentialResolver),
            relayAvailable: volcAssetRelayManager.available(),
            remoteIntegrationEnabled: volcAssetRemoteIntegrationEnabled,
            projectName: volcAssetProjectName,
          });
        }
      }
      if (
        req.method === "POST" &&
        path === "/api/local/volc-assets/batch-check"
      ) {
        const body = await readJson(req, 64 * 1024);
        const references = Array.isArray(body.references)
          ? body.references
          : [];
        if (references.length > VOLC_ASSET_BATCH_MAX)
          return sendJson(res, 400, {
            error: `单次最多检查 ${VOLC_ASSET_BATCH_MAX} 份素材`,
            code: "volc_asset_batch_too_large",
          });
        const result = checkVolcAssetBindings(
          db,
          references,
          credentialResolver,
        );
        result.bindings.forEach((binding) =>
          broadcast("volc-asset-validation", {
            localRef: binding.localRef,
            binding,
            updatedAt: binding.updatedAt,
          }),
        );
        return sendJson(res, 200, {
          ...result,
          relayAvailable: volcAssetRelayManager.available(),
          remoteIntegrationEnabled: volcAssetRemoteIntegrationEnabled,
          projectName: volcAssetProjectName,
        });
      }
      if (
        req.method === "POST" &&
        path === "/api/local/volc-assets/preflight"
      ) {
        const body = await readJson(req, 64 * 1024);
        return sendJson(res, 200, {
          ...preflightVolcAssets(db, body, credentialResolver),
          remoteIntegrationEnabled: volcAssetRemoteIntegrationEnabled,
        });
      }
      if (
        req.method === "POST" &&
        path === "/api/local/h3/workers/pairing-codes"
      ) {
        return sendJson(res, 201, localH3Worker.createPairingCode());
      }
      const localH3WorkerRevokeMatch =
        /^\/api\/local\/h3\/workers\/([^/]+)\/revoke$/.exec(path);
      if (localH3WorkerRevokeMatch && req.method === "POST") {
        return sendJson(
          res,
          200,
          localH3Worker.revokeWorker(
            decodeURIComponent(localH3WorkerRevokeMatch[1]),
          ),
        );
      }
      if (req.method === "GET" && path === "/api/local/h3/status") {
        return sendJson(res, 200, localH3Worker.status());
      }
      if (req.method === "POST" && path === "/api/local/h3/jobs") {
        const body = await readJson(req, 64 * 1024);
        const job = localH3Worker.createJob(
          body,
          req.headers["idempotency-key"],
        );
        const task = presentGenerationTask(
          db
            .prepare(
              `${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`,
            )
            .get(LOCAL_H3_PROVIDER, job.jobId),
        );
        const take = videoTakeRow(
          db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(job.takeId),
        );
        return sendJson(res, 201, {
          job,
          task,
          take,
        });
      }
      const localH3CancelMatch =
        /^\/api\/local\/h3\/jobs\/([^/]+)\/cancel$/.exec(path);
      if (localH3CancelMatch && req.method === "POST") {
        const jobId = decodeURIComponent(localH3CancelMatch[1]);
        const existing = localH3Worker.getJob(jobId);
        if (!existing)
          return sendJson(res, 404, {
            error: "H3 任务不存在",
            code: "local_h3_job_not_found",
          });
        const job = localH3Worker.cancelJob(jobId);
        const task = presentGenerationTask(
          db
            .prepare(
              `${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`,
            )
            .get(LOCAL_H3_PROVIDER, job.jobId),
        );
        const take = videoTakeRow(
          db.prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`).get(job.takeId),
        );
        return sendJson(res, 200, {
          job,
          task,
          take,
        });
      }
      const snapshotMatch = /^\/api\/local\/project-snapshots\/([^/]+)$/.exec(
        path,
      );
      if (snapshotMatch && req.method === "GET") {
        const projectId = decodeURIComponent(snapshotMatch[1]);
        const generationTasks = db
          .prepare(
            `${GENERATION_TASK_SELECT} WHERE g.project_id=? ORDER BY g.created_at ASC,g.provider,g.task_id`,
          )
          .all(projectId)
          .map(presentGenerationTask);
        const videoGenerationTakes = db
          .prepare(
            `${VIDEO_TAKE_SELECT} WHERE project_id=? ORDER BY created_at ASC,take_id ASC`,
          )
          .all(projectId)
          .map(videoTakeRow);
        const videoNodeHistory = db
          .prepare(
            "SELECT node_id AS nodeId,active_take_id AS activeTakeId,created_at AS createdAt,updated_at AS updatedAt FROM video_node_history WHERE project_id=? ORDER BY created_at,node_id",
          )
          .all(projectId);
        return sendJson(res, 200, {
          version: 1,
          projectId,
          generationTasks,
          videoGenerationTakes,
          videoNodeHistory,
        });
      }
      const taskIdentity = generationTaskIdentity(path);
      if (taskIdentity) {
        if (req.method === "GET") {
          const row = db
            .prepare(
              `${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`,
            )
            .get(taskIdentity.provider, taskIdentity.taskId);
          if (row && ![row].length)
            return sendJson(res, 403, {
              error: "无权查看该项目的生成记录",
              code: "project_view_required",
            });
          return row
            ? sendJson(res, 200, presentGenerationTask(row))
            : sendJson(res, 404, {
                error: "generation_task_not_found",
              });
        }
        if (req.method === "PUT") {
          const body = await readJson(req, 16 * 1024);
          if (Object.prototype.hasOwnProperty.call(body, "providerError"))
            return sendJson(res, 400, {
              error: "provider_error_is_server_managed",
              code: "provider_error_is_server_managed",
            });
          const existing = db
            .prepare(
              `${GENERATION_TASK_SELECT} WHERE g.provider=? AND g.task_id=?`,
            )
            .get(taskIdentity.provider, taskIdentity.taskId);
          const projectId = existing?.projectId || body?.projectId;
          return sendJson(
            res,
            200,
            upsertGenerationTask(db, taskIdentity, body),
          );
        }
      }
      if (req.method === "GET" && path === "/api/local/generation-tasks") {
        const projectId = String(url.searchParams.get("projectId") || "").slice(
          0,
          200,
        );
        const nodeId = String(url.searchParams.get("nodeId") || "").slice(
          0,
          200,
        );
        const status = String(url.searchParams.get("status") || "");
        const clauses = [];
        const params = [];
        if (projectId) {
          clauses.push("g.project_id=?");
          params.push(projectId);
        }
        if (nodeId) {
          clauses.push("g.node_id=?");
          params.push(nodeId);
        }
        if (status) {
          if (!GENERATION_TASK_STATUSES.has(status))
            return sendJson(res, 400, {
              error: "invalid_task_state",
            });
          clauses.push("g.status=?");
          params.push(status);
        }
        const rows = db
          .prepare(
            `${GENERATION_TASK_SELECT}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY g.updated_at DESC LIMIT 200`,
          )
          .all(...params);
        return sendJson(res, 200, {
          tasks: rows.map(presentGenerationTask),
        });
      }
      if (
        req.method === "POST" &&
        path === "/api/local/video-generation-takes/bootstrap"
      ) {
        const body = await readJson(req, 32 * 1024);
        return sendJson(res, 200, bootstrapVideoTake(db, dataRoot, body));
      }
      const takeCheckNowMatch =
        /^\/api\/local\/video-generation-takes\/([^/]+)\/check-now$/.exec(path);
      if (takeCheckNowMatch && req.method === "POST") {
        const takeId = decodeURIComponent(takeCheckNowMatch[1]);
        if (!/^take_[a-zA-Z0-9-]{8,100}$/.test(takeId))
          return sendJson(res, 400, {
            error: "invalid_video_take_id",
          });
        const row = db
          .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
          .get(takeId);
        if (!row)
          return sendJson(res, 404, {
            error: "video_take_not_found",
          });
        if (row.importedHistory)
          return sendJson(res, 409, {
            error: "迁入的视频历史为只读记录",
            code: "imported_history_read_only",
          });
        const attempt = db
          .prepare(`${PROVIDER_ATTEMPT_SELECT} WHERE a.take_id=?`)
          .get(takeId);
        if (
          !attempt?.taskId ||
          !["monitoring", "archive_pending"].includes(attempt.reconcileStatus)
        )
          return sendJson(res, 409, {
            error: "当前没有可立即查询的原供应商任务",
            code: "provider_task_check_unavailable",
          });
        const lastCheckedAt = Date.parse(String(attempt.lastCheckedAt || ""));
        if (
          Number.isFinite(lastCheckedAt) &&
          Date.now() - lastCheckedAt < 10_000
        )
          return sendJson(res, 200, {
            take: videoTakeRow(row),
            checked: false,
            throttled: true,
          });
        const subject = providerPollSubject(attempt.provider, attempt.takeId);
        writeProviderPollLog(db, "video_task.manual_poll_requested", subject, {
          provider: attempt.provider,
          model: attempt.model,
          providerSubmitted: true,
          chargeExpected: false,
        });
        await runProviderAttemptCheck(attempt);
        const checked = db
          .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
          .get(takeId);
        return sendJson(res, 200, {
          take: videoTakeRow(checked),
          checked: true,
          throttled: false,
        });
      }
      const takeReconcileNotFoundMatch =
        /^\/api\/local\/video-generation-takes\/([^/]+)\/reconcile-not-found$/.exec(
          path,
        );
      if (takeReconcileNotFoundMatch && req.method === "POST") {
        const takeId = decodeURIComponent(takeReconcileNotFoundMatch[1]);
        if (!/^take_[a-zA-Z0-9-]{8,100}$/.test(takeId))
          return sendJson(res, 400, {
            error: "invalid_video_take_id",
          });
        const row = db
          .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
          .get(takeId);
        if (!row)
          return sendJson(res, 404, {
            error: "video_take_not_found",
          });
        if (row.importedHistory)
          return sendJson(res, 409, {
            error: "迁入的视频历史为只读记录",
            code: "imported_history_read_only",
          });
        return sendJson(res, 200, closeProviderReconcileNotFound(db, takeId));
      }
      const takeReconcileMatch =
        /^\/api\/local\/video-generation-takes\/([^/]+)\/reconcile\/([^/]+)$/.exec(
          path,
        );
      if (takeReconcileMatch && req.method === "POST") {
        const takeId = decodeURIComponent(takeReconcileMatch[1]);
        const taskId = decodeURIComponent(takeReconcileMatch[2]);
        if (
          !/^take_[a-zA-Z0-9-]{8,100}$/.test(takeId) ||
          !/^cgt-[a-zA-Z0-9_-]{3,180}$/.test(taskId)
        )
          return sendJson(res, 400, {
            error: "invalid_reconcile_candidate",
          });
        const row = db
          .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
          .get(takeId);
        if (!row)
          return sendJson(res, 404, {
            error: "video_take_not_found",
          });
        if (row.importedHistory)
          return sendJson(res, 409, {
            error: "迁入的视频历史为只读记录",
            code: "imported_history_read_only",
          });
        return sendJson(
          res,
          200,
          selectProviderReconcileCandidate(db, takeId, taskId),
        );
      }
      const takeAdoptMatch =
        /^\/api\/local\/video-generation-takes\/([^/]+)\/adopt$/.exec(path);
      if (takeAdoptMatch && req.method === "POST") {
        const takeId = decodeURIComponent(takeAdoptMatch[1]);
        if (!/^take_[a-zA-Z0-9-]{8,100}$/.test(takeId))
          return sendJson(res, 400, {
            error: "invalid_video_take_id",
          });
        const row = db
          .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
          .get(takeId);
        if (!row)
          return sendJson(res, 404, {
            error: "video_take_not_found",
          });
        if (row.importedHistory)
          return sendJson(res, 409, {
            error: "迁入的视频历史为只读记录",
            code: "imported_history_read_only",
          });
        return sendJson(res, 200, {
          take: adoptVideoTake(db, dataRoot, takeId),
          activeTakeId: takeId,
        });
      }
      const takeId = videoTakeIdentity(path);
      if (takeId) {
        const row = db
          .prepare(`${VIDEO_TAKE_SELECT} WHERE take_id=?`)
          .get(takeId);
        if (req.method === "GET") {
          return row
            ? sendJson(res, 200, videoTakeRow(row))
            : sendJson(res, 404, {
                error: "video_take_not_found",
              });
        }
        if (req.method === "PUT") {
          if (!row)
            return sendJson(res, 404, {
              error: "video_take_not_found",
            });
          if (row.importedHistory)
            return sendJson(res, 409, {
              error: "迁入的视频历史为只读记录",
              code: "imported_history_read_only",
            });
          return sendJson(
            res,
            200,
            updateVideoTake(
              db,
              dataRoot,
              takeId,
              await readJson(req, 32 * 1024),
            ),
          );
        }
      }
      if (path === "/api/local/video-generation-takes") {
        if (req.method === "POST") {
          const body = await readJson(req, 32 * 1024);
          return sendJson(res, 201, createVideoTake(db, body));
        }
        if (req.method === "GET") {
          const owner = videoTakeOwner({
            projectId: url.searchParams.get("projectId"),
            nodeId: url.searchParams.get("nodeId"),
          });
          const rows = db
            .prepare(
              `${VIDEO_TAKE_SELECT} WHERE project_id=? AND node_id=? ORDER BY created_at ASC,take_id ASC`,
            )
            .all(owner.projectId, owner.nodeId);
          const activeTakeId =
            db
              .prepare(
                "SELECT active_take_id AS activeTakeId FROM video_node_history WHERE project_id=? AND node_id=?",
              )
              .get(owner.projectId, owner.nodeId)?.activeTakeId || null;
          const counts = {
            completed: 0,
            pending: 0,
            unknown: 0,
            failed: 0,
          };
          for (const row of rows) {
            if (row.status === "completed") counts.completed += 1;
            else if (row.status === "failed") counts.failed += 1;
            else if (row.status === "submission_unknown") counts.unknown += 1;
            else counts.pending += 1;
          }
          return sendJson(res, 200, {
            takes: rows.map(videoTakeRow),
            activeTakeId,
            counts,
          });
        }
      }
      if (req.method === "POST" && path === "/api/local/media/prepare-video") {
        const body = await readJson(req, 16 * 1024);
        return sendJson(
          res,
          200,
          await backgroundJobs.run(() =>
            mediaJobs.run(() =>
              prepareVideoPlayback(
                db,
                dataRoot,
                body,
                maxFastStartBytes,
                videoFastStartRunner,
                videoProbeRunner,
                videoPreviewRunner,
              ),
            ),
          ),
        );
      }
      if (req.method === "POST" && path === "/api/local/objects/import") {
        const body = await readJson(req, 64 * 1024);
        return sendJson(
          res,
          201,
          await backgroundJobs.run(() =>
            importRemoteObject(
              body,
              dataRoot,
              db,
              remoteObjectHosts,
              remoteImportPolicy,
            ),
          ),
        );
      }
      if (req.method === "POST" && path === "/api/local/objects") {
        const purpose = String(url.searchParams.get("purpose") || "");
        if (purpose)
          return sendJson(res, 400, {
            error: "对象写入用途无效",
            code: "object_purpose_invalid",
          });
        return sendJson(
          res,
          201,
          await receiveObject(
            req,
            dataRoot,
            db,
            url.searchParams.get("alias") || "",
          ),
        );
      }
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        path.startsWith("/api/local/video-objects/")
      ) {
        const hash = hashFromId(
          db,
          path.slice("/api/local/video-objects/".length),
        );
        const file = hash ? objectPath(dataRoot, hash) : "";
        const authorized = hash
          ? db
              .prepare(
                "SELECT 1 AS ok FROM media_derivative WHERE target_hash=? UNION SELECT 1 AS ok FROM video_generation_take WHERE hash=? LIMIT 1",
              )
              .get(hash, hash)?.ok
          : false;
        const accel =
          mediaDirectPrefix && hash
            ? `${mediaDirectPrefix}/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`
            : "";
        return authorized && file && existsSync(file)
          ? sendObject(req, res, file, "video/mp4", accel)
          : sendJson(res, 404, {
              error: "object_not_found",
            });
      }
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        path.startsWith("/api/local/objects/")
      ) {
        const hash = hashFromId(db, path.slice("/api/local/objects/".length));
        const file = hash ? objectPath(dataRoot, hash) : "";
        return file && existsSync(file)
          ? sendObject(req, res, file, url.searchParams.get("mime"))
          : sendJson(res, 404, {
              error: "object_not_found",
            });
      }
      if (req.method === "POST" && path === "/api/local/maintenance/backup") {
        const body = await readJson(req, 1024 * 1024);
        const candidate = basename(String(body.name || "")).replace(
          /[^a-zA-Z0-9._-]/g,
          "-",
        );
        const name = candidate.endsWith(".sqlite")
          ? candidate
          : `backup-${Date.now()}.sqlite`;
        const target = join(dataRoot, "backups", name);
        db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
        return sendJson(res, 201, {
          name,
          path: target,
        });
      }
      if (req.method === "GET" && path === "/api/local/updates/check") {
        const headers = {
          "user-agent": "infinite-canvas-local-platform",
        };
        const [versionResponse, changelogResponse] = await Promise.all([
          fetch(
            "https://raw.githubusercontent.com/zichen-aigc/narralight-personal/main/VERSION",
            {
              signal: AbortSignal.timeout(10000),
              headers,
            },
          ),
          fetch(
            "https://raw.githubusercontent.com/zichen-aigc/narralight-personal/main/CHANGELOG.md",
            {
              signal: AbortSignal.timeout(10000),
              headers,
            },
          ),
        ]);
        if (!versionResponse.ok)
          throw Object.assign(
            new Error(`上游版本检查失败：HTTP ${versionResponse.status}`),
            {
              status: 502,
            },
          );
        return sendJson(res, 200, {
          latestVersion: (await versionResponse.text()).trim(),
          changelog: changelogResponse.ok ? await changelogResponse.text() : "",
          autoUpdate: false,
          actionRequired: "user_decision",
          checkedAt: isoNow(),
        });
      }
      return sendJson(res, 404, {
        error: "not_found",
      });
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      return sendJson(res, Number(error?.status || 500), {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.code
          ? {
              code: error.code,
            }
          : {}),
        ...(error?.details
          ? {
              details: error.details,
            }
          : {}),
        ...(error?.providerError
          ? {
              providerError: error.providerError,
            }
          : {}),
        ...(error?.attempts
          ? {
              attempts: error.attempts,
            }
          : {}),
      });
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("listening", () => {
    if (reconcileIntervalMs) {
      reconcileStartupTimer = setTimeout(
        () => void runProviderReconciliation(),
        reconcileStartupDelayMs,
      );
      reconcileStartupTimer.unref?.();
      reconcileTimer = setInterval(
        () => void runProviderReconciliation(),
        reconcileIntervalMs,
      );
      reconcileTimer.unref?.();
    }
    if (volcAssetPollIntervalMs) {
      volcAssetPollStartupTimer = setTimeout(
        () => void runVolcAssetPolling(),
        volcAssetPollStartupDelayMs,
      );
      volcAssetPollStartupTimer.unref?.();
      volcAssetPollTimer = setInterval(
        () => void runVolcAssetPolling(),
        volcAssetPollIntervalMs,
      );
      volcAssetPollTimer.unref?.();
    }
  });
  server.on("close", () => {
    if (reconcileStartupTimer) clearTimeout(reconcileStartupTimer);
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (volcAssetPollStartupTimer) clearTimeout(volcAssetPollStartupTimer);
    if (volcAssetPollTimer) clearInterval(volcAssetPollTimer);
    for (const job of projectExportJobs.values()) {
      if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
      void job.abort?.();
    }
    for (const timer of projectImportSourceTimers.values()) clearTimeout(timer);
    volcAssetRelayManager.stopAll();
    db.close();
  });
  return {
    server,
    dataRoot,
    dbPath,
    host,
    runProviderReconciliation,
    runVolcAssetPolling,
    localH3Worker,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const instance = createLocalPlatformServer();
  const port = Number(process.env.INFINITE_CANVAS_PLATFORM_PORT || 17372);
  instance.server.listen(port, instance.host, () => {
    console.log(`[local-platform] http://${instance.host}:${port}`);
    console.log(`[local-platform] data ${instance.dataRoot}`);
  });
}
