import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkerKeyPair, verifySignedRequest } from "../src/crypto-auth.mjs";
import { NarralightWorkerClient } from "../src/server-client.mjs";

test("client signs the frozen claim route and exact JSON bytes", async () => {
  const keys = generateWorkerKeyPair();
  let observed;
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return new Response(null, { status: 204 });
  };
  const client = new NarralightWorkerClient({
    baseUrl: "https://192.0.2.10:3443",
    workerId: "worker_test",
    privateKeyPem: keys.privateKeyPem,
    requestTimeoutMs: 1000,
    fetchImpl,
    now: () => 1_792_530_000_000,
    nonce: () => "nonce-fixed",
  });
  assert.equal(await client.claim(25), null);
  const headers = observed.options.headers;
  assert.equal(observed.url.pathname + observed.url.search, "/api/local/worker/v1/jobs/claim?wait=25");
  assert.equal(verifySignedRequest({
    publicKey: keys.publicKey,
    signatureBase64: headers["X-Narralight-Worker-Signature"],
    workerId: headers["X-Narralight-Worker-Id"],
    timestamp: headers["X-Narralight-Worker-Timestamp"],
    nonce: headers["X-Narralight-Worker-Nonce"],
    method: observed.options.method,
    pathnameWithQuery: observed.url.pathname + observed.url.search,
    body: Buffer.alloc(0),
  }), true);
});

test("chunk upload carries lease, range and chunk hash headers", async () => {
  const keys = generateWorkerKeyPair();
  let observed;
  const client = new NarralightWorkerClient({
    baseUrl: "https://example.invalid",
    workerId: "worker_test",
    privateKeyPem: keys.privateKeyPem,
    requestTimeoutMs: 1000,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return Response.json({ receivedBytes: 4 });
    },
  });
  await client.uploadChunk("up_1", { leaseId: "lease_1", chunk: Buffer.from("test"), start: 0, end: 3, total: 10 });
  assert.equal(observed.options.headers["X-Narralight-Lease-Id"], "lease_1");
  assert.equal(observed.options.headers["Content-Range"], "bytes 0-3/10");
  assert.equal(observed.options.headers["X-Chunk-SHA256"], "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
});

test("recovery queries the original job id without claiming or mutating it", async () => {
  const keys = generateWorkerKeyPair();
  let observed;
  const client = new NarralightWorkerClient({
    baseUrl: "https://example.invalid",
    workerId: "worker_test",
    privateKeyPem: keys.privateKeyPem,
    requestTimeoutMs: 1000,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return Response.json({ job: { jobId: "h3job-12345678", state: "completed" } });
    },
  });
  const result = await client.getWorkerJob("h3job-12345678");
  assert.equal(result.job.state, "completed");
  assert.equal(observed.options.method, "GET");
  assert.equal(observed.url.pathname, "/api/local/worker/v1/jobs/h3job-12345678");
  assert.equal(observed.options.body, undefined);
});
