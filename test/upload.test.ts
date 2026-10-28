// Request 54: a ceo uploads an updated student list, sees a preview, and applies it.
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { GoogleLogin } from "../src/auth.ts";
import { pool } from "../src/db.ts";
import { buildApp } from "../src/server.ts";
import { FakeSource, fakeStudents } from "../src/source.ts";
import { syncStudents } from "../src/sync.ts";
import { freshDatabase, student } from "./helpers.ts";

after(() => pool.end());

const ORIGIN = "http://localhost:3000";
const noGoogle: GoogleLogin = {
  start: async () => { throw new Error("not used"); },
  finish: async () => { throw new Error("not used"); },
};
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

/** A record in the university service's shape. */
const record = (id: number) => ({
  identityNumber: id, fName: "דנה", lName: `כהן${id}`, sex: "Female", hujiEmail: `s${id}@mail.huji.ac.il`,
  mobile: "0500000000", campousNameList: null, specialPopulationsList: null,
  motherFacultyCode: "002", motherFacultyName: "פקולטה למתמטיקה ולמדעי הטבע", faculty: "פקולטה למתמטיקה ולמדעי הטבע",
  facultyCode: "002", academicYear: "1", learningProgramCode: "001", learningProgramName: "בוגר", roadMaps: [],
});

/** A browser's multipart upload of one file. */
function upload(content: string, cookies: { session: string }) {
  const boundary = "----test-boundary";
  const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="students.json"\r\n` +
    `Content-Type: application/json\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return app.inject({
    method: "POST", url: "/manager/students/upload", cookies, payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
}
const form = (body: Record<string, string>) => ({
  payload: new URLSearchParams(body).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});
async function login(email: string) {
  const res = await app.inject({ method: "POST", url: "/auth/dev", ...form({ kind: "staff", email }) });
  return { session: res.cookies.find((c) => c.name === "session")!.value };
}
const updates = async () => (await pool.query("SELECT * FROM student_updates ORDER BY id")).rows;
const tokenOf = (html: string) => /name="token" value="([^"]+)"/.exec(html)?.[1];

beforeEach(async () => {
  await freshDatabase(5);
  await pool.query(`INSERT INTO staff (email, role, campus) VALUES
    ('chief@aguda.org.il', 'ceo', NULL), ('chief2@aguda.org.il', 'ceo', NULL),
    ('boss@aguda.org.il', 'manager', NULL), ('dana@aguda.org.il', 'worker', NULL)`);
  app = await buildApp({
    google: noGoogle, sessionSecret: "test-secret-test-secret-test-secret",
    domains: { student: ["mail.huji.ac.il"], staff: ["mail.huji.ac.il", "aguda.org.il"] },
    devLogin: true, production: false, origin: ORIGIN, syncMinStudents: 2,
  });
});

describe("the sync's counts and its history", () => {
  test("removed and restored are counted apart, and an upload is recorded", async () => {
    const all = fakeStudents(4);
    await syncStudents(new FakeSource(all), { minStudents: 0, origin: { source: "file" } });
    const left = await syncStudents(new FakeSource(all.slice(0, 3)), { minStudents: 0, origin: { source: "upload", by: "chief@aguda.org.il" } });
    assert.ok(left.ok && left.removed === 1 && left.restored === 0);
    const back = await syncStudents(new FakeSource(all), { minStudents: 0, origin: { source: "upload", by: "chief@aguda.org.il" } });
    assert.ok(back.ok && back.removed === 0 && back.restored === 1);
    const rows = await updates();
    assert.deepEqual(rows.map((r) => [r.source, r.added, r.removed, r.restored]), [["file", 4, 0, 0], ["upload", 0, 1, 0], ["upload", 0, 0, 1]]);
    assert.equal(rows[1].by_email, "chief@aguda.org.il");
  });

  test("a dry run computes the result and writes nothing", async () => {
    const result = await syncStudents(new FakeSource(fakeStudents(3)), { minStudents: 0, dryRun: true });
    assert.ok(result.ok && result.added === 3);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n, 0);
    assert.deepEqual(await updates(), []);
  });

  test("a scheduled run is recorded only when it changed something", async () => {
    const source = new FakeSource(fakeStudents(3));
    await syncStudents(source, { minStudents: 0 });
    await syncStudents(source, { minStudents: 0 });
    assert.deepEqual((await updates()).map((r) => r.source), ["schedule"]);
  });
});

