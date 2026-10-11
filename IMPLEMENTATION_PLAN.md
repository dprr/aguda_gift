# Gifts App — Implementation Plan

Measured against **§14: What the owner explicitly asked for**, not against
`Gifts App — Product Specification.docx`. §13 holds what nobody asked for, and §15 holds
what the owner asked for and then deferred. Nothing is lost.

---

## 0. The rule for this project

**Simplicity wins. Build the simplest thing that meets the requirement. Always.**

This rule has authority over every other section. If a later section conflicts with it,
the later section is wrong.

- ⚠️ **Build only what the owner explicitly asked for.** The specification is a wish
  list. A section in that document is **not** a request.
- ⚠️ **Create no table unless the owner asked for the thing it holds.** Every table must
  serve a line in §14. If it does not, delete it.
- **One identifier. One way to do each thing.** Never add a second mechanism "in case".
- **Do not design for a case that has not happened.** Put it in §13. The owner decides if
  it happens.
- **An item moves §13 → §15 → §14.** Build nothing before it reaches §14.
- **Prefer a constraint over code.** Prefer a derived value over a stored one.
- **When a problem looks hard, first ask whether the requirement can be simpler.**

---

## 1. Decisions taken

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript, backend and frontend | One language for the whole system. The frontend is TypeScript either way |
| Backend | Fastify | `app.inject()` tests concurrency in-process |
| Frontend | **Server-rendered HTML. No React, no Vite, no build step** | The screens are a list of four gifts and one search box. React would add a build, a second `package.json`, a JSON API, and a second copy of the page logic (§0) |
| Data layer | The `pg` driver and plain SQL. **No ORM** | Every statement in §5 is hand-written SQL, and there are two tables. An ORM would earn nothing (§0) |
| Database | PostgreSQL on RDS | Same price as a container once the instance is sized honestly, and it adds point-in-time recovery |
| **Tables** | **2: `students` and `gifts`** | §0. Everything else serves no line in §14 |
| Login | One page, one Google button | The `hd` claim selects the interface. See §2 |
| Passwords | **None** | Google authenticates. No staff table, no reset path |
| Identity key | National ID is the primary key | HUJI uses it as the student number. One identifier |
| Student arrays | `membership_history` and `interactions`, both jsonb on the student row | Requests 13 and 18. No history table, and no interactions table |
| Stock counters | `starting_inventory`, `requested_count`, `given_count` on `gifts` | Requests 16 and 19. §5.1 refuses a selection when a gift is sold out. The handout needs no stock check |
| UI | Hebrew only, right to left | Request 14 |
| Build order | The 2-table system first, then additions on request | The owner's decision |

---

## 2. Login

Both interfaces share **one page with one Google button**. The page asks nothing about
who the person is. The backend reads the `hd` claim from the signed ID token and selects
the interface.

| `hd` claim in the ID token | Result |
|---|---|
| `mail.huji.ac.il`, or another confirmed student domain | Student session |
| `aguda.org.il` | Staff session |
| Any other domain | Refuse |
| **No `hd` claim** | Refuse |

Use only the `openid`, `email`, and `profile` scopes. Google needs no application review
for these.

⚠️ **Check the domain inside the token, not in the request.** The `hd` request parameter
is only a hint for the Google screen, and an attacker can change it. Verify the `hd`
claim inside the signed ID token, and verify `email_verified`.

⚠️ **A personal Gmail account sends no `hd` claim.** Treat a missing claim as a refusal,
not as an empty string.

⚠️ **Never let the browser ask for a session kind.** Accept no `role`, `kind`, or `as`
parameter. Put no session kind in the OAuth `state`. The token decides.

Send `prompt=select_account` on every login. A student who works for Aguda holds two
accounts and must choose between them.

**A student session finds the student by university email.** Google returns the address,
and `students.university_email` matches it. The student never types a national ID.

⚠️ **Lowercase both sides.** The sync stores `university_email` in lowercase, and login
lowercases the Google address before the lookup. A university record with `Dana@Mail...`
must not lock a student out.

**A staff session needs no table.** Any `aguda.org.il` address is staff. This is a
consequence of §14 holding no request for staff accounts or roles. See §13.

### Two failures the page must explain in clear Hebrew

