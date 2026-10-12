# Mini Task Manager

## What it does

A single-page task list where each task moves forward through `to_do`, `pending`, `in_progress`, and `done`, one step at a time.
Every create, status change, and delete is recorded in an append-only audit log, together with the user who did it.
The backend enforces the rules and owns the data; the frontend only shows what the backend allows.

## How to run

### Prerequisites

- Node.js 22.12 or later (`.nvmrc` pins major version 22; Vite 8 and Vitest 5 need at least 22.12).
- npm 10 (ships with Node 22).
- Internet access to GitHub during `npm install`: `better-sqlite3` downloads a prebuilt binary for your platform and Node version from its GitHub releases. If none matches, npm compiles it instead, which needs Python and a C++ toolchain (on Windows, Visual Studio with the "Desktop development with C++" workload).

### Install

```bash
npm install
```

### Run backend and frontend together

```bash
npm run dev
```

Open http://localhost:5173. The backend listens on http://localhost:3001, and Vite proxies `/api/*` to it with the `/api` prefix removed. The SQLite file is created at `backend/data/app.db` on first start.

### Run them separately

```bash
npm run dev --workspace backend
```

```bash
npm run dev --workspace frontend
```

### Tests and typecheck

```bash
npm test
```

```bash
npm run typecheck
```

Tests use a fresh in-memory database per test. Shared logic tests are in `backend/test/shared/`, endpoint tests in `backend/test/tasksApi.test.ts`, and one test per audit invariant in `backend/test/auditLogInvariants.test.ts`.

### Seed

```bash
npm run seed
```

Creates three tasks through the service layer and moves them to `pending`, `in_progress`, and `done` with different users, then prints the audit log. Running it again adds three more tasks. To start from an empty database, stop the backend and delete `backend/data/app.db` (audit rows cannot be deleted with SQL, see below).

## Architecture

```
shared/src/        statuses, actors, transition rules, types, zod schemas, audit log formatter
backend/src/
  db/              connection with pragmas, schema.sql applied on every boot
  domain/          AppError: an error code and message, no HTTP knowledge
  repositories/    SQL only, and the only place snake_case maps to camelCase
  services/        use cases; each mutation runs in one db.transaction
  routes/          parse X-Actor and body, call the service, map errors to HTTP
  app.ts           builds the Express app around a given database (used by tests)
  server.ts        opens backend/data/app.db and listens on port 3001
  seed.ts          seed script
backend/test/      vitest + supertest
frontend/src/
  api/client.ts    typed fetch wrapper
  components/      actor select, create form, task table and row, status badge, history panel
  App.tsx          holds the actor, the task list, and the history refresh counter
```

`shared` is TypeScript source with no build step. tsx, Vite, Vitest, and tsc all resolve it through the npm workspace link. The zod schemas are exported from `@task-manager/shared/schemas`, separate from the main entry, so the frontend does not load zod.

### A status change request, step by step

`PUT /tasks/:id/status` with body `{ "status": "in_progress" }` and header `X-Actor: john.doe`:

1. **Route** (`routes/tasksRouter.ts`) validates `X-Actor` and the body with the shared zod schemas. Invalid input is a 400 and nothing is read or written.
2. **Service** (`services/tasksService.ts`) opens a `db.transaction` and loads the task where `deleted_at IS NULL`. Missing is a 404.
3. **Rule check**: `evaluateTransition(current, target)` from shared. `noop` returns 200 with `changed: false` and writes nothing. `invalid` is a 409 `INVALID_TRANSITION` with `allowedNext` in `details`.
4. **Write**: `UPDATE tasks ... WHERE id = ? AND status = <status read in step 2> AND deleted_at IS NULL`. If it does not change exactly one row, the result is a 409 `STALE_STATUS`. Otherwise the `status_changed` audit row is inserted and the transaction commits. Any error rolls back both writes.
5. **Response**: the route returns 200 `{ task, changed, auditLog }`. Anything thrown on the way is turned into the standard error body by the error middleware (`routes/errorHandlers.ts`).

