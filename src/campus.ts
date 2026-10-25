/**
 * Request 41. The four campuses, as faculty-campus.csv spells them. Each campus has its own
 * gift stock; each worker and manager belongs to one campus; a student belongs to the first
 * campus in their list (students.true_campus). 012_campus.sql repeats the list in a CHECK.
 */
export const CAMPUSES = ["גבעת רם", "הר הצופים", "עין כרם", "רחובות"] as const;
export type Campus = (typeof CAMPUSES)[number];
export const isCampus = (value: unknown): value is Campus => CAMPUSES.includes(value as Campus);

/** The Aguda logo, and each campus's own logo, in img/ (owner's files, 2026-10-25). */
export const AGUDA_LOGO = "aguda_logo.svg";
export const CAMPUS_LOGO: Record<Campus, string> = {
  "גבעת רם": "givat_ram.webp",
  "הר הצופים": "mt_scopus.jpg",
  "עין כרם": "ein_karem.jpg",
  "רחובות": "rechovot.jpg",
};
/** A campus's logo, or the Aguda logo for no campus or all campuses. */
export const logoOf = (campus: string | null | undefined) =>
  (isCampus(campus) ? CAMPUS_LOGO[campus] : AGUDA_LOGO);
