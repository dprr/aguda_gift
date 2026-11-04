/**
 * Request 27. The university's AgudaStudents service on orbitapi.huji.ac.il. It returns
 * every Aguda member; the sync derives membership from presence on the list.
 *
 * The service returns one record per student per faculty or program, so one student can
 * appear several times. Records of one national ID are merged when their personal details
 * are the same. If they differ, the whole response is refused, as before.
 *
 * The service sends the national ID as a number, so an ID with leading zeros arrives
 * without them. It is stored as given; the desk search drops leading zeros too.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pickupOptions, SUB_CAMPUSES } from "./campus.ts";
import type { SourceStudent, StudentSource } from "./source.ts";

/** One record, as the service sends it. Only the fields this app reads are typed. */
export type UniversityRecord = {
  identityNumber: number | string;
  fName: string | null;
  lName: string | null;
  sex: string | null;
  hujiEmail: string | null;
  mobile: string | null;
  specialPopulationsList: string | null;
  motherFacultyCode: string | null;
  motherFacultyName: string | null;
  faculty: string | null;
  facultyCode: string | null;
  academicYear: string | null;
  learningProgramCode: string | null;
  learningProgramName: string | null;
  roadMaps: unknown[] | null;
};

const clean = (value: string | null | undefined) => (value ?? "").trim() || null;

/** The details that must agree before two records of one ID are merged. */
const personal = (r: UniversityRecord) =>
  JSON.stringify([
    clean(r.fName), clean(r.lName), clean(r.sex), clean(r.hujiEmail)?.toLowerCase() ?? null,
    clean(r.mobile), clean(r.specialPopulationsList),
  ]);

/**
 * Request 38. The owner's map from faculty to campus, in faculty-campus.csv at the
 * repository root. The university's own campus field (campousNameList) is ignored.
 *
 * Request 39: which faculties count. The mother faculty (motherFacultyName) of each record
 * that has one. Only when no record of the student has a mother faculty, the faculty of
 * every record instead. A student's campuses are the campuses of those faculties.
 *
 * Request 65: a faculty can have several campuses, separated by ";" (first the main one).
 * Its students then pick where to collect, like any student with several campuses.
 */
export type FacultyCampus = Map<string, string[]>;
export const FACULTY_CAMPUS_PATH = join(import.meta.dirname, "..", "faculty-campus.csv");

/** Reads the map: a header row, then faculty,campus. Quoted CSV fields are allowed. */
export async function loadFacultyCampus(path = FACULTY_CAMPUS_PATH): Promise<FacultyCampus> {
  const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { rows[rows.length - 1].push(field); field = ""; }
    else if (c === "\n") { rows[rows.length - 1].push(field); field = ""; rows.push([]); }
    else if (c !== "\r") field += c;
  }
  rows[rows.length - 1].push(field);
  const map: FacultyCampus = new Map();
  for (const [faculty = "", campus = ""] of rows.slice(1)) {
    const campuses = campus.split(";").map((c) => c.trim()).filter(Boolean);
    if (faculty.trim() && campuses.length) map.set(faculty.trim(), campuses);
  }
  return map;
}

type FacultyFields = { motherFacultyName?: unknown; faculty?: unknown };
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Request 39: the records that count: those with a mother faculty, or, if none has one, all. */
function countedRecords<R extends FacultyFields>(records: R[]): R[] {
  const withMother = records.filter((r) => text(r.motherFacultyName));
  return withMother.length ? withMother : records;
}

/** Request 39: the mother faculties, or, if no record has one, the faculties. */
export function countedFaculties(records: FacultyFields[]): string[] {
  const mothers = records.map((r) => text(r.motherFacultyName)).filter(Boolean);
  return [...new Set(mothers.length ? mothers : records.map((r) => text(r.faculty)).filter(Boolean))];
}

/**
 * Request 55: the sub-campus of a student who has the sub-campus's parent among their
 * campuses (request 57: they may collect there even if it is not their first). The first
 * counted record, in university order, with a listed track code decides; else a listed
 * faculty. Null when none matches. stock_campus uses it only when they collect at the parent.
 */