1. A HUJI address with no matching student. Say "We cannot find you in the university
   list. Ask at the Aguda office." The cause is a new student, or a student who left.
2. An `aguda.org.il` address. There is no failure case, which is the point in §13.

---

## 3. Repository layout

One package, for everything. The pages are server-rendered HTML, so there is no frontend
toolchain. No workspaces and no monorepo tooling (§0).

Node runs TypeScript files directly, and `node --test` runs the tests. So there is no build
step for the backend, and no test framework to install.

```
aguda/
  migrations/   # plain SQL, applied in order
  src/
    db.ts       # connection pool, one transaction helper
    gifts.ts    # §5.1 and §5.2
    sync.ts     # §5.3
    source.ts   # StudentSource and FakeSource
    queries.ts  # reads for the two pages
    auth.ts     # §2: the hd decision and Google
    pages.ts    # every page, and every Hebrew string in one object
    server.ts   # Fastify routes, sessions, CSRF
  test/
  docker-compose.yml   # local PostgreSQL only
```

`src/gifts.ts` and `src/sync.ts` hold every write. No route handler writes to the database
directly.

---

## 4. Data model

Two tables. Every timestamp is `timestamptz` in UTC. Display converts to Asia/Jerusalem.

### 4.1 `students`

One row per student. Current values in columns, two append-only arrays beside them.

| Column | Type | Notes |
|---|---|---|
| `national_id` | text, **primary key** | Stored as given. No validator |
| `university_email` | text, unique | Google login matches on this. **Stored lowercase** |
| **Identity and names — §4.2** | | |
| `first_name` | text, nullable | שם פרטי |
| `last_name` | text, nullable | שם משפחה |
| `gender` | text, nullable | מגדר |
| `phone` | text, nullable | טלפון |
| **Academic — §4.2** | | |
| `faculty` | text, nullable | פקולטה |
| `parent_faculty` | text, nullable | פקולטת אם |
| `study_year` | text, nullable | שנת לימודים |
| `campus` | text, nullable | קמפוס |
| `special_population` | text, nullable | אוכלוסייה מיוחדת |
| `program` | text, nullable | תוכנית לימודים |
| `program_code` | text, nullable | קוד תוכנית |
| `department` | text, nullable | שם חוג |
| `department_code` | text, nullable | קוד חוג |
| `track` | text, nullable | שם מסלול |
| `track_code` | text, nullable | קוד מסלול |
| `year_in_track` | text, nullable | שנה במסלול |
| `track_scope` | text, nullable | היקף מסלול |
| **State** | | |
| `member` | boolean, **nullable** | `true`, `false`, or `null` for unknown |
| `member_changed_at` | timestamptz | Shown beside the status, so staff see how old the data is |
| `gift_id` | integer, fk `gifts`, nullable | The current selection. Null means none |
| `gift_taken_at` | timestamptz, nullable | **Not null means the gift was handed over** |
| `created_at` | timestamptz | First seen. Written once |
| `survey` | jsonb, nullable | Request 22. `{version, submitted_at, answers}`. Null until submitted, then never changed |
| **Arrays** | | |
| `membership_history` | jsonb, default `'[]'` | Append-only. Request 13. **Membership changes only** |
| `interactions` | jsonb, default `'[]'` | Append-only. Request 18. Gift collection now, merchandise and Kossel later |

Request 17 covers every column in the three §4.2 blocks above. Six §4.2 fields are
**not** stored, each for a stated reason:

| Field | Why not |
|---|---|
| מזהה HUJI | HUJI uses the national ID as its student number, so it is `national_id` |
| שם מלא, שם מלא באנגלית | `first_name` and `last_name` carry the name. A full name is those two joined |
| מייל אישי, מייל מועדף | The HUJI address is the only one used. Google login matches on it |
| מצב פרטי קשר | §4.2 says code meanings need confirming during integration. Nobody knows what this field means, so it serves no request |

**Every university field is nullable and stored as `text`.** Two reasons, and both come
from §0:

- §3.1 retrieves these *"where available"*, so any one of them can be absent.
- §4.2 says *"The programmer must confirm source types"*. Nobody has seen the source. A
  typed column needs a conversion rule and a failure path, and a failed conversion would
  reject the whole student record. Text has neither.

