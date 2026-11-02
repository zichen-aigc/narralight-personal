export const WORKER_API_PREFIX = "/api/local/worker/v1";

export const ROUTES = Object.freeze({
  pair: `${WORKER_API_PREFIX}/pair`,
  heartbeat: `${WORKER_API_PREFIX}/heartbeat`,
  claim: `${WORKER_API_PREFIX}/jobs/claim`,
  jobRecovery: (jobId) => `${WORKER_API_PREFIX}/jobs/${encodeURIComponent(jobId)}`,
  jobLease: (jobId) => `${WORKER_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/lease`,
  jobReference: (jobId, role) => `${WORKER_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/references/${encodeURIComponent(role)}`,
  jobUploads: (jobId) => `${WORKER_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/uploads`,
  jobTerminal: (jobId) => `${WORKER_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/terminal`,
  upload: (uploadId) => `${WORKER_API_PREFIX}/uploads/${encodeURIComponent(uploadId)}`,
  uploadComplete: (uploadId) => `${WORKER_API_PREFIX}/uploads/${encodeURIComponent(uploadId)}/complete`,
});

export const FIXED_SPEC = Object.freeze({
  model: "MiniMax H3 Base FL2VA",
  provider: "local-h3",
  width: 864,
  height: 480,
  frames: 124,
  fps: 24,
  durationSeconds: 124 / 24,
  videoCodec: "h264",
  audioCodec: "aac",
  audioSampleRate: 32000,
  audioChannels: 2,
});
export const ALLOWED_PROFILES = Object.freeze([
  Object.freeze({ resolution: "864x480", aspectRatio: "16:9", width: 864, height: 480 }),
  Object.freeze({ resolution: "480x864", aspectRatio: "9:16", width: 480, height: 864 }),
  Object.freeze({ resolution: "640x640", aspectRatio: "1:1", width: 640, height: 640 }),
]);
export const ALLOWED_DURATIONS = Object.freeze([
  Object.freeze({ duration: 5, frames: 124 }),
  Object.freeze({ duration: 10, frames: 243 }),
]);

export const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
export const RECOVERABLE_STATES = new Set([
  "claimed",
  "compiling",
  "submission_intent",
  "submitted",
  "running",
  "rendered",
  "uploading",
  "verifying",
  "recovery_pending",
]);

export const DEFAULTS = Object.freeze({
  claimWaitSeconds: 25,
  idleDelayMs: 2_000,
  comfyPollMs: 2_000,
  cancelConfirmTimeoutMs: 60_000,
  leaseRenewMs: 15_000,
  requestTimeoutMs: 35_000,
  uploadChunkBytes: 4 * 1024 * 1024,
});