export function subCampusOf(rs: (FacultyFields & { roadMaps?: unknown })[], campuses: string[]): string | null {
  const counted = countedRecords(rs);
  const subs = (Object.entries(SUB_CAMPUSES) as [string, { parent: string; tracks?: readonly string[]; faculty?: string }][])
    .filter(([, sub]) => campuses.includes(sub.parent));
  for (const r of counted) {
    const codes = (Array.isArray(r.roadMaps) ? r.roadMaps : []).map((m) => text((m as { roadMapCode?: unknown }).roadMapCode));
    const byTrack = subs.find(([, sub]) => sub.tracks?.some((t) => codes.includes(t)));
    if (byTrack) return byTrack[0];
  }
  const faculties = countedFaculties(counted);
  return subs.find(([, sub]) => sub.faculty && faculties.includes(sub.faculty))?.[0] ?? null;
}

/**
 * Request 42: the campuses in the university's record order, not sorted, so the first one,
 * students.true_campus, is the campus of the student's first counted record.
 */
const campusesOf = (rs: FacultyFields[], facultyCampus: FacultyCampus) =>
  [...new Set(countedFaculties(rs).flatMap((f) => facultyCampus.get(f) ?? []))];

/** Counted faculties that the map does not know, so they gave no campus. */
export function unmappedFaculties(students: SourceStudent[], facultyCampus: FacultyCampus): string[] {
  const faculties = students.flatMap((s) => countedFaculties(s.programs));
  return [...new Set(faculties.filter((f) => !facultyCampus.has(f)))].sort();
}

/** The academic fields of one record, as the university names them. */
const program = (r: UniversityRecord) => ({
  motherFacultyCode: r.motherFacultyCode,
  motherFacultyName: r.motherFacultyName,
  faculty: r.faculty,
  facultyCode: r.facultyCode,
  academicYear: r.academicYear,
  learningProgramCode: r.learningProgramCode,
  learningProgramName: r.learningProgramName,
  roadMaps: r.roadMaps ?? [],
});

/** Merge the service's records into one SourceStudent per national ID. */
export function parseUniversity(records: UniversityRecord[], facultyCampus: FacultyCampus = new Map()): SourceStudent[] {
  if (!Array.isArray(records)) throw new Error("the university response is not a list");
  const byId = new Map<string, UniversityRecord[]>();
  for (const r of records) {
    const id = String(r.identityNumber ?? "").trim();
    if (!id) throw new Error("a university record has no identityNumber");
    byId.set(id, [...(byId.get(id) ?? []), r]);
  }

  const conflicts = [...byId.values()].filter((rs) => new Set(rs.map(personal)).size > 1).length;
  if (conflicts) {
    throw new Error(`${conflicts} national IDs have records with different personal details`);
  }

  return [...byId].map(([id, rs]) => {
    const r = rs[0];
    return {
      national_id: id,
      university_email: clean(r.hujiEmail)?.toLowerCase() ?? null,
      first_name: clean(r.fName),
      last_name: clean(r.lName),
      gender: clean(r.sex),
      phone: clean(r.mobile),
      special_population: clean(r.specialPopulationsList),
      campuses: campusesOf(rs, facultyCampus),
      sub_campus: subCampusOf(rs, campusesOf(rs, facultyCampus)),
      // Sorted, so the same records in another order are not a change.
      programs: rs.map(program).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  });
}

/**
 * Students that cannot log in with Google, listed for a person to handle. The app does
 * nothing special with them (owner's decision).
 */
export type ProblemStudent = { national_id: string; email: string | null; problem: string };

export function problemStudents(students: SourceStudent[]): ProblemStudent[] {
  return students.flatMap((s): ProblemStudent[] =>
    !s.university_email
      ? [{ national_id: s.national_id, email: null, problem: "no university email" }]
      : !s.university_email.endsWith("@mail.huji.ac.il")
        ? [{ national_id: s.national_id, email: s.university_email, problem: "email outside mail.huji.ac.il" }]
        : [],
  );
}

export const UNIVERSITY_URL = "https://orbitapi.huji.ac.il/AgudaStudents/GetAgudaStudents";

/** The live service. `fetchJson` is replaced in tests. */
export class UniversitySource implements StudentSource {
  options: { key: string; year: number; url?: string };
  fetchJson: (url: string, key: string) => Promise<unknown>;
  constructor(options: UniversitySource["options"], fetchJson = getJson) {
    this.options = options;
    this.fetchJson = fetchJson;
  }
  async fetchStudents(): Promise<SourceStudent[]> {
    const url = `${this.options.url ?? UNIVERSITY_URL}?CurrentYear=${this.options.year}`;
    // The map is read at each run, so an edit to the CSV applies at the next sync.
    return parseUniversity((await this.fetchJson(url, this.options.key)) as UniversityRecord[], await loadFacultyCampus());
  }
}

async function getJson(url: string, key: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "Huji-Authorization": key }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`the university service answered HTTP ${res.status}`);
  return res.json();
}