## API

Mutating requests require `X-Actor` set to `john.doe`, `jane.smith`, or `budi.santoso`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | /tasks | | 200 `Task[]`, not deleted, newest first | |
| POST | /tasks | `{ title }` | 201 `Task` | 400 |
| PUT | /tasks/:id/status | `{ status }` | 200 `{ task, changed, auditLog }`, `auditLog` is null on a no-op | 400, 404, 409 |
| DELETE | /tasks/:id | | 204 | 400, 404 |
| GET | /tasks/:id/audit-logs | | 200 `AuditLog[]`, oldest first, also for deleted tasks | 404 if the task never existed |

Every error has this body:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Title must not be empty", "details": {} } }
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | bad or missing `X-Actor`, invalid body, malformed JSON |
| `NOT_FOUND` | 404 | unknown or deleted task, unknown route |
| `INVALID_TRANSITION` | 409 | skip, backward move, or any move from `done`; `details.allowedNext` is the one allowed status or null |
| `STALE_STATUS` | 409 | the status changed between read and write (see trade-offs) |
| `INTERNAL_ERROR` | 500 | anything unexpected; the cause is logged on the server |

## Assumptions

- `X-Actor` is trusted as given. There is no authentication; the header only selects one of three known users.
- "Newest first" means by creation time. Tasks created in the same millisecond are ordered by SQLite `rowid`, which follows insertion order.
- Delete sets only `deleted_at`. `updatedAt` is left as the time of the last status change, and `status` keeps its last value, so invariant 5 also holds for deleted tasks.
- Input is validated before the task is looked up, so a bad actor or body on an unknown task is a 400, not a 404.
- An `:id` that is not a UUID is not rejected as malformed; it is simply not found (404).
- Titles are trimmed, then must be 1 to 120 characters as counted by JavaScript string length (an emoji can count as 2). Titles do not need to be unique. A title containing `"` is printed as is inside the log sentence.
- The UI shows status values as their raw strings (`in_progress`), the same text the log sentences use.
- One backend process owns the database file.

## Trade-offs

- **better-sqlite3 is synchronous.** A transaction is a plain function wrapped by `db.transaction`, with no async interleaving, which keeps the service code short. The cost is that each query blocks the event loop, which is fine at this scale. It also means the `STALE_STATUS` guard cannot trigger today and has no test; it is there for a multi-process or async-database setup.
- **Append-only by triggers.** `BEFORE UPDATE` and `BEFORE DELETE` triggers reject changes to `audit_logs`. `PRAGMA recursive_triggers = ON` is also needed: without it, `INSERT OR REPLACE` with an existing id silently replaces an audit row, because SQLite skips delete triggers for REPLACE. This protects against application bugs and accidental SQL. It does not stop someone who drops the trigger first; that would need a separate database role or tamper-evident hashing.
- **The `audit_logs` CHECK constraint** also enforces which status columns may be null for each event. That lets the shared `AuditLog` type be a union per event, and the repository casts rows to it relying on that constraint.
- **Statuses are listed twice**: in `shared/src/statuses.ts` and in the CHECK constraints in `schema.sql`. Adding a status means changing both.
- **Schema applied on every boot** with `IF NOT EXISTS` instead of migrations. Changing an existing table would need a migration step that does not exist yet.
- **PUT takes the target status**, not an "advance" action. Repeating the same request is a no-op instead of a second move, so retries and double clicks are safe.
- **The frontend refetches the whole list** after every mutation instead of patching local state. One extra request per action, but the table always shows what the server has.
- **No `@vitejs/plugin-react`.** Vite compiles TSX using the `jsx` setting in tsconfig. The cost is a full page reload on save instead of React Fast Refresh.
- **Shared has no build step.** Less tooling, but every consumer must be able to compile TypeScript, and the package cannot be published as is.

## What I would improve with more time

In priority order. The first two close the gaps in the answers below; the rest are cleanup.

