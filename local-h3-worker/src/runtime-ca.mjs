import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { WorkerError } from "./errors.mjs";

export function needsCaReexec(config, env = process.env) {
  if (!config.serverCaPath) return false;
  return env.NARRALIGHT_H3_WORKER_CA_READY !== config.serverCaPath
    || env.NODE_EXTRA_CA_CERTS !== config.serverCaPath;
}

export async function reexecWithConfiguredCa(config, argv = process.argv.slice(1), env = process.env) {
  if (!config.serverCaPath || !needsCaReexec(config, env)) return null;
  try {
    await access(config.serverCaPath);
  } catch (error) {
    throw new WorkerError("server_ca_unreadable", `Configured server CA file is not readable: ${config.serverCaPath}`, { cause: error });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...env,
        NODE_EXTRA_CA_CERTS: config.serverCaPath,
        NARRALIGHT_H3_WORKER_CA_READY: config.serverCaPath,
      },
    });
    child.on("error", (error) => reject(new WorkerError("server_ca_reexec_failed", "Could not restart worker with the configured CA", { cause: error })));
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}