/** A saved response of the service, for a load by hand. */
export class UniversityFileSource implements StudentSource {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
  async fetchStudents(): Promise<SourceStudent[]> {
    return parseUniversity(JSON.parse(await readFile(this.path, "utf8")), await loadFacultyCampus());
  }
}

/**
 * Request 65: sets every student's campuses and sub-campus again from the stored programs
 * and faculty-campus.csv. The campuses a student already has keep their order (so
 * true_campus stays), and new ones go after them. A chosen campus that is no longer one of
 * them is cleared. Used after an edit of the CSV, with no new list. A student with no
 * mapped faculty keeps their campuses.
 */
export async function recomputeCampuses(map?: FacultyCampus): Promise<{ changed: number; total: number }> {
  const { pool } = await import("./db.ts");
  map ??= await loadFacultyCampus();
  const rows = (await pool.query("SELECT national_id, campuses, programs, sub_campus, chosen_campus FROM students")).rows;
  let changed = 0;
  for (const r of rows) {
    const computed = campusesOf(r.programs ?? [], map);
    if (!computed.length) continue; // no mapped faculty, nothing to compute from
    const campuses = [...r.campuses.filter((c: string) => computed.includes(c)), ...computed.filter((c) => !r.campuses.includes(c))];
    const sub = subCampusOf(r.programs, campuses);
    const chosen = pickupOptions(campuses).includes(r.chosen_campus) ? r.chosen_campus : null;
    if (sub !== r.sub_campus || chosen !== r.chosen_campus || JSON.stringify(campuses) !== JSON.stringify(r.campuses)) {
      await pool.query("UPDATE students SET campuses = $2, sub_campus = $3, chosen_campus = $4 WHERE national_id = $1",
        [r.national_id, campuses, sub, chosen]);
      changed++;
    }
  }
  return { changed, total: rows.length };
}

// ---- command line -----------------------------------------------------------------------
//   npm run load-students -- <response.json>
// Syncs a saved response, the same as a scheduled sync, then prints the problem students.
//   npm run load-students -- --recompute-sub-campus
// Request 55: sets every student's sub-campus from the programs already stored, with no
// file. The stored programs are sorted, not in university order; that matters only for a
// student with tracks of two sub-campuses, and the next sync sets the true order.
// Request 65: sets the campuses too, from faculty-campus.csv (recomputeCampuses).

if (import.meta.main) {
  const { pool } = await import("./db.ts");
  const { syncStudents } = await import("./sync.ts");
  if (process.argv[2] === "--recompute-sub-campus") {
    const { changed, total } = await recomputeCampuses();
    console.error(`campuses and sub-campus set for ${changed} of ${total} students`);
    await pool.end();
    process.exit(0);
  }
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run load-students -- <response.json>");
    process.exit(1);
  }
  const source = new UniversityFileSource(path);
  const result = await syncStudents(source, { minStudents: Number(process.env.SYNC_MIN_STUDENTS ?? 0), origin: { source: "file" } });
  console.error(JSON.stringify(result));
  const students = await source.fetchStudents();
  const unmapped = unmappedFaculties(students, await loadFacultyCampus());
  if (unmapped.length) console.error(`faculties missing from faculty-campus.csv, so no campus: ${unmapped.join(" | ")}`);
  const problems = problemStudents(students);
  console.error(`${problems.length} students cannot log in with Google (listed on stdout)`);
  for (const p of problems) console.log(`${p.national_id}\t${p.problem}\t${p.email ?? ""}`);
  await pool.end();
  process.exit(result.ok ? 0 : 1);
}
