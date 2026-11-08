import { EventEmitter } from 'events';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class Logger extends EventEmitter {
  constructor(options = {}) {
    super();
    this.level = options.level || 'info';
    this.maxEntries = options.maxEntries || 200;
    this.ringBuffer = [];
    this.seq = 0;
    this.consoleOutput = options.consoleOutput !== false;
  }

  setLevel(level) {
    if (level in LOG_LEVELS) {
      this.level = level;
    }
  }

  setConsoleOutput(enabled) {
    this.consoleOutput = Boolean(enabled);
  }

  shouldLog(level) {
    return (LOG_LEVELS[level] ?? 1) >= (LOG_LEVELS[this.level] ?? 1);
  }

  _record(level, message, meta = null) {
    this.seq += 1;
    const entry = {
      seq: this.seq,
      ts: new Date().toISOString(),
      level,
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      meta
    };

    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxEntries) {
      this.ringBuffer.shift();
    }

    if (this.shouldLog(level)) {
      this.emit('log', entry);
      this.emit('entry', entry);
      this.emit(level, entry);

      if (this.consoleOutput) {
        const timeStr = entry.ts.slice(11, 19);
        const levelStr = entry.level.toUpperCase().padEnd(5);
        const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
        console.error(`[${timeStr}] [${levelStr}] ${entry.message}${metaStr}`);
      }
    }

    return entry;
  }

  debug(message, meta) {
    return this._record('debug', message, meta);
  }

  info(message, meta) {
    return this._record('info', message, meta);
  }

  warn(message, meta) {
    return this._record('warn', message, meta);
  }

  error(message, meta) {
    return this._record('error', message, meta);
  }

  task(taskId, message, meta) {
    const entry = this._record('info', `[Task ${taskId}] ${message}`, { taskId, ...meta });
    this.emit('task', {
      taskId,
      ts: entry.ts,
      message,
      meta
    });
    return entry;
  }

  getLogs(since = 0) {
    const sinceNum = Number(since) || 0;
    const entries = this.ringBuffer.filter(e => e.seq > sinceNum);
    return {
      entries,
      next: this.seq
    };
  }

  clear() {
    this.ringBuffer = [];
  }
}

export const logger = new Logger();
export default logger;
