/**
 * Request 41. The four campuses, as faculty-campus.csv spells them. Each campus has its own
 * gift stock; each worker and manager belongs to one campus; a student belongs to the first
 * campus in their list (students.true_campus). 012_campus.sql repeats the list in a CHECK.
 */
export const CAMPUSES = ["גבעת רם", "הר הצופים", "עין כרם", "רחובות"] as const;
export type Campus = (typeof CAMPUSES)[number];
export const isCampus = (value: unknown): value is Campus => CAMPUSES.includes(value as Campus);
