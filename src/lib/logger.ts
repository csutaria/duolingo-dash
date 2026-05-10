export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function defaultLevel(): LogLevel {
  return process.env.NODE_ENV === "development" ? "debug" : "info";
}

export function getLogLevel(raw = process.env.LOG_LEVEL): LogLevel {
  const value = raw?.trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error" || value === "silent") {
    return value;
  }
  return defaultLevel();
}

export function shouldLog(level: Exclude<LogLevel, "silent">, configured = getLogLevel()): boolean {
  return LEVELS[level] >= LEVELS[configured];
}

function write(level: Exclude<LogLevel, "silent">, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const line = `[duolingo-dash] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    console[level](line, meta);
  } else {
    console[level](line);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
