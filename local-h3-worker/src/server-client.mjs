import { randomUUID } from "node:crypto";
import { ROUTES } from "./constants.mjs";
import { ApiError, WorkerError } from "./errors.mjs";
import { sha256Hex, signedHeaders } from "./crypto-auth.mjs";

async function parseResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(response.status, "response_json_invalid", "Server returned invalid JSON");
  }
}

export class NarralightWorkerClient {
  constructor({ baseUrl, workerId, privateKeyPem, requestTimeoutMs, fetchImpl = fetch, now = () => Date.now(), nonce = () => randomUUID() }) {
    this.baseUrl = baseUrl;
    this.workerId = workerId;
    this.privateKeyPem = privateKeyPem;
    this.requestTimeoutMs = requestTimeoutMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.nonce = nonce;
  }

  makeUrl(pathnameWithQuery) {
    return new URL(pathnameWithQuery, `${this.baseUrl}/`);
  }

  async request(method, pathnameWithQuery, { json, body, headers = {}, signed = true, timeoutMs, responseType = "json" } = {}) {
    if (json !== undefined && body !== undefined) {
      throw new WorkerError("request_body_conflict", "Use either json or body, not both");
    }
    const payload = json === undefined
      ? (body ? Buffer.from(body) : Buffer.alloc(0))
      : Buffer.from(JSON.stringify(json), "utf8");
    const url = this.makeUrl(pathnameWithQuery);
    const requestHeaders = { ...headers };
    if (json !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (signed) {
      Object.assign(requestHeaders, signedHeaders({
        workerId: this.workerId,
        privateKeyPem: this.privateKeyPem,
        method,
        pathnameWithQuery: `${url.pathname}${url.search}`,
        body: payload,
        now: this.now(),
        nonce: this.nonce(),
      }));
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: payload.length ? payload : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs ?? this.requestTimeoutMs),
      });
    } catch (error) {
      throw new WorkerError("server_request_uncertain", `Server request failed: ${method} ${url.pathname}`, {
        cause: error,
        retryable: true,
        uncertain: method !== "GET",
      });
    }
    const result = response.ok && responseType === "buffer" ? Buffer.from(await response.arrayBuffer()) : await parseResponse(response);
    if (!response.ok) {
      throw new ApiError(
        response.status,
        result?.error?.code || result?.code || `http_${response.status}`,
        result?.error?.message || result?.message || `Server returned HTTP ${response.status}`,
        result,
      );
    }
    return result;
  }

  pair(payload) {
    return this.request("POST", ROUTES.pair, { json: payload, signed: false });
  }

  heartbeat({ workflowSha256, currentJobId = null }) {
    return this.request("POST", ROUTES.heartbeat, {
      json: { capabilities: { workflowSha256, maxActive: 1 }, currentJobId },
    });
  }

  async claim(waitSeconds) {
    const result = await this.request("POST", `${ROUTES.claim}?wait=${encodeURIComponent(waitSeconds)}`, { timeoutMs: (waitSeconds + 10) * 1000 });
    return result?.job || null;
  }

  getWorkerJob(jobId) {
    return this.request("GET", ROUTES.jobRecovery(jobId));
  }

  downloadReference(jobId, role) {
    return this.request("GET", ROUTES.jobReference(jobId, role), { responseType: "buffer", timeoutMs: 2 * 60_000 });
  }

  renewLease(jobId, payload) {
    return this.request("POST", ROUTES.jobLease(jobId), { json: payload });
  }

  beginUpload(jobId, payload) {
    return this.request("POST", ROUTES.jobUploads(jobId), { json: payload });
  }

  getUpload(uploadId) {
    return this.request("GET", ROUTES.upload(uploadId));
  }

  uploadChunk(uploadId, { leaseId, chunk, start, end, total }) {
    return this.request("PATCH", ROUTES.upload(uploadId), {
      body: chunk,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "X-Chunk-SHA256": sha256Hex(chunk),
        "X-Narralight-Lease-Id": leaseId,
      },
    });
  }

  completeUpload(uploadId, leaseId) {
    return this.request("POST", ROUTES.uploadComplete(uploadId), { json: { leaseId } });
  }

  terminal(jobId, payload) {
    return this.request("POST", ROUTES.jobTerminal(jobId), { json: payload });
  }
}