The codes — `program_code`, `department_code`, `track_code` — are text for the same
reason §4.1 gives for the national ID: to preserve leading zeros.

`study_year` and `year_in_track` are text, not integers, because the source may send
`"2025/2026"` rather than a number. Convert them in Milestone 6, once a real response
shows the format.

The sync writes these columns, and §5.3 updates only the ones whose value differs.

**No history for these columns.** Request 13 asks for a membership list only. A changed
faculty overwrites the old value. See §13.

**One identifier, and that is all.** No surrogate key, and no HUJI ID. HUJI uses the
national ID as its student number, so the two specification fields are one value.

Students are **never deleted**. A student who leaves the university list keeps the row,
unchanged. There is no enrollment column, because no line in §14 asks about enrollment.

⚠️ So a student who graduates looks exactly like a student who stays. If their Aguda
membership has not lapsed in the source yet, they can still collect a gift. §13 records
the column that would fix it.

#### `membership_history`

```json
[{"at": "2025-10-01T08:00:00Z", "member": true},
 {"at": "2026-03-01T10:00:00Z", "member": false},
 {"at": "2026-04-01T09:00:00Z", "member": true}]
```

That is the whole array. Request 13 asks for "a list of every time a student's membership
changed", and nothing else asks for history, so nothing else goes in.

Profile changes, academic changes, and gift selections are **not** recorded anywhere.
Each current value has its own column, which is all any request needs. §13 holds what it
would take to record them. Handovers **are** recorded, in `interactions`.

**No read path uses this array.** It is the record requested in request 13. Every value
the application reads has its own column.

⚠️ **Append only when the value differs from `member`.** Otherwise every sync appends an
entry for all 23,000 students.

#### `interactions`

Request 18, and §4.3's Interactions entity: *"Gift collection and future merchandise or
Kossel membership interactions."*

```json
[{"at": "2026-03-02T11:05:00Z", "type": "gift_collection", "gift_id": 2}]
```

`type` is `gift_collection` today. `merchandise_purchase` and `kossel_membership` get
their own entries when somebody asks for those interfaces. The `type` field is the whole
cost of leaving room for them: no extra column, no extra table.

§4.6 requires the staff screen to show these *"as a chronological student history"*. The
array is already in order, because §5.2 only appends.

**`gift_taken_at` stays.** It is the guard in §5.2, so it must be a column. The
interaction entry carries the detail, and §5.2 writes both in one statement, so they
cannot disagree.

### 4.2 `gifts`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, primary key, 1 to 4 | |
| `name` | text, Hebrew | |
| `description` | text, Hebrew | |
| `starting_inventory` | integer, not null | Request 16. Set once at seed time. **Never changed** |
| `requested_count` | integer, not null, default 0 | Request 16. Rises on each student selection |
| `given_count` | integer, not null, default 0 | Request 16. Rises on each handover |

Four rows. The seed inserts a gift **only if its `id` is absent**, so a restart never resets a counter. To change a gift after the first seed, edit the row by hand.

**Two derived numbers, neither stored.**

- `starting_inventory - requested_count` — how many more students may still select this
  gift. This is the number §5.1 enforces and the student page shows.
- `starting_inventory - given_count` — how many units are still physically in the box.
  `requested_count - given_count` of those are already promised to a student.

**The counters enforce the limit.** Request 19. §5.1 refuses a selection once
`requested_count` reaches `starting_inventory`. One constraint backs it up:

```sql
CHECK (requested_count <= starting_inventory)   -- never promise more than you bought
```

The §5.1 guard already prevents this, so why the constraint? Because the guard sits in one
code path, and the constraint applies to **every** writer, including the seed script and a
person who edits a row by hand. The invariant is request 19 itself: a
violation means Aguda promised gifts it did not buy.

**No other check.** `requested_count >= 0` cannot fail, because the counter only
increments in v1; §15.1 adds it when the gift-change flow returns and starts decrementing.
`given_count <= requested_count` cannot fail either, because §5.2 requires a non-null
`gift_id`, and that means §5.1 already incremented `requested_count` for the same gift.

**The counters are derived values that this plan stores anyway**, because §0 normally
forbids that. `students` remains the only truth:

