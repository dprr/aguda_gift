/**
 * Request 41. The four campuses, as faculty-campus.csv spells them. Each campus has its own
 * gift stock; each worker and manager belongs to one campus; a student belongs to the first
 * campus in their list (students.true_campus). 012_campus.sql repeats the list in a CHECK.
 */
export const CAMPUSES = ["גבעת רם", "הר הצופים", "עין כרם", "רחובות"] as const;
export type Campus = (typeof CAMPUSES)[number];
export const isCampus = (value: unknown): value is Campus => CAMPUSES.includes(value as Campus);

/** The Aguda logo, and each campus's own logo, in img/ (owner's files, 2026-10-25). */
/** The Aguda logo: the full name, in cream, on a transparent background (owner's file, 2026-10-30). */
export const AGUDA_LOGO = "logo.png";
export const CAMPUS_LOGO: Record<Campus, string> = {
  "גבעת רם": "givat_ram.webp",
  "הר הצופים": "mt_scopus.jpg",
  "עין כרם": "ein_karem.jpg",
  "רחובות": "rechovot.jpg",
};
/** A campus's logo, or the Aguda logo for no campus or all campuses. */
export const logoOf = (campus: string | null | undefined) =>
  (isCampus(campus) ? CAMPUS_LOGO[campus] : AGUDA_LOGO);

/**
 * Request 55. Sub-campuses: they belong to a campus (its logo, its staff), but have their
 * own gift stock, as if they were another campus. A student of the parent campus belongs
 * to a sub-campus when one of their counted records has one of its track codes (roadMaps),
 * or, for ריפוי בעיסוק, its faculty. 015_sub_campus.sql repeats the names in a CHECK.
 */
export const SUB_CAMPUSES = {
  "אסף הרופא": { parent: "עין כרם", tracks: ["606-5611", "606-5615", "608-5608", "622-5622", "606-6608"] },
  "קפלן": { parent: "עין כרם", tracks: ["606-5613", "606-5614", "610-5610", "619-5619"] },
  "ריפוי בעיסוק": { parent: "עין כרם", faculty: 'ביה"ס לריפוי בעיסוק' },
} as const satisfies Record<string, { parent: Campus; tracks?: readonly string[]; faculty?: string }>;
export type SubCampus = keyof typeof SUB_CAMPUSES;

/** Every place with its own gift stock: the campuses and the sub-campuses. */
export const STOCK_POINTS = [...CAMPUSES, ...(Object.keys(SUB_CAMPUSES) as SubCampus[])];
export type StockPoint = Campus | SubCampus;
export const isStockPoint = (value: unknown): value is StockPoint => STOCK_POINTS.includes(value as StockPoint);

/** The campus a stock point belongs to: itself, or a sub-campus's parent. */
export const parentOf = (point: string): string =>
  (point in SUB_CAMPUSES ? SUB_CAMPUSES[point as SubCampus].parent : point);

/** The stock points a campus's staff see: the campus and its sub-campuses. */
export const pointsOf = (campus: string): string[] => STOCK_POINTS.filter((p) => parentOf(p) === campus);
