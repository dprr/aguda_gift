/**
 * Plan §8. The sync reads students only through this interface, so the university
 * integration (M6) is one new implementation and no other change.
 */

/** One record from the university list. Every field except the ID may be absent (§3.1). */
export type SourceStudent = {
  national_id: string;
  university_email: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  phone: string | null;
  faculty: string | null;
  parent_faculty: string | null;
  study_year: string | null;
  campus: string | null;
  special_population: string | null;
  program: string | null;
  program_code: string | null;
  department: string | null;
  department_code: string | null;
  track: string | null;
  track_code: string | null;
  year_in_track: string | null;
  track_scope: string | null;
  member: boolean | null;
};

export interface StudentSource {
  fetchStudents(): Promise<SourceStudent[]>;
}

/** The profile and academic columns, in one fixed order. The sync compares these. */
export const PROFILE_COLUMNS = [
  "university_email",
  "first_name",
  "last_name",
  "gender",
  "phone",
  "faculty",
  "parent_faculty",
  "study_year",
  "campus",
  "special_population",
  "program",
  "program_code",
  "department",
  "department_code",
  "track",
  "track_code",
  "year_in_track",
  "track_scope",
] as const;

// ---------------------------------------------------------------------------------------
// FakeSource

// Names that clearly match the gender, so the demo never shows a woman named גיא.
const FIRST_MALE = ["איתי", "יונתן", "עומר", "דניאל", "אורי", "נדב", "עידו", "אלון", "גיא", "אביתר"];
const FIRST_FEMALE = ["נועה", "מאיה", "שירה", "תמר", "יעל", "אביגיל", "הילה", "מיכל", "שני", "רותם"];
const LAST = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "אזולאי", "דהן",
  "שפירא", "גולן", "רוזן", "בן דוד", "אוחיון", "קליין"];
const FACULTIES = [
  { faculty: "מדעי הרוח", campus: "הר הצופים" },
  { faculty: "מדעי החברה", campus: "הר הצופים" },
  { faculty: "משפטים", campus: "הר הצופים" },
  { faculty: "מתמטיקה ומדעי הטבע", campus: "גבעת רם" },
  { faculty: "רפואה", campus: "עין כרם" },
  { faculty: "חקלאות, מזון וסביבה", campus: "רחובות" },
];
const DEPARTMENTS = ["היסטוריה", "פסיכולוגיה", "כלכלה", "מדעי המחשב", "ביולוגיה", "פיזיקה",
  "סוציולוגיה", "פילוסופיה", "יחסים בינלאומיים", "תזונה"];

/** Deterministic random numbers, so a seed always produces the same students. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Invents `count` students. The same `seed` gives the same students every time, so a
 * repeated fetch returns byte-identical data (plan §8).
 *
 * National IDs run 100000001, 100000002, … so a test can name a student directly.
 * About 30% are members, 60% are not, and 10% are unknown.
 */
export function fakeStudents(count: number, seed = 1): SourceStudent[] {
  const rand = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const students: SourceStudent[] = [];

  for (let i = 1; i <= count; i++) {
    const nationalId = String(100000000 + i);
    const f = pick(FACULTIES);
    const department = pick(DEPARTMENTS);
    const year = 1 + Math.floor(rand() * 4);
    const roll = rand();

    const female = rand() < 0.5;

    students.push({
      national_id: nationalId,
      university_email: `student${i}@mail.huji.ac.il`,
      first_name: pick(female ? FIRST_FEMALE : FIRST_MALE),
      last_name: pick(LAST),
      gender: female ? "נקבה" : "זכר",
      phone: `05${Math.floor(rand() * 1e8).toString().padStart(8, "0")}`,
      faculty: f.faculty,
      parent_faculty: f.faculty,
      study_year: String(year),
      campus: f.campus,
      special_population: null,
      program: `תואר ראשון ב${department}`,
      program_code: String(Math.floor(rand() * 1000)).padStart(4, "0"),
      department,
      department_code: String(Math.floor(rand() * 1000)).padStart(3, "0"),
      track: "חד-חוגי",
      track_code: "01",
      year_in_track: String(year),
      track_scope: "מלא",
      member: roll < 0.3 ? true : roll < 0.9 ? false : null,
    });
  }
  return students;
}

/** A source that returns a fixed list. Tests change `students` between fetches. */
export class FakeSource implements StudentSource {
  students: SourceStudent[];
  constructor(students: SourceStudent[]) {
    this.students = students;
  }
  async fetchStudents(): Promise<SourceStudent[]> {
    return structuredClone(this.students);
  }
}
