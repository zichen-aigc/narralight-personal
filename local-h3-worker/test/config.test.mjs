import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertComfyLoopback, assertSecureServerUrl, loadConfig } from "../src/config.mjs";

test("network boundary rejects LAN HTTP and non-loopback ComfyUI", () => {
  assert.throws(() => assertSecureServerUrl("http://192.0.2.10:3003"), { code: "server_tls_required" });
  assert.equal(assertSecureServerUrl("https://192.0.2.10:3443"), "https://192.0.2.10:3443");
  assert.throws(() => assertSecureServerUrl("https://192.0.2.10:3443/base"), { code: "server_url_invalid" });
  assert.throws(() => assertComfyLoopback("http://0.0.0.0:8188"), { code: "comfy_url_not_loopback" });
  assert.throws(() => assertComfyLoopback("http://192.0.2.11:8188"), { code: "comfy_url_not_loopback" });
  assert.equal(assertComfyLoopback("http://127.0.0.1:8188"), "http://127.0.0.1:8188");
});

test("config resolves CA and state paths without storing secrets", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "h3-worker-config-"));
  const filename = path.join(dir, "config.json");
  await writeFile(filename, JSON.stringify({
    serverBaseUrl: "https://192.0.2.10:3443",
    serverCaPath: "certs/example.pem",
    comfyBaseUrl: "http://127.0.0.1:8188",
    workflowPath: "workflow.json",
    workflowSha256: "3d177045457dc8191f4ad646c4b61fa4d8531c182c5f281d160a7a3f0055bb47",
  }));
  const config = await loadConfig(filename, { requireIdentity: false });
  assert.equal(config.serverCaPath, path.join(dir, "certs/example.pem"));
  assert.equal(config.privateKeyDpapiPath, path.join(dir, "data/worker-key.dpapi"));
  assert.equal("pairingCode" in config, false);
});

test("config loading refuses a process with TLS verification disabled", async () => {
  const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    await assert.rejects(() => loadConfig("does-not-matter.json", { requireIdentity: false }), { code: "tls_verification_disabled" });
  } finally {
    if (original === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
  }
});
