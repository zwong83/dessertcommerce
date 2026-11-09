import { setTimeout as delay } from "node:timers/promises";

export async function runWorker(
  poll: () => Promise<void>,
  signal: AbortSignal,
  intervalMs = 1_000,
) {
  while (!signal.aborted) {
    await poll();

    try {
      await delay(intervalMs, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
