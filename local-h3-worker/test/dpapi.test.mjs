import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPrivateKey, protectPrivateKeyToFile } from "../src/crypto-auth.mjs";

test("Windows DPAPI protects and restores the worker private key for the current user", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "h3-worker-dpapi-"));
  const filename = path.join(dir, "worker-key.dpapi");
  const secret = "-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n";
  await protectPrivateKeyToFile(secret, filename);
  const restored = await loadPrivateKey({ privateKeyDpapiPath: filename });
  assert.equal(restored, secret);
});
