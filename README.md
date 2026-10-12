# Mini Task Manager

**Live demo:** <https://mini-task-manager-844260334143.asia-southeast2.run.app>. It runs on Cloud Run, resets whenever the instance restarts, and has no authentication, so anyone can act as any of the three users; for the real setup, run it locally.

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

Tests use a fresh in-memory database per test. Shared logic tests are in `backend/test/shared/`, endpoint tests in `backend/test/tasksApi.test.ts`, and the audit log guarantees (atomic writes, append-only rows, row shape, title snapshot, status consistency, ordering) in `backend/test/auditLogInvariants.test.ts`.

### Seed

```bash
npm run seed
```

Creates three tasks through the service layer and moves them to `pending`, `in_progress`, and `done` with different users, then prints the audit log. Running it again adds three more tasks. To start from an empty database, stop the backend and delete `backend/data/app.db` (audit rows cannot be deleted with SQL, see below).

## Production build and deploy

In production one server handles both parts: `backend/src/serve.ts` serves the API under `/api` and the built frontend from `frontend/dist`, on port `PORT` or 8080.

### Run it locally

```bash
npm run build
```

```bash
npm run start
```

Open http://localhost:8080. `npm run start` uses the same `backend/data/app.db` as `npm run dev`.

`DEMO_SEED=1` makes `serve.ts` create the three seed tasks at startup when the task list is empty. It is meant for the container, whose database starts empty after every restart; run locally, it seeds your development database. In bash:

```bash
DEMO_SEED=1 npm run start
```

In Windows PowerShell:

```powershell
$env:DEMO_SEED="1"; npm run start
```

### Docker

```bash
docker build -t mini-task-manager .
```

```bash
docker run --rm -p 8080:8080 -e DEMO_SEED=1 mini-task-manager
```

Open http://localhost:8080. Both commands are the same in bash and PowerShell. The image is 92 MB compressed (383 MB on disk).

### Deploy to Cloud Run

Prerequisites: the gcloud CLI signed in with `gcloud auth login`, and a Google Cloud project with billing enabled, selected with `gcloud config set project PROJECT_ID`.

Enable the APIs once:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Deploy from the repository root:

```bash
gcloud run deploy mini-task-manager --source . --region asia-southeast2 --allow-unauthenticated --max-instances 1 --min-instances 0 --set-env-vars DEMO_SEED=1
```

`--source .` builds the Dockerfile with Cloud Build, stores the image in Artifact Registry, and deploys it to Cloud Run in Jakarta. `--allow-unauthenticated` makes it public. `--min-instances 0` lets it scale to zero, so no instance is billed while it is idle. Cloud Run sends requests to port 8080, which is the default in `serve.ts`. Why there is at most one instance, and what happens to the data, is under Trade-offs.

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
  server.ts        development entry: opens backend/data/app.db and listens on port 3001
  serve.ts         production entry: the API under /api plus frontend/dist, on PORT or 8080
  seed.ts          seed script
  demoSeed.ts      the demo tasks, used by seed.ts and by serve.ts when DEMO_SEED=1
backend/test/      vitest + supertest
frontend/src/
  api/client.ts    typed fetch wrapper
  components/      actor select, create form, task table and row, status badge, history panel
  App.tsx          holds the actor, the task list, and the history refresh counter