```sql
-- reconciliation: both rows must come back empty
SELECT g.id, g.requested_count, count(s.national_id)
  FROM gifts g LEFT JOIN students s ON s.gift_id = g.id
 GROUP BY g.id, g.requested_count
HAVING g.requested_count <> count(s.national_id);

SELECT g.id, g.given_count, count(s.national_id)
  FROM gifts g LEFT JOIN students s
    ON s.gift_id = g.id AND s.gift_taken_at IS NOT NULL
 GROUP BY g.id, g.given_count
HAVING g.given_count <> count(s.national_id);
```

Run both in the test suite after every concurrency test, and expose them on a staff
screen. A counter that drifts is then visible instead of silent.

---

## 5. The three operations

All three live in `src/gifts.ts` and `src/sync.ts`. Every rule sits in a `WHERE` clause, so no race can
pass it.

**Neither gift operation takes a lock.** Request 16 adds counters on `gifts`, so both
touch two tables. Each runs in **one transaction**, and the counter moves only when the
guard on `students` passed. §5.3, the sync, does take one PostgreSQL advisory lock, to stop
two runs at once.

Both gift operations guard themselves, but they contend on different things, and that is
what makes them different problems:

| | §5.1 selection | §5.2 handout |
|---|---|---|
| Contended row | **`gifts`** — one row, every student | `students` — one row, that student only |
| Who competes | Thousands of students, at once | Two employees at two desks |
| What a loss means | The gift sold out. Pick another | Another desk already gave it. Give nothing |
| Shape | Compare a counter against a limit | Compare a timestamp against null |

§5.1 is the real concurrency problem, because the whole student body meets on four rows.
§5.2 is a guarded write: the guard matters, but two people reaching one student's row at
the same instant is rare.

### 5.1 A student selects a gift — the contended compare-and-swap

```sql
BEGIN;
  -- 1. write-once: the student has not chosen yet, and is a member
  UPDATE students
     SET gift_id = $2
   WHERE national_id = $1
     AND member IS TRUE
     AND gift_id IS NULL
     AND survey IS NOT NULL;   -- request 22
  -- zero rows: ROLLBACK. Not a member, a selection already exists, or no survey yet

  -- 2. claim one unit of stock. Request 19
  UPDATE gifts
     SET requested_count = requested_count + 1
   WHERE id = $2
     AND requested_count < starting_inventory;
  -- zero rows: ROLLBACK. Sold out — ask the student to pick another gift
COMMIT;
```

Two guards, both in a `WHERE` clause, both in one transaction. Either one failing rolls
back the whole thing, so a student never holds a gift without a unit of stock, and a unit
is never claimed without a student holding it.

**Statement 1 runs first on purpose.** A retry or a double tap matches no row there and
rolls back at once, without ever touching the shared `gifts` row.

**Statement 2 is the compare-and-swap for stock.** Two students want the last hoodie at
the same moment. Both pass statement 1, because they are different rows. Both then reach
the one `gifts` row, PostgreSQL serializes them under its row lock, and exactly one gets a
row back. The other rolls back and picks another gift.

This is §7.3's requirement: *"If the selected gift becomes unavailable, the student must be
prompted to choose another option."* The student interface must also grey out a gift whose
`requested_count` already equals `starting_inventory`, and handle the race where the page
was drawn a moment before the last unit went.

### 5.2 An employee marks the gift as taken — a guarded write

```sql
BEGIN;
  UPDATE students
     SET gift_taken_at = now(),
         interactions = interactions || jsonb_build_array(jsonb_build_object(
           'at', now(), 'type', 'gift_collection', 'gift_id', gift_id))
   WHERE national_id = $1
     AND member IS TRUE
     AND gift_id IS NOT NULL
     AND gift_taken_at IS NULL
  RETURNING gift_id;
  -- zero rows: ROLLBACK. Re-read to choose the message.
  UPDATE gifts SET given_count = given_count + 1 WHERE id = <the returned gift_id>;
COMMIT;
```

This is request 5 and request 8 together. Two distribution centers click at the same
moment, and exactly one gets a row back. Every later caller gets zero rows, and the API
answers **409**.

