export class WorkerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "WorkerError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.uncertain = Boolean(options.uncertain);
    this.status = options.status ?? null;
  }
}

export class ApiError extends WorkerError {
  constructor(status, code, message, details = null) {
    super(code || `http_${status}`, message || `HTTP ${status}`, { status, retryable: status >= 500 });
    this.name = "ApiError";
    this.details = details;
  }
}

export function errorSummary(error) {
  if (error instanceof WorkerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      uncertain: error.uncertain,
      status: error.status,
    };
  }
  return {
    code: "worker_unexpected_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    uncertain: false,
    status: null,
  };
}