Dockerfile         builds the frontend, then runs serve.ts with tsx as the non-root node user
```

`shared` is TypeScript source with no build step. tsx, Vite, Vitest, and tsc all resolve it through the npm workspace link. The zod schemas are exported from `@task-manager/shared/schemas`, separate from the main entry, so the frontend does not load zod.

The frontend always calls `/api/...`. In development the Vite proxy strips `/api` before forwarding to port 3001; in production `serve.ts` mounts the API under `/api`. Either way the API itself sees `/tasks...`, so both setups present the same paths. For the same reason, the JSON 404 for an unknown API path shows the path without the `/api` prefix in both.

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

- **better-sqlite3 is synchronous.** A transaction is a plain function wrapped by `db.transaction`, with no async interleaving, which keeps the service code short. The cost is that only one query runs at a time, and each one blocks the event loop. That suits a small internal tool, not heavy traffic. It also means the `STALE_STATUS` guard cannot trigger today and has no test; it is there for a multi-process or async-database setup.
- **Append-only by triggers.** `BEFORE UPDATE` and `BEFORE DELETE` triggers reject changes to `audit_logs`. `PRAGMA recursive_triggers = ON` is also needed: without it, `INSERT OR REPLACE` with an existing id silently replaces an audit row, because SQLite skips delete triggers for REPLACE. This protects against application bugs and accidental SQL. It does not stop someone who drops the trigger first; that would need a separate database role or tamper-evident hashing.
- **The `audit_logs` CHECK constraint** also enforces which status columns may be null for each event. That lets the shared `AuditLog` type be a union per event, and the repository casts rows to it relying on that constraint.
- **Statuses are listed twice**: in `shared/src/statuses.ts` and in the CHECK constraints in `schema.sql`. Adding a status means changing both.
- **Schema applied on every boot** with `IF NOT EXISTS` instead of migrations. Changing an existing table would need a migration step that does not exist yet.
- **PUT takes the target status**, not an "advance" action. Repeating the same request is a no-op instead of a second move, so retries and double clicks are safe. The cost is that the frontend has to know which status comes next; it gets it from `nextStatus` in shared, the same rule the backend enforces.
- **Delete only hides a task** by setting `deleted_at`. Its history stays complete, and every audit row still points at an existing task. The cost is that deleted tasks stay in the database.
- **The frontend refetches the whole list** after every mutation instead of patching local state. One extra request per action, but the table always shows what the server has.
- **No `@vitejs/plugin-react`.** Vite compiles TSX using the `jsx` setting in tsconfig. The cost is a full page reload on save instead of React Fast Refresh.
- **Shared has no build step.** Less tooling, but every consumer must be able to compile TypeScript, and the package cannot be published as is.
- **tsx at runtime instead of a compiled build.** The container runs `serve.ts` with tsx, the same way development does. That keeps one code path for both, keeps the `import.meta.url` paths to `schema.sql` and `backend/data` valid, and avoids a build step for `shared`. The cost is that TypeScript is compiled on every start, and the image carries tsx and esbuild as runtime dependencies.
- **SQLite on the container's in-memory disk, one instance.** On Cloud Run the database file lives on the instance's in-memory filesystem, so a second instance would have its own separate data. `--max-instances 1` keeps it to one. The data resets whenever the instance restarts or scales to zero, and `DEMO_SEED=1` recreates the demo tasks. `--max-instances 1` is not a hard limit: during a deploy or a traffic spike two instances can briefly run, each with its own SQLite file.

## What I would improve with more time

In priority order. The first two close the gaps in the answers below; the rest are cleanup.

1. **Authentication.** Take the actor from a session instead of the `X-Actor` header. Until then the audit log records who the client claims to be, not who acted.
2. **PostgreSQL with migrations.** Replace SQLite and the schema-on-boot file, give the app a database role without UPDATE or DELETE on `audit_logs`, and add a real concurrency test for the `STALE_STATUS` guard, which cannot trigger today. It would also let the hosted demo keep its data and run more than one instance.
3. **Tamper evidence.** Store a hash of the previous audit row in each row, so a change made with direct database access can be detected even if it cannot be prevented.
4. **One source for statuses.** A test that compares the SQL CHECK lists with the shared constants, so adding a status cannot update one and miss the other.
5. **Frontend tests** for the row states: request in flight, 409 response, and history refresh.
6. **Pagination** for `GET /tasks` and the audit log, once lists get long.

## Answers to the four questions in the brief

### How do you make sure the audit log cannot be modified?

Four layers, from the API down to the database. Layers 2 to 4 are covered by tests in `backend/test/auditLogInvariants.test.ts`; layer 1 is checked by reading the code, since a test cannot show that a code path is absent.

1. **No way in through the app.** No route updates or deletes an audit row, and `auditLogsRepo` only inserts and lists.
2. **Never out of sync.** Each audit row is written in the same `db.transaction` as the task change it describes. If either write fails, both roll back. The test forces the audit insert to fail and checks that the task row is unchanged.
3. **Blocked in the database.** `BEFORE UPDATE` and `BEFORE DELETE` triggers abort any change to `audit_logs`, including raw SQL on the app's own connection. `PRAGMA recursive_triggers = ON` closes the `INSERT OR REPLACE` gap, and a CHECK constraint rejects rows whose shape does not match their event.
4. **Safe from task deletion.** Deleting a task is a soft delete, and `audit_logs.task_id` uses `ON DELETE RESTRICT`, so even a hard delete of a task with history fails. Each row stores the task title at that moment, so history still reads correctly after the task is gone.

What this does not cover: someone with access to the database file can drop the triggers first. These layers prevent changes through the application; they do not detect changes made around it. Item 3 in the improvement list is the detection half.

### Which part is riskiest with many users?

The actor. `X-Actor` is a header the client sets, and the backend only checks that it is one of three names. With many users, anyone can act as anyone, and the audit log will record the wrong person without any sign that it is wrong. The feature exists to answer "who changed what", so a false answer is worse than no answer. That is why authentication is first in the improvement list.

Concurrency is handled correctly today, but only because there is one writer. If two users move the same task from `pending` to `in_progress` at the same moment, better-sqlite3 runs the requests one after the other: the first changes the status and writes the log, the second sees `in_progress` already and returns 200 with `changed: false`, writing nothing. The cost of that safety is throughput, since every query blocks the event loop. After that, the unpaginated lists and the full refetch after every action make load grow with both users and tasks.

### If this grew into a large system, what would you refactor first, and why?

The persistence layer, from SQLite with synchronous transactions to PostgreSQL. It comes first because every guarantee in this app depends on it: atomic writes rely on synchronous `db.transaction` functions, immutability relies on SQLite triggers, and the concurrency guard is untestable with one connection. Moving to Postgres makes transactions explicit and async, turns the `STALE_STATUS` guard into live code that needs real tests, allows a database role without UPDATE or DELETE on the audit table, and brings migrations, since today there is no step for changing an existing table.

It is mostly contained: all queries already live in `repositories/`, so most of the change stays inside `db/`, `repositories/`, and the transaction boundaries in `services/`. The routes change only mechanically: with an async database the service functions return promises, so every handler has to await them. The tests that read the database directly through better-sqlite3 need rewriting too. Shared rules and the frontend do not change.

Authentication is the bigger risk, but it is an addition behind the existing `X-Actor` seam, not a refactor of what exists.

## AI usage

**Design.** Before writing code I worked through the design in a conversation with Claude: the status rules, how to reconcile "delete task" with "audit logs can never be deleted", the audit event model, the six invariants, the API and error contract, and the folder layout. I turned it into a written spec. The decisions came out of that discussion; I kept the ones I could defend and I can explain each.

**Implementation.** Claude Code wrote most of the code from that spec, in phases: scaffold, shared rules, backend, tests, frontend, README. The spec said to stop after each phase for review, but early in the first phase I told it to run through all of them without stopping. For the deployment work it did stop after each phase.

**How I validated it.** I did not treat passing tests as proof, because the same tool wrote both the code and the tests.

1. I read the files that carry the guarantees (`schema.sql`, the tasks service, the router, the audit log repository, and the transition rules in `shared`) until I could explain them without notes.
2. I broke the code on purpose to check that the tests notice. Removing the update trigger, removing the transaction around a status change, turning `recursive_triggers` off, and making a same-status update count as a change each made at least one test fail.
3. I used the app by hand: double-clicked a status button, switched users, and deleted a task and opened its history. The UI only offers the next status, so skips and backward moves were checked with curl.
4. I cloned the repo fresh on Windows and followed the README step by step. The container was checked the same way in Cloud Shell: build, run, and a curl script covering every endpoint and error case.
5. I checked every claim in this README against the code.

**What the AI got wrong and how I caught it.** The clearest case is this README. Claude wrote the first draft of these answers, and when I checked each claim against the code, three were wrong in ways that sounded right. It said every layer of audit-log protection was covered by a test, but there was no test for the per-event CHECK constraint or for the task title snapshot; I added both. It said moving to Postgres would leave the routes unchanged, but async services mean every route has to await them. And it described a phase-by-phase review of the main build that did not happen that way. I rewrote all three. In an audit feature, a confident claim about a guarantee that nothing checks is exactly the kind of error that matters.

A second case, during the deployment work: Claude Code deleted the test data in my local database without asking. Audit rows cannot be deleted with SQL, so I asked how it had done it. It had stopped the server and deleted the database file itself, without running any SQL, and the git history showed `schema.sql` and its triggers unchanged since they were written. I then set a rule that it asks before deleting any data, even local test data.
