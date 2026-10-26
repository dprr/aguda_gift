import type pg from "pg";
import type { Campus } from "./campus.ts";
import { pool } from "./db.ts";

/**
 * The gifts (requests 2 and 36), with their photos in img/. Supplied by the owner on
 * 2026-10-11; the fifth, and smaller photos, on 2026-10-22.
 *
 * A gift row is inserted if its id is absent. If it exists, only the name, the description,
 * and the photo are updated.
 */
export const GIFTS: Gift[] = [
  { id: 1, name: "תיק גב", description: "תיק גב שחור עם לוגו האגודה", image: "backpack.jpeg" },
  { id: 2, name: "כוס תרמית", description: "כוס תרמית לבנה עם מכסה", image: "hot_cup.jpeg" },
  { id: 3, name: "מעמד למחשב נייד", description: "מעמד מתקפל עם גובה מתכוונן", image: "laptop_holder.jpeg" },
  { id: 4, name: "צידנית", description: "צידנית עם שני תאים", image: "lunch_bag.jpeg" },
  { id: 5, name: "קופסת אוכל", description: "קופסת אוכל עם שני תאים וסכו\"ם", image: "lunch_box.jpeg" },
];

export type Gift = { id: number; name: string; description: string; image?: string | null };

/**
 * Request 41: the starting stock of each gift on each campus, supplied by the owner on
 * 2026-10-23 (תיקים, כוסות, מעמד לנייד, צידניות, קופסאות אוכל). A row is inserted
 * only if it is absent, so a restart never resets a counter, and never overwrites a number
 * a manager changed on the website.
 */
export const STOCK: Record<Campus, Record<number, number>> = {
  "הר הצופים": { 1: 705, 2: 958, 3: 684, 4: 782, 5: 743 },
  "גבעת רם": { 1: 482, 2: 655, 3: 468, 4: 535, 5: 508 },
  "עין כרם": { 1: 427, 2: 579, 3: 414, 4: 473, 5: 449 },
  "רחובות": { 1: 190, 2: 258, 3: 184, 4: 210, 5: 200 },
};

export async function seedGifts(
  db: pg.Pool | pg.PoolClient = pool,
  gifts = GIFTS,
  stock: Record<string, Record<number, number>> = STOCK,
): Promise<void> {
  for (const g of gifts) {
    await db.query(
      `INSERT INTO gifts (id, name, description, image)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name = excluded.name, description = excluded.description, image = excluded.image`,
      [g.id, g.name, g.description, g.image ?? null],
    );
  }
  for (const [campus, byGift] of Object.entries(stock)) {
    for (const [giftId, count] of Object.entries(byGift)) {
      await db.query(
        `INSERT INTO gift_stock (gift_id, campus, starting_inventory) VALUES ($1, $2, $3)
         ON CONFLICT (gift_id, campus) DO NOTHING`,
        [Number(giftId), campus, count],
      );
    }
  }
}

if (import.meta.main) {
  await seedGifts();
  console.log("gifts seeded");
  await pool.end();
}
