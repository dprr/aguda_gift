import type pg from "pg";
import { pool } from "./db.ts";

/**
 * The gifts (requests 2 and 36), with their photos in img/. Supplied by the owner on
 * 2026-10-11; the fifth, and smaller photos, on 2026-10-22.
 * The stock is still a placeholder until Aguda supplies it.
 *
 * A gift row is inserted if its id is absent. If it exists, only the name, the description,
 * and the photo are updated, so a restart never resets a counter, and `starting_inventory`
 * is never changed once set (request 16). To change the stock, edit the row by hand.
 */
export const GIFTS: Gift[] = [
  { id: 1, name: "תיק גב", description: "תיק גב שחור עם לוגו האגודה", image: "backpack.jpeg", starting_inventory: 500 },
  { id: 2, name: "כוס תרמית", description: "כוס תרמית לבנה עם מכסה", image: "hot_cup.jpeg", starting_inventory: 500 },
  { id: 3, name: "מעמד למחשב נייד", description: "מעמד מתקפל עם גובה מתכוונן", image: "laptop_holder.jpeg", starting_inventory: 500 },
  { id: 4, name: "תיק אוכל", description: "תיק אוכל עם שני תאים", image: "lunch_bag.jpeg", starting_inventory: 500 },
  { id: 5, name: "קופסת אוכל", description: "קופסת אוכל עם שני תאים וסכו\"ם", image: "lunch_box.jpeg", starting_inventory: 500 },
];

export type Gift = {
  id: number;
  name: string;
  description: string;
  image?: string | null;
  starting_inventory: number;
};

export async function seedGifts(
  db: pg.Pool | pg.PoolClient = pool,
  gifts = GIFTS,
): Promise<void> {
  for (const g of gifts) {
    await db.query(
      `INSERT INTO gifts (id, name, description, image, starting_inventory)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET name = excluded.name, description = excluded.description, image = excluded.image`,
      [g.id, g.name, g.description, g.image ?? null, g.starting_inventory],
    );
  }
}

if (import.meta.main) {
  await seedGifts();
  console.log("gifts seeded");
  await pool.end();
}
