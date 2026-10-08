// Plan §8. Fill the development database with fake students, so the system can be viewed
// and tried without the university list. Safe to run again: the sync writes only changes.
//
//   npm run seed-demo            # 2,000 students
//   npm run seed-demo -- 23000   # any number
import { pool } from "./db.ts";
import { migrate } from "./migrate.ts";
import { seedGifts } from "./seed.ts";
import { FakeSource, fakeStudents } from "./source.ts";
import { syncStudents } from "./sync.ts";

const count = Number(process.argv[2] ?? 2000);

await migrate();
await seedGifts();
const result = await syncStudents(new FakeSource(fakeStudents(count)), { minStudents: 0 });
console.log(result);
await pool.end();
