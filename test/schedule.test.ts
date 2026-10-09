import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { pool } from "../src/db.ts";
import { startSyncSchedule } from "../src/schedule.ts";
import { FakeSource, fakeStudents, type StudentSource } from "../src/source.ts";
import { freshDatabase } from "./helpers.ts";

beforeEach(() => freshDatabase());
after(() => pool.end());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the first run happens at once, then it repeats on the interval", async () => {
  const log: { ok: boolean }[] = [];
  const schedule = startSyncSchedule({
    source: new FakeSource(fakeStudents(20)), minStudents: 0, intervalMs: 30, log: (e) => log.push(e),
  });
  await sleep(10);
  await schedule.stop();
  assert.equal(log.length, 1, "first run at once");

  const again = startSyncSchedule({
    source: new FakeSource(fakeStudents(20)), minStudents: 0, intervalMs: 30, log: (e) => log.push(e),
  });
  await sleep(150);
  await again.stop();
  assert.ok(log.length >= 4, `expected several runs, got ${log.length}`);
  assert.ok(log.every((e) => e.ok));
});

test("a failing source is logged, and the schedule keeps going", async () => {
  let calls = 0;
  const flaky: StudentSource = {
    async fetchStudents() {
      calls++;
      if (calls === 1) throw new Error("university unreachable");
      return fakeStudents(5);
    },
  };
  const log: { ok: boolean; reason?: string }[] = [];
  const schedule = startSyncSchedule({ source: flaky, minStudents: 0, intervalMs: 20, log: (e) => log.push(e) });
  await sleep(100);
  await schedule.stop();

  assert.equal(log[0].ok, false);
  assert.equal(log[0].reason, "error");
  assert.ok(log.slice(1).some((e) => e.ok), "a later run succeeds");
  const n = await pool.query("SELECT count(*)::int AS n FROM students");
  assert.equal(n.rows[0].n, 5);
});

test("runs never overlap, even when one is slower than the interval", async () => {
  let active = 0;
  let maxActive = 0;
  const slow: StudentSource = {
    async fetchStudents() {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(40);
      active--;
      return fakeStudents(5);
    },
  };
  const schedule = startSyncSchedule({ source: slow, minStudents: 0, intervalMs: 5, log: () => {} });
  await sleep(200);
  await schedule.stop();
  assert.equal(maxActive, 1);
});

test("stop waits for a run in progress, and no run starts afterwards", async () => {
  let calls = 0;
  const source: StudentSource = {
    async fetchStudents() {
      calls++;
      await sleep(30);
      return fakeStudents(5);
    },
  };
  const schedule = startSyncSchedule({ source, minStudents: 0, intervalMs: 10, log: () => {} });
  await sleep(5);
  await schedule.stop();
  const after = calls;
  await sleep(60);
  assert.equal(calls, after);
});