1. **Authentication.** Take the actor from a session instead of the `X-Actor` header. Until then the audit log records who the client claims to be, not who acted.
2. **PostgreSQL with migrations.** Replace SQLite and the schema-on-boot file, give the app a database role without UPDATE or DELETE on `audit_logs`, and add a real concurrency test for the `STALE_STATUS` guard, which cannot trigger today.
3. **Tamper evidence.** Store a hash of the previous audit row in each row, so a change made with direct database access can be detected even if it cannot be prevented.
4. **One source for statuses.** A test that compares the SQL CHECK lists with the shared constants, so adding a status cannot update one and miss the other.
5. **Frontend tests** for the row states: request in flight, 409 response, and history refresh.
6. **Pagination** for `GET /tasks` and the audit log, once lists get long.

## Answers to the four questions in the brief

### How do you make sure the audit log cannot be modified?

Four layers, from the API down to the database, each covered by a test in `backend/test/auditLogInvariants.test.ts`.

1. **No way in through the app.** No route updates or deletes an audit row, and `auditLogsRepo` only inserts and lists.
2. **Never out of sync.** Each audit row is written in the same `db.transaction` as the task change it describes. If either write fails, both roll back. The test forces the audit insert to fail and checks that the task row is unchanged.
3. **Blocked in the database.** `BEFORE UPDATE` and `BEFORE DELETE` triggers abort any change to `audit_logs`, including raw SQL on the app's own connection. `PRAGMA recursive_triggers = ON` closes the `INSERT OR REPLACE` gap, and a CHECK constraint rejects rows whose shape does not match their event.
4. **Safe from task deletion.** Deleting a task is a soft delete, and `audit_logs.task_id` uses `ON DELETE RESTRICT`, so even a hard delete of a task with history fails. Each row stores the task title at that moment, so history still reads correctly after the task is gone.

What this does not cover: someone with access to the database file can drop the triggers first. These layers prevent changes through the application; they do not detect changes made around it. Item 3 in the improvement list is the detection half.

### Which part is riskiest with many users?

The actor. `X-Actor` is a header the client sets, and the backend only checks that it is one of three names. With many users, anyone can act as anyone, and the audit log will record the wrong person without any sign that it is wrong. The feature exists to answer "who changed what", so a false answer is worse than no answer. That is why authentication is first in the improvement list.

Concurrency is handled correctly today, but only because there is one writer. If two users move the same task from `pending` to `in_progress` at the same moment, better-sqlite3 runs the requests one after the other: the first changes the status and writes the log, the second sees `in_progress` already and returns 200 with `changed: false`, writing nothing. The cost of that safety is throughput, since every query blocks the event loop. After that, the unpaginated lists and the full refetch after every action make load grow with both users and tasks.

### If this grew into a large system, what would you refactor first, and why?

The persistence layer, from SQLite with synchronous transactions to PostgreSQL. It comes first because every guarantee in this app depends on it: atomic writes rely on synchronous `db.transaction` functions, immutability relies on SQLite triggers, and the concurrency guard is untestable with one connection. Moving to Postgres makes transactions explicit and async, turns the `STALE_STATUS` guard into live code that needs real tests, allows a database role without UPDATE or DELETE on the audit table, and brings migrations, since changing an existing table is not possible today.

It is contained: all SQL already lives in `repositories/`, so the change stays inside `db/`, `repositories/`, and the transaction boundaries in `services/`. Routes, shared rules, and the frontend do not change.

Authentication is the bigger risk, but it is an addition behind the existing `X-Actor` seam, not a refactor of what exists.

## AI usage

**Design.** Before writing code I worked through the design in a conversation with Claude: the status rules, how to reconcile "delete task" with "audit logs can never be deleted", the audit event model, the six invariants, the API and error contract, and the folder layout. I turned it into a written spec. The decisions came out of that discussion; I kept the ones I could defend and I can explain each.

**Implementation.** Claude Code wrote most of the code from that spec, in phases: scaffold, shared rules, backend, tests, frontend, README. It stopped after each phase so I could review the diff before continuing.

**How I validated it.**

**What the AI got wrong and how I caught it.**