**The guard is still required.** Request 5 says a gift must not be given twice, and
request 8 puts employees at separate centers. Two of them can open the same student and
both click. `gift_taken_at IS NULL` is what stops the second one.

**Why it needs no lock.** The transition `NULL → timestamp` is one-way. A row never
returns to null, so there is no ABA problem and no version column is needed. The `WHERE`
clause is the compare, the `SET` clause is the swap, and PostgreSQL runs the statement
atomically under the row lock it takes by itself.

**That same guard protects `given_count`.** Only the one caller that wins reaches the
counter. Every later attempt rolls back, so a gift cannot be counted as given twice.

**No stock check here.** §5.1 already claimed the unit when the student selected the gift,
so the stock question is settled before anybody reaches a desk. The only rule a handout
needs is "not handed over already".

**Membership is checked again here.** Request 20: the student must be a member at
selection **and** at collection. Zero rows therefore means one of three things. Re-read the
row to choose the message:

| Cause | Desk message | Stock |
|---|---|---|
| `member` is not true | Not a member now. Refuse | **The unit stays claimed.** If the student renews, they collect it later |
| `gift_id` is null | No selection. Refuse (request 6) | — |
| `gift_taken_at` is set | Already collected. Answer 409 | — |

A 409 after a handout under two minutes old is almost certainly a lost response on poor
wifi, so say so rather than raising an alarm.

⚠️ **A lapsed member's unit is never released.** The owner chose this. If the student does
not renew, `requested_count` keeps that unit forever and no other student can select it.
§13 records the release path.

### 5.3 Apply a synchronization

Request 11 and request 12: a periodic run copies the university list into PostgreSQL, and
everything else reads PostgreSQL only. No part of the application queries the university
during normal use, because that connection can fail and a desk must keep working.

1. Take a PostgreSQL advisory lock. Refuse the run if another holds it.
2. Fetch the whole source response through `StudentSource`.
3. **Sanity-check the count.** Stop if the response holds fewer records than
   `SYNC_MIN_STUDENTS`, an environment value. An empty response is the extreme case.
4. On any failure, stop and write nothing. A partial retrieval must never change any
   student row.
5. Apply every record inside **one transaction**. Per record: insert the student if new,
   with `created_at`. Then update any column whose value **differs**. **If a value matches,
   write nothing.** One transaction is what makes step 4 true: a database error at record
   12,000 rolls back records 1 to 11,999 as well.
6. When `member` changes, append one entry to `membership_history` in the same statement
   that updates the column. That is request 13, and it is the only history kept.
7. Students absent from the response are left **untouched**. **Never delete a student**,
   and never mark one as gone, because there is no column for it.

⚠️ **On first sight, store the membership status the source reports. Never assume
`true`.** The university list holds every HUJI student, and most are not Aguda members.
Assuming `true` would make all 23,000 eligible for a gift.

**No `sync_runs` table, and no third table of any kind.** Nobody requested run records.
The worker writes each run to its log. The advisory lock releases itself when a connection
dies, so a crash blocks nothing and needs no reaper. See §13.

**Why a fixed minimum, not the previous count.** Comparing with the previous run needs
that count stored somewhere, and §0 forbids a third table. `count(*)` on `students` does not
work either, because students are never deleted, so it grows every year. A fixed minimum
needs no stored state. Set it a little below the real roster, about 20,000 for 23,000
students, and raise it as the roster grows. If that proves too weak, the fix is a
`sync_runs` table, and that means a new line in §14 first.

---

## 6. Authorization

A session is a signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie. CSRF protection has two
layers: a browser does not send a `SameSite=Lax` cookie with a POST from another site, and
the server refuses any POST whose `Origin` header names another origin. The second layer
covers a sibling subdomain, which `SameSite` treats as the same site. Pages that show a
student send `Cache-Control: no-store`, for shared desk computers.

- The session holds `kind` of `student` or `staff`, and the email.
- The server writes `kind` from the `hd` claim. No request can change it.
- Every student route refuses a `staff` session. Every staff route refuses a `student`
  session. Return 403.
- A student session may read and write **only its own** row.

⚠️ Any `aguda.org.il` address is staff, with full staff powers. §14 holds no request for
roles or campus permissions. This is recorded in §13, and it is the largest difference
from the specification.