describe("the update page", () => {
  test("upload, preview with no change, then apply; the history shows it", async () => {
    const ceo = await login("chief@aguda.org.il");
    const page = (await app.inject({ url: "/manager", cookies: ceo })).body;
    assert.match(page, /href="\/manager\/students"/);

    const preview = await upload(JSON.stringify([record(11), record(12), record(13), record(12)]), ceo);
    assert.match(preview.body, /תצוגה מקדימה: עדכון עדיין לא בוצע/);
    assert.match(preview.body, /<dt>סטודנטים ברשימה<\/dt><dd><bdi dir="ltr">3<\/bdi><\/dd><dt>סטודנטים חדשים<\/dt><dd><bdi dir="ltr">3<\/bdi>/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n, 0, "the preview changes nothing");

    const token = tokenOf(preview.body)!;
    const applied = await app.inject({ method: "POST", url: "/manager/students/apply", cookies: ceo, ...form({ token }) });
    assert.equal(applied.headers.location, "/manager/students?done=1");
    assert.equal((await student("12")).member, true);
    const history = (await app.inject({ url: "/manager/students?done=1", cookies: ceo })).body;
    assert.match(history, /עדכנו את רשימת הסטודנטים/);
    assert.match(history, /העלאה באתר<\/td><td><bdi dir="ltr">chief@aguda\.org\.il<\/bdi><\/td><td><bdi dir="ltr">3<\/bdi><\/td><td><bdi dir="ltr">3<\/bdi><\/td><td><bdi dir="ltr">0<\/bdi>/);

    const again = await app.inject({ method: "POST", url: "/manager/students/apply", cookies: ceo, ...form({ token }) });
    assert.match(again.body, /תוקף התצוגה המקדימה פג/, "a token works once");
  });

  test("the upload button works once, and a reload of the upload address returns to the page", async () => {
    const ceo = await login("chief@aguda.org.il");
    const page = (await app.inject({ url: "/manager/students", cookies: ceo })).body;
    assert.match(page, /onsubmit="const b = this.querySelector\('button'\); b.disabled = true;/);
    assert.match(page, /לחץ פעם אחת וחכה/);
    assert.equal((await app.inject({ url: "/manager/students/upload", cookies: ceo })).headers.location, "/manager/students");
  });

  test("a second upload previews the removed members", async () => {
    const ceo = await login("chief@aguda.org.il");
    await syncStudents({ fetchStudents: async () => [] }, { minStudents: 0 }); // no-op
    const first = await upload(JSON.stringify([record(11), record(12), record(13)]), ceo);
    await app.inject({ method: "POST", url: "/manager/students/apply", cookies: ceo, ...form({ token: tokenOf(first.body)! }) });
    const second = await upload(JSON.stringify([record(11), record(14)]), ceo);
    assert.match(second.body, /<dt>סטודנטים חדשים<\/dt><dd><bdi dir="ltr">1<\/bdi><\/dd><dt>יוסרו מהרשימה \(החברות תסתיים\)<\/dt><dd><bdi dir="ltr">2<\/bdi>/);
  });

  test("a broken file, a too-short list, and conflicting records are refused", async () => {
    const ceo = await login("chief@aguda.org.il");
    assert.match((await upload("{not json", ceo)).body, /אינו קובץ JSON תקין/);
    assert.match((await upload(JSON.stringify([record(11)]), ceo)).body, /פחות סטודנטים מהמינימום/);
    const conflict = [record(11), { ...record(11), mobile: "0511111111" }, record(12)];
    assert.match((await upload(JSON.stringify(conflict), ceo)).body, /הרשימה אינה תקינה, ולכן לא עדכנו דבר. \(1 national IDs have records with different personal details\)/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n, 0);
  });

  test("only the ceo who uploaded can apply; managers and workers are refused", async () => {
    const ceo = await login("chief@aguda.org.il");
    const token = tokenOf((await upload(JSON.stringify([record(11), record(12)]), ceo)).body)!;
    const other = await app.inject({ method: "POST", url: "/manager/students/apply", cookies: await login("chief2@aguda.org.il"), ...form({ token }) });
    assert.match(other.body, /תוקף התצוגה המקדימה פג/);
    for (const email of ["boss@aguda.org.il", "dana@aguda.org.il"]) {
      const cookies = await login(email);
      assert.equal((await app.inject({ url: "/manager/students", cookies })).statusCode, 403, email);
      assert.equal((await upload(JSON.stringify([record(11), record(12)]), cookies)).statusCode, 403, email);
      assert.equal((await app.inject({ method: "POST", url: "/manager/students/apply", cookies, ...form({ token }) })).statusCode, 403, email);
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n, 0);
  });
});
