// Request 27: the university's AgudaStudents service.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { pool } from "../src/db.ts";
import { syncStudents } from "../src/sync.ts";
import { parseUniversity, problemStudents, type UniversityRecord, UniversitySource } from "../src/university.ts";
import { freshDatabase, student } from "./helpers.ts";

beforeEach(() => freshDatabase());
after(() => pool.end());

/** A record in the service's own shape, with invented values. */
const record = (over: Partial<UniversityRecord> = {}): UniversityRecord => ({
  identityNumber: 123456782,
  fName: "דנה",
  lName: " כהן",
  sex: "Female",
  hujiEmail: "Dana.Cohen@mail.huji.ac.il",
  mobile: "0500000000",
  campousNameList: "אדמונד י' ספרא,הר הצופים",
  specialPopulationsList: "לא אוכלוסייה מיוחדת",
  motherFacultyCode: "002",
  motherFacultyName: "פקולטה למתמטיקה ולמדעי הטבע",
  faculty: "פקולטה למתמטיקה ולמדעי הטבע",
  facultyCode: "002",
  academicYear: "1",
  learningProgramCode: "001",
  learningProgramName: "בוגר",
  roadMaps: [{ roadMapCode: "570-4010", roadMapName: "מדעי החיים, חד-חוגי" }],
  ...over,
});

test("one record becomes one student, cleaned, with sorted campuses", () => {
  const [s] = parseUniversity([record()]);
  assert.equal(s.national_id, "123456782");
  assert.equal(s.university_email, "dana.cohen@mail.huji.ac.il");
  assert.equal(s.last_name, "כהן", "trimmed");
  assert.equal(s.gender, "Female");
  assert.deepEqual(s.campuses, ["אדמונד י' ספרא", "הר הצופים"]);
  assert.equal(s.programs.length, 1);
  assert.equal(s.programs[0].learningProgramName, "בוגר");
});

test("records of one student with the same details merge, keeping every program", () => {
  const students = parseUniversity([
    record(),
    record({ faculty: "ביה\"ס לתלמידי חו\"ל", facultyCode: "020", campousNameList: "הר הצופים,אדמונד י' ספרא" }),
    record({ identityNumber: 111111118, hujiEmail: "other@mail.huji.ac.il" }),
  ]);
  assert.equal(students.length, 2);
  const merged = students.find((s) => s.national_id === "123456782")!;
  assert.deepEqual(merged.programs.map((p) => p.facultyCode).sort(), ["002", "020"]);
});

test("records of one ID with different personal details refuse the whole response", () => {
  assert.throws(() => parseUniversity([record(), record({ mobile: "0511111111" })]), /1 national IDs/);
});

test("an ID with leading zeros arrives as a number, and is stored as given", () => {
  const [s] = parseUniversity([record({ identityNumber: 12345678 })]);
  assert.equal(s.national_id, "12345678");
});

test("empty fields become null or an empty list", () => {
  const [s] = parseUniversity([record({ hujiEmail: null, mobile: "", campousNameList: null, roadMaps: null })]);
  assert.equal(s.university_email, null);
  assert.equal(s.phone, null);
  assert.deepEqual(s.campuses, []);
  assert.deepEqual(s.programs[0].roadMaps, []);
});

test("the same records in another order are not a change", async () => {
  const a = record();
  const b = record({ facultyCode: "020" });
  await syncStudents({ fetchStudents: async () => parseUniversity([a, b]) }, { minStudents: 0 });
  const again = await syncStudents({ fetchStudents: async () => parseUniversity([b, a]) }, { minStudents: 0 });
  assert.equal(again.ok && again.profileChanged, 0);
  assert.equal((await student("123456782")).member, true);
});

test("students who cannot log in with Google are listed, and nothing else", () => {
  const problems = problemStudents(parseUniversity([
    record(),
    record({ identityNumber: 2, hujiEmail: null }),
    record({ identityNumber: 3, hujiEmail: "x@gmail.com" }),
  ]));
  assert.deepEqual(problems.map((p) => [p.national_id, p.problem]), [
    ["2", "no university email"],
    ["3", "email outside mail.huji.ac.il"],
  ]);
});

test("the live source asks for the year, with the key in the Huji-Authorization header", async () => {
  const calls: [string, string][] = [];
  const source = new UniversitySource({ key: "k", year: 2026 }, async (url, key) => {
    calls.push([url, key]);
    return [record()];
  });
  assert.equal((await source.fetchStudents()).length, 1);
  assert.deepEqual(calls, [["https://orbitapi.huji.ac.il/AgudaStudents/GetAgudaStudents?CurrentYear=2026", "k"]]);
});