---

## 7. Hebrew and right to left

- `<html lang="he" dir="rtl">`.
- CSS **logical** properties only: `margin-inline-start`, `padding-inline`. Never
  `margin-left`.
- ⚠️ **Isolate every number inside Hebrew text.** National IDs and timestamps render in
  the wrong order otherwise. Wrap them in `<bdi dir="ltr">`, through the `ltr()` helper in
  `pages.ts`. A staff member misreading an ID is a real distribution error.
- ⚠️ **No gendered new-speak.** Masculine is the neutral form. `.claude/skills/hebrew-text`
  holds the rule, and `test/hebrew-text.test.ts` enforces it.
- Keep all strings in one module, so a later English pass needs no component hunting.
- A system Hebrew font stack. Ship no webfonts.

---

## 8. Fake data, so nothing waits on the university

```ts
interface StudentSource {
  fetchStudents(): Promise<SourceStudent[]>;
}
```

- `FakeSource` — invents Hebrew names, faculties, and membership states. Deterministic
  from a seed.
- `UniversitySource` — the VBA port. Milestone 6.

A fake source tests §5.3 better than the real one, because it produces an empty response,
a 40% count drop, and byte-identical repeat data on demand.

Two CLI tools, carried over from the prototype because they proved useful:
`seed-demo` and `reset-demo`, the second requiring an explicit `--yes`.

---

## 9. Milestones

**M1 — Data and sync.** PostgreSQL in Docker, the two tables, plain SQL migrations,
`FakeSource`, and §5.3 with every safety rule. Tests for repeated import,
membership-history append, and failed-import safety.

**M2 — The three operations.** §5.1 and §5.2 under test, with threaded tests that prove
two students cannot claim the last unit of a gift, and two centers cannot hand the same
gift out twice.

**M3 — Login.** One page, Google, the `hd` routing, sessions.

**M4 — The two interfaces.** Server-rendered Hebrew right-to-left pages. Student: log in,
see membership, select one of four gifts through a confirm step, see a sold-out gift greyed
out, see the locked selection. Staff: search by national ID through a POST, see the gift
and the status, mark it as taken, see the stock, and any
counter drift.

**M5 — AWS.** RDS, the EC2 instance, Caddy with Let's Encrypt, deployment, and a restore
test.

**M6 — University integration. Blocked.** Review and document the VBA script, port it,
map the fields, and set up IP allowlisting.

**Then, and only on request:** anything from §13.

---

## 10. Cost estimate

| Item | Monthly, us-east-1 list price |
|---|---|
| EC2 `t4g.small` | $12.26 |
| Elastic IP in use | $3.65 |
| EBS 20 GB gp3 | $1.60 |
| RDS `db.t4g.micro` | about $11.68 |
| RDS storage 20 GB | about $2.30 |
| **Total** | **about $31.50** |

**EBS and RDS are both present, and they are not alternatives.** EBS is a virtual hard
disk, and every EC2 instance needs one. RDS is a managed database service that AWS runs
on EBS internally. Back up the instance disk with EBS snapshots. Back up the data with
RDS continuous backup. An EBS snapshot is a poor database backup: once a day, and a
restore returns the whole disk.

**No NAT gateway.** The Elastic IP already gives the fixed egress address the university
allowlist needs. A NAT gateway would add about $32 per month for nothing.

Verify in the AWS calculator before committing.

---

## 11. Open questions

