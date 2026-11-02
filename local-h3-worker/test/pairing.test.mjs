import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pair } from "../src/cli.mjs";
import { WorkerError } from "../src/errors.mjs";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "h3-worker-pair-"));
  const configPath = path.join(dir, "config.json");
  const privateKeyDpapiPath = path.join(dir, "worker-key.dpapi");
  await writeFile(configPath, "{}\n", "utf8");
  return {
    dir,
    config: {
      configPath,
      displayName: "test worker",
      workerId: null,
      serverBaseUrl: "https://example.invalid",
      workflowSha256: "a".repeat(64),
      privateKeyDpapiPath,
      requestTimeoutMs: 1000,
    },
  };
}

test("definite server rejection removes only the staged key and permits a clean retry", { skip: process.platform !== "win32" }, async () => {
  const { config, dir } = await fixture();
  await assert.rejects(() => pair(config, {
    pairingCode: "test-code",
    server: { async pair() { throw new WorkerError("pair_rejected", "rejected"); } },
  }), { code: "pair_rejected" });

  await assert.rejects(() => access(config.privateKeyDpapiPath));
  await assert.rejects(() => access(`${config.privateKeyDpapiPath}.pairing.json`));
  assert.equal((await readdir(dir)).some((name) => name.includes(".pending-")), false);

  await pair(config, {
    pairingCode: "valid-code",
    server: { async pair(payload) { return { workerId: payload.workerId }; } },
  });
  await access(config.privateKeyDpapiPath);
  assert.match(JSON.parse(await readFile(config.configPath, "utf8")).workerId, /^worker_/);
});

test("server success followed by local config failure never deletes the accepted key", { skip: process.platform !== "win32" }, async () => {
  const { config } = await fixture();
  await assert.rejects(() => pair(config, {
    pairingCode: "test-code",
    server: { async pair(payload) { return { workerId: payload.workerId }; } },
    saveIdentityImpl: async () => { throw new WorkerError("config_write_failed", "disk failure"); },
  }), { code: "config_write_failed" });

  await access(config.privateKeyDpapiPath);
  const state = JSON.parse(await readFile(`${config.privateKeyDpapiPath}.pairing.json`, "utf8"));
  assert.equal(state.outcome, "accepted");
  assert.equal(state.targetKeyPath, config.privateKeyDpapiPath);
});

test("an existing formal identity is never overwritten by pair", { skip: process.platform !== "win32" }, async () => {
  const { config } = await fixture();
  config.workerId = "worker_existing";
  await writeFile(config.privateKeyDpapiPath, "old-identity", "ascii");
  let contacted = false;
  await assert.rejects(() => pair(config, {
    pairingCode: "test-code",
    server: { async pair() { contacted = true; } },
  }), { code: "worker_already_paired" });
  assert.equal(contacted, false);
  assert.equal(await readFile(config.privateKeyDpapiPath, "ascii"), "old-identity");
});
