type Level = 'info' | 'warn' | 'error' | 'debug';

function emit(level: Level, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') {
    console.error(line, meta ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(line, meta ?? '');
    return;
  }
  console.log(line, meta ?? '');
}

/**
 * Deliberately tiny: a single structured line per event. No request bodies and
 * no tokens are ever logged, so credentials cannot leak into the console.
 */
export const logger = {
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', message, meta);
  },
};
