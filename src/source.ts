/**
 * Plan §8. The sync reads students only through this interface, so the university
 * integration (M6) is one new implementation and no other change.
 */

/**
 * One student from the university list, after duplicates are merged (university.ts).
 * Request 27: every student on the list is an Aguda member, so the record holds no
 * membership field. The sync derives membership from presence on the list.
 */
export type SourceStudent = {
  national_id: string;
  university_email: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  phone: string | null;
  special_population: string | null;
  /** The campuses of the student's faculties (request 38), in the university's record order (request 42). */
  campuses: string[];
  /** One entry per university record, with its academic fields as the university names them. */
  programs: Record<string, unknown>[];
};

export interface StudentSource {
  fetchStudents(): Promise<SourceStudent[]>;
}

/** The profile columns, in one fixed order, with their SQL types. The sync compares these. */
export const PROFILE_COLUMNS = [
  ["university_email", "text"],
  ["first_name", "text"],
  ["last_name", "text"],
  ["gender", "text"],
  ["phone", "text"],
  ["special_population", "text"],
  ["campuses", "text[]"],
  ["programs", "jsonb"],
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
 * The shape follows the real list, so the fake data exercises the same code.
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
    const female = rand() < 0.5;

    students.push({
      national_id: nationalId,
      university_email: `student${i}@mail.huji.ac.il`,
      first_name: pick(female ? FIRST_FEMALE : FIRST_MALE),
      last_name: pick(LAST),
      gender: female ? "Female" : "Male",
      phone: `05${Math.floor(rand() * 1e8).toString().padStart(8, "0")}`,
      special_population: null,
      campuses: [f.campus],
      programs: [{
        faculty: f.faculty,
        motherFacultyName: f.faculty,
        academicYear: String(year),
        learningProgramName: "בוגר",
        roadMaps: [{ roadMapName: `מסלול כללי ב${department}`, departmentName: department, roadmapScope: "חד-חוגי" }],
      }],
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
