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
import type { SourceStudent, StudentSource } from "./source.ts";

/** One record, as the service sends it. Only the fields this app reads are typed. */
export type UniversityRecord = {
  identityNumber: number | string;
  fName: string | null;
  lName: string | null;
  sex: string | null;
  hujiEmail: string | null;
  mobile: string | null;
  campousNameList: string | null;
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
    clean(r.mobile), clean(r.specialPopulationsList), campuses(r),
  ]);

const campuses = (r: UniversityRecord) =>
  [...new Set((r.campousNameList ?? "").split(",").map((c) => c.trim()).filter(Boolean))].sort();

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
export function parseUniversity(records: UniversityRecord[]): SourceStudent[] {
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
      campuses: campuses(r),
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
    return parseUniversity((await this.fetchJson(url, this.options.key)) as UniversityRecord[]);
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
    return parseUniversity(JSON.parse(await readFile(this.path, "utf8")));
  }
}

// ---- command line -----------------------------------------------------------------------
//   npm run load-students -- <response.json>
// Syncs a saved response, the same as a scheduled sync, then prints the problem students.

if (import.meta.main) {
  const { pool } = await import("./db.ts");
  const { syncStudents } = await import("./sync.ts");
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run load-students -- <response.json>");
    process.exit(1);
  }
  const source = new UniversityFileSource(path);
  const result = await syncStudents(source, { minStudents: Number(process.env.SYNC_MIN_STUDENTS ?? 0) });
  console.error(JSON.stringify(result));
  const problems = problemStudents(await source.fetchStudents());
  console.error(`${problems.length} students cannot log in with Google (listed on stdout)`);
  for (const p of problems) console.log(`${p.national_id}\t${p.problem}\t${p.email ?? ""}`);
  await pool.end();
  process.exit(result.ok ? 0 : 1);
}
