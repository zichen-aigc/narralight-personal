import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRequest, generateWorkerKeyPair, signedHeaders, verifySignedRequest } from "../src/crypto-auth.mjs";

test("Ed25519 canonical request matches the server v1 contract", () => {
  const body = Buffer.from('{"a":1}', "utf8");
  const canonical = canonicalRequest({
    workerId: "worker_test",
    timestamp: "1792530000",
    nonce: "nonce-1",
    method: "post",
    pathnameWithQuery: "/api/local/worker/v1/jobs/claim?wait=25",
    body,
  });
  assert.equal(canonical, [
    "v1",
    "worker_test",
    "1792530000",
    "nonce-1",
    "POST",
    "/api/local/worker/v1/jobs/claim?wait=25",
    "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
  ].join("\n"));
});

test("signed headers verify and bind method, path, body, time, and nonce", () => {
  const keys = generateWorkerKeyPair();
  const body = Buffer.from("chunk");
  const headers = signedHeaders({
    workerId: "worker_test",
    privateKeyPem: keys.privateKeyPem,
    method: "PATCH",
    pathnameWithQuery: "/api/local/worker/v1/uploads/up_1",
    body,
    now: 1_792_530_000_000,
    nonce: "nonce-fixed",
  });
  assert.equal(headers["X-Narralight-Worker-Timestamp"], "1792530000");
  assert.equal(verifySignedRequest({
    publicKey: keys.publicKey,
    signatureBase64: headers["X-Narralight-Worker-Signature"],
    workerId: headers["X-Narralight-Worker-Id"],
    timestamp: headers["X-Narralight-Worker-Timestamp"],
    nonce: headers["X-Narralight-Worker-Nonce"],
    method: "PATCH",
    pathnameWithQuery: "/api/local/worker/v1/uploads/up_1",
    body,
  }), true);
  assert.equal(verifySignedRequest({
    publicKey: keys.publicKey,
    signatureBase64: headers["X-Narralight-Worker-Signature"],
    workerId: "worker_test",
    timestamp: "1792530000",
    nonce: "nonce-fixed",
    method: "PATCH",
    pathnameWithQuery: "/api/local/worker/v1/uploads/up_2",
    body,
  }), false);
});
