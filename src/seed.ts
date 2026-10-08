import type pg from "pg";
import { pool } from "./db.ts";

/**
 * The 4 gifts (request 2). Placeholder names and stock until Aguda supplies the real ones.
 *
 * A gift is inserted only if its id is absent, so a restart never resets a counter, and
 * `starting_inventory` is never changed once set (request 16). To change a gift after the
 * first seed, edit its row by hand.
 */
export const GIFTS = [
  { id: 1, name: "קפוצ'ון", description: "קפוצ'ון האגודה", starting_inventory: 500 },
  { id: 2, name: "ספל", description: "ספל קרמיקה עם לוגו האגודה", starting_inventory: 500 },
  { id: 3, name: "תיק בד", description: "תיק בד מכותנה", starting_inventory: 500 },
  { id: 4, name: "בקבוק מים", description: "בקבוק נירוסטה, 500 מ\"ל", starting_inventory: 500 },
];

export async function seedGifts(
  db: pg.Pool | pg.PoolClient = pool,
  gifts = GIFTS,
): Promise<void> {
  for (const g of gifts) {
    await db.query(
      `INSERT INTO gifts (id, name, description, starting_inventory)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [g.id, g.name, g.description, g.starting_inventory],
    );
  }
}

if (import.meta.main) {
  await seedGifts();
  console.log("gifts seeded");
  await pool.end();
}
