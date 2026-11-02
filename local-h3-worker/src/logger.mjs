const SENSITIVE_KEY = /(authorization|cookie|secret|token|signature|private|pairing|prompt)/i;

export function redact(value, depth = 0) {
  if (depth > 5) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1),
    ]));
  }
  return value;
}

export function createLogger({ sink = console, component = "local-h3-worker" } = {}) {
  const write = (level, event, fields = {}) => {
    const record = redact({
      ts: new Date().toISOString(),
      level,
      component,
      event,
      ...fields,
    });
    const line = JSON.stringify(record);
    if (level === "error") sink.error(line);
    else if (level === "warn") sink.warn(line);
    else sink.log(line);
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
