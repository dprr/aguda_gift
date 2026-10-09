/**
 * Request 11: a periodic run copies the university list into the local database.
 *
 * A timer inside the server process, not a second process (plan §0). The next run is
 * scheduled only after the current one finishes, so runs never overlap in one process;
 * the advisory lock in sync.ts stops overlap across processes. A failed run is logged and
 * the schedule continues, because the university connection can fail (plan §5.3).
 */
import type { StudentSource } from "./source.ts";
import { type SyncResult, syncStudents } from "./sync.ts";

export type ScheduleOptions = {
  source: StudentSource;
  minStudents: number;
  intervalMs: number;
  /** One line per run. The worker keeps no run table (plan §5.3), so this is the record. */
  log: (entry: { at: string; ms: number } & (SyncResult | { ok: false; reason: "error"; detail: string })) => void;
};

export function startSyncSchedule(options: ScheduleOptions): { stop(): Promise<void> } {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;

  const run = async () => {
    const start = performance.now();
    const at = new Date().toISOString();
    try {
      const result = await syncStudents(options.source, { minStudents: options.minStudents });
      options.log({ at, ms: Math.round(performance.now() - start), ...result });
    } catch (error) {
      options.log({ at, ms: Math.round(performance.now() - start), ok: false, reason: "error", detail: String(error) });
    }
  };

  const tick = () => {
    running = run().finally(() => {
      running = undefined;
      if (!stopped) timer = setTimeout(tick, options.intervalMs);
    });
  };

  tick(); // first run at once, so a fresh server is never empty until the first interval

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
