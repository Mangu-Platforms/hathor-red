import { intelService } from './olympus';

// Batched player telemetry (Olympus M5). Events queue locally and flush every
// FLUSH_MS or when the tab hides; each carries a clientEventId so server-side
// dedup makes retries free. Telemetry must never break playback — every path
// swallows errors.

const FLUSH_MS = 15000;
const MAX_QUEUE = 200;

let queue = [];
let timer = null;
let flushing = false;

function eventId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().slice(0, 36);
  return `e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function recordEvent(type, song, positionSec, extra = {}) {
  if (!song?.id) return;
  queue.push({
    songId: song.id,
    type,
    positionMs: Math.max(0, Math.round((positionSec || 0) * 1000)),
    clientEventId: eventId(),
    ...extra,
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  ensureTimer();
}

export async function flushEvents() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, 100);
  try {
    await intelService.sendEvents(batch);
  } catch (err) {
    // Requeue once; dedup on the server makes eventual double-sends harmless.
    queue = batch.concat(queue).slice(0, MAX_QUEUE);
  } finally {
    flushing = false;
  }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(flushEvents, FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvents();
  });
}