| Item | Needed |
|---|---|
| **University integration** | The Excel file, the VBA script, a sample response, credentials, and access instructions. Nothing in M6 can start without these |
| **HUJI Google Workspace** | ⚠️ Does it permit third-party login applications? A Workspace administrator can block them. This is the only item that can force a redesign. Ask HUJI IT in week 1 |
| **Student email domains** | Do all students use `mail.huji.ac.il`? The login allowlist needs the full list |
| **Aguda Google Workspace** | Approve the login application. Aguda controls this, so it needs no outside answer |
| **Network connection** | Choose IP allowlisting, or confirm the Rumba VPN runs unattended. Allowlisting is strongly preferred |
| **Membership source** | How does the university response represent Aguda membership? |
| **Student count** | Confirm the roster size. This plan assumes about 23,000 |
| **Gender codes** | What values does the university send for מגדר? `isFemale()` recognises `נקבה`, `F`, and `female`. Any other value shows the masculine, so an unrecognised code silently addresses every woman as a man |
| **Data retention** | ⚠️ How long is national ID data kept, and who may read it? Settle this **before the first real import** |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| HUJI blocks third-party Google login | Ask in week 1. The fallback is a one-time code by email, which needs AWS SES and a production-access request |
| The VBA script needs an interactive login | Keep `StudentSource` narrow. Everything else runs on `FakeSource`. M6 is independent |
| Any `aguda.org.il` address is staff | Accepted. §14 holds no request for roles. Recorded in §13 |
| A counter drifts from the student rows | Two reconciliation queries in §4.2, run in the test suite and shown on a staff screen |
| Two students claim the last unit of a gift | §5.1 statement 2 is a compare-and-swap on the one `gifts` row. Exactly one succeeds. Threaded tests in M2 prove it |
| A national ID reaches an access log | Never put it in a URL path or query string. Staff lookup is a `POST` with the ID in the body. Redact the field in the Fastify logger |
| Stale local data refuses an eligible student | Show `member_changed_at` beside the status, so staff see how old that student's data is |
| A 23,000-student sync is slow | Load the response into a temporary table and compare with set-based SQL. Measure at full scale on fake data in M1 |
| RTL number rendering misleads staff | The `ltr()` helper wraps every identifier and number. Review on a real device |

---

## 13. Not built. Noted, and recoverable

§0 forbids building anything that serves no line in §14. **Nothing here is a defect.**

This section holds what **nobody has asked for**. §15 holds what the owner asked for and
then deferred. An item moves §13 → §15 → §14, and nothing gets built until it reaches §14.

### Not built

| Specification section | Not built | What it would need |
|---|---|---|
| §5.1 Campaigns | One gift round only. No campaign records, no dates, no per-campaign configuration | A `campaigns` table, and a campaign column on the student gift fields |
| History of profile or academic changes | Only membership changes and interactions are kept. A changed faculty overwrites the old value | A third array, or extra entry kinds |
| A student who left the university is indistinguishable from one who stays | No enrollment column. A graduate with stale membership can still collect | A `present` boolean, set false for students absent from a validated complete response, plus a date if the specification's §10 absence history is wanted |
| Which employee handed a gift over | Not recorded. `gift_taken_at` holds only the time | A `given_by_email` column, written by the §5.2 statement |
| §5.2 Stock per collection location | One counter per gift, across all centers | A `gift_inventory` table keyed by gift and location |
| §7.2 Questionnaire, editable on a screen | Built as request 22, but the questions live in `src/survey.ts`, so a change needs a developer and a deploy | A questions table and an editing screen. The stored answers carry a `version`, so old answers stay readable |
| §6.1, §6.2 Staff accounts and roles | Any `aguda.org.il` address is staff | A `staff_users` table with role and campus columns, and a campus check on every location-scoped route |
| §5.1 Collection locations | Not recorded. The handout stores only the time | `campuses` and `collection_locations` tables |
| §3.2 Sync scheduling UI | The worker runs on a fixed interval | An administrator screen, and a schedule record |
| §3.4 Sync run records | The worker logs. No table | A `sync_runs` table with counts and errors |
| §4.6 Interaction history beyond the gift | `students.interactions` holds gift collections. Merchandise and Kossel have no write path, because no interface was requested | A screen for each new interaction type. The array already accepts them |
| §9 Audit log | Not built | An `audit_log` table |
| §7.5 Student receipt confirmation | Not built | A `student_confirmed_at` column |
| §4.5 Membership periods | `membership_history` holds the change list requested in request 13 | A view over the array with `lead()` |

### Edge cases

