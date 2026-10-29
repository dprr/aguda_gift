// Request 27: the university's AgudaStudents service.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { pool } from "../src/db.ts";
import { syncStudents } from "../src/sync.ts";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FacultyCampus, loadFacultyCampus, parseUniversity, problemStudents, unmappedFaculties, type UniversityRecord, UniversitySource,
} from "../src/university.ts";
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

const MAP: FacultyCampus = new Map([
  ["פקולטה למתמטיקה ולמדעי הטבע", "גבעת רם"],
  ['ביה"ס לתלמידי חו"ל', "הר הצופים"],
]);

test("one record becomes one student, cleaned, with the campus of its faculty", () => {
  const [s] = parseUniversity([record()], MAP);
  assert.equal(s.national_id, "123456782");
  assert.equal(s.university_email, "dana.cohen@mail.huji.ac.il");
  assert.equal(s.last_name, "כהן", "trimmed");
  assert.equal(s.gender, "Female");
  assert.deepEqual(s.campuses, ["גבעת רם"], "from the map, not from the university's campus field");
  assert.equal(s.programs.length, 1);
  assert.equal(s.programs[0].learningProgramName, "בוגר");
});

test("records of one student with the same details merge, keeping every program", () => {
  const students = parseUniversity([
    record(),
    record({ faculty: "ביה\"ס לתלמידי חו\"ל", facultyCode: "020" }),
    record({ identityNumber: 111111118, hujiEmail: "other@mail.huji.ac.il" }),
  ]);
  assert.equal(students.length, 2);
  const merged = students.find((s) => s.national_id === "123456782")!;
  assert.deepEqual(merged.programs.map((p) => p.facultyCode).sort(), ["002", "020"]);
});

test("the mother faculties count; records without one add nothing (request 39)", () => {
  const [s] = parseUniversity([
    record(), // mother: מתמטיקה → גבעת רם
    record({ faculty: 'ביה"ס לתלמידי חו"ל', motherFacultyName: null }), // no mother: ignored
  ], MAP);
  assert.deepEqual(s.campuses, ["גבעת רם"]);
});

test("two mother faculties on two campuses give two campuses", () => {
  const [s] = parseUniversity([
    record(),
    record({ faculty: 'ביה"ס לתלמידי חו"ל', motherFacultyName: 'ביה"ס לתלמידי חו"ל ' }), // trailing space ignored
  ], MAP);
  assert.deepEqual(s.campuses, ["גבעת רם", "הר הצופים"]);
});

test("the campuses keep the university's record order, so the first record's campus comes first (request 42)", () => {
  const [s] = parseUniversity([
    record({ faculty: 'ביה"ס לתלמידי חו"ל', motherFacultyName: 'ביה"ס לתלמידי חו"ל' }), // הר הצופים
    record(), // מתמטיקה → גבעת רם
  ], MAP);
  assert.deepEqual(s.campuses, ["הר הצופים", "גבעת רם"], "not alphabetical");
});

test("with no mother faculty in any record, every record's faculty counts", () => {
  const [s] = parseUniversity([
    record({ motherFacultyName: "" }),
    record({ faculty: 'ביה"ס לתלמידי חו"ל', motherFacultyName: null }),
  ], MAP);
  assert.deepEqual(s.campuses, ["גבעת רם", "הר הצופים"]);
});

test("an unknown faculty gives no campus, and is reported", () => {
  const students = parseUniversity([record({ faculty: "פקולטה חדשה", motherFacultyName: "פקולטה חדשה" })], MAP);
  assert.deepEqual(students[0].campuses, []);
  assert.deepEqual(unmappedFaculties(students, MAP), ["פקולטה חדשה"]);
});

test("sub-campuses of עין כרם: by track code, or by faculty (request 55)", () => {
  const map: FacultyCampus = new Map([
    ['ביה"ס לאחיות', "עין כרם"], ['ביה"ס לריפוי בעיסוק', "עין כרם"], ["ביה\"ס לרפואה", "עין כרם"],
    ["פקולטה למתמטיקה ולמדעי הטבע", "גבעת רם"],
  ]);
  const nursing = (id: number, code: string) => record({
    identityNumber: id, hujiEmail: `n${id}@mail.huji.ac.il`, faculty: 'ביה"ס לאחיות', motherFacultyName: 'ביה"ס לאחיות',
    roadMaps: [{ roadMapCode: code, roadMapName: "אחיות (סיעוד)" }],
  });
  const of = (rs: UniversityRecord[]) => parseUniversity(rs, map)[0];
  assert.equal(of([nursing(1, "606-5611")]).sub_campus, "אסף הרופא");
  assert.equal(of([nursing(2, "606-5613")]).sub_campus, "קפלן");
  assert.equal(of([nursing(3, "606-5606")]).sub_campus, null, "הדסה stays עין כרם");
  const ot = record({ identityNumber: 4, hujiEmail: "o4@mail.huji.ac.il", faculty: 'ביה"ס לריפוי בעיסוק', motherFacultyName: 'ביה"ס לריפוי בעיסוק' });
  assert.equal(of([ot]).sub_campus, "ריפוי בעיסוק");
  assert.deepEqual(of([ot]).campuses, ["עין כרם"], "the campus stays עין כרם");
  // A listed track counts only when the true campus is עין כרם.
  const mathFirst = [record({ identityNumber: 5, hujiEmail: "m5@mail.huji.ac.il" }), { ...nursing(5, "606-5611"), hujiEmail: "m5@mail.huji.ac.il" }];
  assert.equal(of(mathFirst).sub_campus, null);
});

test("the CSV map is read with quotes, a BOM, and Windows line ends", async () => {
  const path = join(tmpdir(), `faculty-campus-${process.pid}.csv`);
  writeFileSync(path, '\uFEFFפקולטה,קמפוס\r\n"ביה""ס לרפואה",עין כרם\r\n"פקולטה לחקלאות, מזון",רחובות\r\nריקה,\r\n');
  const map = await loadFacultyCampus(path);
  assert.deepEqual([...map], [['ביה"ס לרפואה', "עין כרם"], ["פקולטה לחקלאות, מזון", "רחובות"]]);
});

test("the real faculty-campus.csv maps every faculty to one of the four campuses", async () => {
  const map = await loadFacultyCampus();
  assert.ok(map.size >= 20);
  for (const campus of map.values()) assert.ok(["גבעת רם", "הר הצופים", "עין כרם", "רחובות"].includes(campus), campus);
});

test("records of one ID with different personal details refuse the whole response", () => {
  assert.throws(() => parseUniversity([record(), record({ mobile: "0511111111" })]), /1 national IDs/);
});

test("an ID with leading zeros arrives as a number, and is stored as given", () => {
  const [s] = parseUniversity([record({ identityNumber: 12345678 })]);
  assert.equal(s.national_id, "12345678");
});

test("empty fields become null or an empty list", () => {
  const [s] = parseUniversity([record({ hujiEmail: null, mobile: "", faculty: null, motherFacultyName: null, roadMaps: null })], MAP);
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
