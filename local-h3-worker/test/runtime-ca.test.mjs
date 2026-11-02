import test from "node:test";
import assert from "node:assert/strict";
import { needsCaReexec } from "../src/runtime-ca.mjs";

test("custom CA requires a clean process re-exec and never disables TLS verification", () => {
  const config = { serverCaPath: "C:\\certs\\example.pem" };
  assert.equal(needsCaReexec(config, {}), true);
  assert.equal(needsCaReexec(config, {
    NODE_EXTRA_CA_CERTS: config.serverCaPath,
    NARRALIGHT_H3_WORKER_CA_READY: config.serverCaPath,
  }), false);
});
