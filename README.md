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

- Real authentication, with the actor taken from the session instead of a header.
- Pagination for `GET /tasks` and the audit log.
- A production setup: compile the backend, build the frontend, and serve both from one process. Today only the dev setup exists.
- Schema migrations instead of an idempotent schema file.
- Generate the SQL CHECK lists from the shared constants, or add a test that compares them.
- Frontend tests for row states: in-flight, 409, and history refresh.
- Tamper evidence for the audit log, for example each row storing a hash of the previous one.

## Answers to the four questions in the brief

_To be written._

## AI usage

_To be written._
