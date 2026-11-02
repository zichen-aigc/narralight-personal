import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { RECOVERABLE_STATES, TERMINAL_STATES } from "./constants.mjs";
import { WorkerError } from "./errors.mjs";

const COLUMNS = new Set([
  "lease_id",
  "state",
  "workflow_sha256",
  "contract_json",
  "prompt_original",
  "prompt_final",
  "compiler_id",
  "seed",
  "comfy_prompt_id",
  "output_path",
  "output_sha256",
  "output_bytes",
  "upload_id",
  "uploaded_bytes",
  "error_code",
  "error_message",
]);

export class WorkerLedger {
  constructor(filename) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_job (
        job_id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        state TEXT NOT NULL,
        workflow_sha256 TEXT NOT NULL,
        contract_json TEXT NOT NULL DEFAULT '{}',
        prompt_original TEXT NOT NULL,
        prompt_final TEXT,
        compiler_id TEXT,
        seed INTEGER,
        comfy_prompt_id TEXT,
        output_path TEXT,
        output_sha256 TEXT,
        output_bytes INTEGER,
        upload_id TEXT,
        uploaded_bytes INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(job_id) REFERENCES worker_job(job_id)
      );
    `);
    if (!this.db.prepare("PRAGMA table_info(worker_job)").all().some((column) => column.name === "contract_json")) {
      this.db.exec("ALTER TABLE worker_job ADD COLUMN contract_json TEXT NOT NULL DEFAULT '{}'");
    }
  }

  close() {
    this.db.close();
  }

  saveClaim(job) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO worker_job (
        job_id, lease_id, state, workflow_sha256, contract_json, prompt_original, prompt_final, seed, created_at, updated_at
      ) VALUES (?, ?, 'claimed', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        lease_id = excluded.lease_id,
        contract_json = excluded.contract_json,
        updated_at = excluded.updated_at
      WHERE worker_job.state NOT IN ('completed', 'failed', 'cancelled')
    `);
    stmt.run(
      job.jobId,
      job.leaseId,
      job.workflowSha256,
      JSON.stringify({ spec: job.spec, parameters: job.parameters, references: job.references || [] }),
      job.promptOriginalZh,
      job.promptFinal || null,
      job.seed ?? null,
      now,
      now,
    );
    return this.get(job.jobId);
  }

  get(jobId) {
    return this.db.prepare("SELECT * FROM worker_job WHERE job_id = ?").get(jobId) || null;
  }

  getOpenJobs() {
    return this.db.prepare("SELECT * FROM worker_job WHERE state NOT IN ('completed','failed','cancelled') ORDER BY created_at ASC").all();
  }

  update(jobId, expectedStates, patch) {
    const entries = Object.entries(patch).filter(([key]) => COLUMNS.has(key));
    if (!entries.length) throw new WorkerError("ledger_patch_empty", "Ledger update must change at least one field");
    const states = Array.isArray(expectedStates) ? expectedStates : [expectedStates];
    if (!states.length) throw new WorkerError("ledger_expected_state_missing", "Expected ledger state is required");
    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    const placeholders = states.map(() => "?").join(",");
    const result = this.db.prepare(`UPDATE worker_job SET ${assignments}, updated_at = ? WHERE job_id = ? AND state IN (${placeholders})`)
      .run(...entries.map(([, value]) => value), Date.now(), jobId, ...states);
    if (result.changes !== 1) {
      const current = this.get(jobId);
      throw new WorkerError("ledger_state_conflict", `Cannot update ${jobId} from ${current?.state || "missing"}`);
    }
    return this.get(jobId);
  }

  transition(jobId, expectedStates, state, patch = {}) {
    return this.update(jobId, expectedStates, { ...patch, state });
  }

  addEvent(jobId, eventId, state) {
    this.db.prepare("INSERT OR IGNORE INTO worker_event(job_id,event_id,state,created_at) VALUES(?,?,?,?)")
      .run(jobId, eventId, state, Date.now());
  }

  assertSingleActive() {
    const active = this.getOpenJobs();
    if (active.length > 1) {
      throw new WorkerError("ledger_multiple_active_jobs", `Worker ledger contains ${active.length} unfinished jobs`);
    }
    return active[0] || null;
  }

  static isTerminal(state) {
    return TERMINAL_STATES.has(state);
  }

  static isRecoverable(state) {
    return RECOVERABLE_STATES.has(state);
  }
}