| Case | What happens now | What it would need |
|---|---|---|
| A student from an international program has no תעודת זהות | Whatever the university sends is stored. The column is text with no validator | Nothing, unless the value is absent |
| A student studies two programs at once | The second overwrites the first | A `student_programs` table |
| A report must query the arrays across students | `membership_history` and `interactions` need `jsonb_array_elements`, and no index helps | Move the array into its own table with typed columns |
| A student wants a different gift after choosing | Nothing can change it. The student keeps it | §15.1. The owner deferred this flow |
| A lapsed member never renews | Refused at the desk. The unit stays in `requested_count` forever, and no other student can take it | A release path: clear `gift_id` and decrement `requested_count` in one statement |
| A wrong national ID must be corrected | `UPDATE students SET national_id = ...`. No table references it, so nothing else changes | Nothing. Add `ON UPDATE CASCADE` only when a second table points at it |
| The source gives a real effective date | The `at` field records the observation time | An `effective_from` field in each `membership_history` entry |
| The interfaces need English | Hebrew only, with all strings in one module | An i18n framework |

When one of these happens, add a row saying what happened and what the owner decided.
This section is the record of why the design stayed simple.

---

## 14. What the owner explicitly asked for

§0 says to build only this list. Every table must serve a line here. The specification
document is a wish list, and a section in it is not a request.

| # | Request |
|---|---|
| 1 | A student logs in. The site says whether the student is a member |
| 2 | A member selects one of **4** gifts |
| 3 | The student selection is final. The student cannot change it |
| 4 | An employee searches by ID and sees the selected gift and whether it was taken |
| 5 | An employee marks the gift as taken, so it is not given twice |
| 6 | A student with no selection is refused at the desk. No walk-up path |
| 7 | A gift selection never expires |
| 8 | Several employees work at the same time, from separate distribution centers |
| 9 | One identifier only: the national ID. HUJI uses it as the student number |
| 10 | One login page. Google login. `mail.huji.ac.il` shows the student page, `aguda.org.il` shows the staff page |
| 11 | A periodic run copies the university student list into a local database |
| 12 | Everything else reads the local database only |
| 13 | A list of every time a student's membership changed, inside the student row |
| 14 | Hebrew only, right to left |
| 15 | The backend runs on AWS |
| 16 | `gifts` tracks a starting inventory set once, a count of requests, and a count of gifts given |
| 17 | `students` holds the §4.2 university fields that are used: first and last name, gender, HUJI email, phone, and all academic fields |
| 18 | `students` holds a list of interactions: gift collection now, merchandise and Kossel membership later |
| 19 | A student cannot select a sold-out gift. The check belongs at selection, not at distribution |
| 20 | A student must be a member at selection **and** at collection. A lapsed member is refused at the desk, and the unit stays held |
| 21 | Hebrew text uses no gendered new-speak. Text about one known student follows `students.gender`; masculine only when the gender is unknown |
| 22 | Every student, member or not, submits a survey before selecting a gift. Submitted is final: no editing, and no re-asking when questions are added later |

Add a line here when the owner asks for something. Then, and only then, add the table.

---

## 15. Version 2 requirements

Wanted, and deliberately left out of version 1. §13 holds what nobody asked for. This
section holds what the owner asked for and then deferred.

Nothing here gets built until it moves to §14.

### 15.1 An employee changes a student's gift

**Why it is wanted.** A student selects the wrong gift and then arrives at the desk. In
version 1 nobody can correct it, so the student keeps a gift they did not want. This is
the problem the owner originally asked about.

⚠️ **What version 1 must not do.** Do not add any constraint that stops a counter from
falling. Restoring this flow makes `requested_count` decrease, so
`requested_count >= 0` is the only safe check to write.

**What it needs.**

```sql
BEGIN;
  SELECT gift_id AS old_gift_id
    FROM students
   WHERE national_id = $1 AND gift_taken_at IS NULL
     FOR UPDATE;
  -- zero rows: ROLLBACK. The gift was already handed over.

  UPDATE students SET gift_id = $2 WHERE national_id = $1;

  UPDATE gifts SET requested_count = requested_count - 1 WHERE id = old_gift_id;
  UPDATE gifts SET requested_count = requested_count + 1 WHERE id = $2;
COMMIT;
```

- Skip both counter updates when `old_gift_id = $2`, because the employee re-picked the
  same gift.
- A "Change gift" control on the staff row, hidden once `gift_taken_at` is set.
- Threaded tests that prove two employees cannot both decrement the old gift.

**What it costs.** It adds a row lock, the only one outside the sync in §5.3, and
`requested_count` stops being monotonic. Both are acceptable, and both were working before
the owner removed this flow.
