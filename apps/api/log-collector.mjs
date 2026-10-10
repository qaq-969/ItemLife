import dgram from 'node:dgram';
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const logDir = process.env.LOG_DIR || '/logs';
const port = Number(process.env.LOG_PORT || 15140);
const maxBytes = Number(process.env.LOG_MAX_BYTES || 20 * 1024 * 1024);
const retentionDays = Number(process.env.LOG_RETENTION_DAYS || 30);
const flushIntervalMs = Number(process.env.LOG_FLUSH_INTERVAL_MS || 12 * 60 * 60 * 1000);
const timeZone = process.env.TZ || 'Asia/Shanghai';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

mkdirSync(logDir, { recursive: true });

let currentDay = '';
let currentPart = 0;
let currentPath = '';
let currentSize = 0;
let lastCleanupAt = 0;
let bufferedBytes = 0;
let bufferedLines = [];
let stopping = false;

function dayKey(date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function selectTarget(day) {
  const pattern = new RegExp(`^itemlife-${day}\\.(\\d+)\\.log$`);
  const parts = readdirSync(logDir)
    .map((name) => pattern.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  currentDay = day;
  currentPart = parts.length ? Math.max(...parts) : 0;
  currentPath = join(logDir, `itemlife-${day}.${currentPart}.log`);
  currentSize = statSync(currentPath, { throwIfNoEntry: false })?.size ?? 0;
  if (currentSize >= maxBytes) rotate();
}

function rotate() {
  currentPart += 1;
  currentPath = join(logDir, `itemlife-${currentDay}.${currentPart}.log`);
  currentSize = 0;
}

function cleanup(now) {
  if (now - lastCleanupAt < 60 * 60 * 1000) return;
  lastCleanupAt = now;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(logDir)) {
    if (!/^itemlife-\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(name)) continue;
    const path = join(logDir, name);
    if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
  }
}

function flush() {
  if (bufferedLines.length === 0) return;
  const pending = bufferedLines;
  bufferedLines = [];
  bufferedBytes = 0;
  for (const { day, line, bytes } of pending) {
    if (day !== currentDay) selectTarget(day);
    if (currentSize + bytes > maxBytes) rotate();
    appendFileSync(currentPath, line);
    currentSize += bytes;
  }
  cleanup(Date.now());
}

const server = dgram.createSocket('udp4');

server.on('message', (message, remote) => {
  const now = new Date();
  const day = dayKey(now);
  const line = `${now.toISOString()} ${remote.address} ${message.toString('utf8').replace(/[\r\n]+/g, '\\n')}\n`;
  const bytes = Buffer.byteLength(line);
  bufferedLines.push({ day, line, bytes });
  bufferedBytes += bytes;
  if (bufferedBytes >= maxBytes) flush();
});

server.on('error', (error) => {
  console.error(`[log-collector] ${error.stack || error.message}`);
});

server.bind(port, '0.0.0.0', () => {
  console.log(`[log-collector] UDP ${port} -> ${logDir}（每 ${flushIntervalMs}ms 或 ${maxBytes} bytes 落盘，保留 ${retentionDays} 天）`);
});

const flushTimer = setInterval(flush, flushIntervalMs);
flushTimer.unref();

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(flushTimer);
  server.close(() => {
    try {
      flush();
      process.exit(0);
    } catch (error) {
      console.error(`[log-collector] 关闭前落盘失败：${error.stack || error.message}`);
      process.exit(1);
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
