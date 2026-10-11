import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLog, Status } from "@task-manager/shared";
import type { Db } from "../src/db/connection";
import { createAuditLogsRepo } from "../src/repositories/auditLogsRepo";
import {
  countAuditRows,
  countTaskRows,
  createTask,
  createTestContext,
  putStatus,
  readTaskRow,
  type App,
} from "./helpers";

let db: Db;
let app: App;

beforeEach(() => {
  ({ db, app } = createTestContext());
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

// Makes every audit insert fail, so a mutation fails after its task write.
function breakAuditInserts() {
  db.exec(`
    CREATE TEMP TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;
  `);
  // The error middleware logs unexpected errors; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("invariant 1: a task write and its audit row are saved together or not at all", () => {
  it("rolls back the status change when the audit insert fails", async () => {
    const task = await createTask(app);
    const before = readTaskRow(db, task.id);
    breakAuditInserts();

    const res = await putStatus(app, task.id, "pending");

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(readTaskRow(db, task.id)).toEqual(before);
    expect(countAuditRows(db)).toBe(1);
  });

  it("rolls back task creation when the audit insert fails", async () => {
    breakAuditInserts();

    const res = await request(app).post("/tasks").set("X-Actor", "john.doe").send({ title: "Prepare Invoice" });

    expect(res.status).toBe(500);
    expect(countTaskRows(db)).toBe(0);
  });

  it("rolls back the delete when the audit insert fails", async () => {
    const task = await createTask(app);
    breakAuditInserts();

    const res = await request(app).delete(`/tasks/${task.id}`).set("X-Actor", "john.doe");

    expect(res.status).toBe(500);
    expect(readTaskRow(db, task.id)?.deleted_at).toBeNull();
  });
});

describe("invariant 3: audit rows cannot be updated or deleted", () => {
  it("rejects raw UPDATE, DELETE, and INSERT OR REPLACE on the app's connection", async () => {
    const task = await createTask(app);
    const before = db.prepare("SELECT * FROM audit_logs").all();

    expect(() => db.prepare("UPDATE audit_logs SET actor = 'jane.smith'").run()).toThrow(
      "audit_logs is append-only",
    );
    expect(() => db.prepare("DELETE FROM audit_logs").run()).toThrow("audit_logs is append-only");
    // REPLACE removes the conflicting row first; recursive_triggers makes that hit the delete trigger.
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO audit_logs
             (id, task_id, task_title, event, from_status, to_status, actor, created_at)
           VALUES (1, ?, 'Rewritten', 'created', NULL, 'to_do', 'jane.smith', '2000-01-01T00:00:00.000Z')`,
        )
        .run(task.id),
    ).toThrow("audit_logs is append-only");

    expect(db.prepare("SELECT * FROM audit_logs").all()).toEqual(before);
  });
});

describe("invariant 4: deleting a task never removes its audit rows", () => {
  it("blocks a hard delete of a task that has audit rows", async () => {
    const task = await createTask(app);

    expect(() => db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id)).toThrow(
      "FOREIGN KEY constraint failed",
    );
    expect(countAuditRows(db)).toBe(1);
  });
});

describe("invariant 5: the latest created or status_changed row matches the task status", () => {
  it("holds for every task after a mixed sequence of operations", async () => {
    const invoice = await createTask(app, "Prepare Invoice", "john.doe");
    const contract = await createTask(app, "Review contract", "jane.smith");
    const venue = await createTask(app, "Book venue", "budi.santoso");
    const report = await createTask(app, "Write report", "john.doe");

    await putStatus(app, invoice.id, "pending", "jane.smith");
    await putStatus(app, invoice.id, "pending", "jane.smith"); // no-op
    await putStatus(app, invoice.id, "in_progress", "budi.santoso");
    await putStatus(app, contract.id, "in_progress"); // invalid skip
    await putStatus(app, contract.id, "pending", "budi.santoso");
    await putStatus(app, venue.id, "pending");
    await putStatus(app, venue.id, "in_progress");
    await putStatus(app, venue.id, "done", "jane.smith");
    await putStatus(app, venue.id, "pending"); // invalid backward move
    await request(app).put(`/tasks/${report.id}/status`).send({ status: "pending" }); // missing actor
    await request(app).delete(`/tasks/${contract.id}`).set("X-Actor", "john.doe");
    await putStatus(app, contract.id, "in_progress"); // deleted task

    const rows = db
      .prepare<[], { id: string; status: Status; last_to_status: Status | null }>(
        `SELECT t.id, t.status, (
           SELECT a.to_status FROM audit_logs a
           WHERE a.task_id = t.id AND a.event IN ('created', 'status_changed')
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 1
         ) AS last_to_status
         FROM tasks t`,
      )
      .all();

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.last_to_status, `task ${row.id}`).toBe(row.status);
    }
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [invoice.id]: "in_progress",
      [contract.id]: "pending",
      [venue.id]: "done",
      [report.id]: "to_do",
    });
  });
});

describe("invariant 6: audit logs are returned in chronological order", () => {
  it("orders by created_at, then by id for equal timestamps", async () => {
    const task = await createTask(app);
    const auditLogs = createAuditLogsRepo(db);
    // Inserted out of time order, as after a clock adjustment, so id order alone would be wrong.
    const entry = {
      taskId: task.id,
      taskTitle: task.title,
      event: "status_changed",
      fromStatus: "to_do",
      toStatus: "pending",
      actor: "john.doe",
    } as const;
    const later = auditLogs.insert({ ...entry, createdAt: "2099-01-01T00:00:02.000Z" });
    const earlier = auditLogs.insert({ ...entry, createdAt: "2099-01-01T00:00:01.000Z" });
    const sameTime = auditLogs.insert({ ...entry, createdAt: "2099-01-01T00:00:01.000Z" });

    const res = await request(app).get(`/tasks/${task.id}/audit-logs`);

    expect(res.body.map((log: AuditLog) => log.id)).toEqual([
      res.body[0].id, // the created row, timestamped now
      earlier.id,
      sameTime.id,
      later.id,
    ]);
    expect(res.body[0].event).toBe("created");
  });
});
