import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLog, Task } from "@task-manager/shared";
import type { Db } from "../src/db/connection";
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
});

describe("POST /tasks", () => {
  it("creates a to_do task and writes exactly one created row", async () => {
    const task = await createTask(app, "  Prepare Invoice  ", "jane.smith");

    expect(task).toMatchObject({ title: "Prepare Invoice", status: "to_do", deletedAt: null });
    expect(countAuditRows(db)).toBe(1);

    const logs: AuditLog[] = (await request(app).get(`/tasks/${task.id}/audit-logs`)).body;
    expect(logs).toEqual([
      {
        id: expect.any(Number),
        taskId: task.id,
        taskTitle: "Prepare Invoice",
        event: "created",
        fromStatus: null,
        toStatus: "to_do",
        actor: "jane.smith",
        createdAt: task.createdAt,
      },
    ]);
  });

  it.each([
    ["an empty title", ""],
    ["a whitespace-only title", "   "],
    ["a title over 120 characters", "x".repeat(121)],
    ["a non-string title", 42],
  ])("rejects %s with 400 and writes nothing", async (_label, title) => {
    const res = await request(app).post("/tasks").set("X-Actor", "john.doe").send({ title });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(countTaskRows(db)).toBe(0);
    expect(countAuditRows(db)).toBe(0);
  });

  it("accepts a title of exactly 120 characters", async () => {
    const task = await createTask(app, "x".repeat(120));
    expect(task.title).toHaveLength(120);
  });
});

describe("GET /tasks", () => {
  it("returns tasks that are not deleted, newest first", async () => {
    const first = await createTask(app, "First");
    const second = await createTask(app, "Second");
    const deleted = await createTask(app, "Deleted");
    await request(app).delete(`/tasks/${deleted.id}`).set("X-Actor", "john.doe");

    const res = await request(app).get("/tasks");

    expect(res.status).toBe(200);
    expect(res.body.map((task: Task) => task.id)).toEqual([second.id, first.id]);
  });
});

describe("PUT /tasks/:id/status", () => {
  it("writes one row with the correct from, to, and actor for each forward step", async () => {
    const task = await createTask(app);
    const steps = [
      { from: "to_do", to: "pending", actor: "jane.smith" },
      { from: "pending", to: "in_progress", actor: "budi.santoso" },
      { from: "in_progress", to: "done", actor: "john.doe" },
    ] as const;

    for (const [index, step] of steps.entries()) {
      const res = await putStatus(app, task.id, step.to, step.actor);

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);
      expect(res.body.task.status).toBe(step.to);
      expect(res.body.auditLog).toMatchObject({
        taskId: task.id,
        event: "status_changed",
        fromStatus: step.from,
        toStatus: step.to,
        actor: step.actor,
      });
      // One created row plus one row per step so far.
      expect(countAuditRows(db)).toBe(index + 2);
    }
  });

  it("treats setting the current status again as a no-op that writes nothing", async () => {
    const task = await createTask(app);
    await putStatus(app, task.id, "pending");
    const rowCount = countAuditRows(db);
    const before = readTaskRow(db, task.id);

    const res = await putStatus(app, task.id, "pending");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: false, auditLog: null, task: { status: "pending" } });
    expect(countAuditRows(db)).toBe(rowCount);
    expect(readTaskRow(db, task.id)).toEqual(before);
  });

  it.each([
    ["skipping a step", "to_do", "in_progress", "pending"],
    ["skipping to done", "to_do", "done", "pending"],
    ["moving backward", "pending", "to_do", "in_progress"],
  ] as const)("rejects %s with 409 and changes nothing", async (_label, start, target, allowedNext) => {
    const task = await createTask(app);
    if (start === "pending") {
      await putStatus(app, task.id, "pending");
    }
    const rowCount = countAuditRows(db);

    const res = await putStatus(app, task.id, target);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { allowedNext } });
    expect(readTaskRow(db, task.id)?.status).toBe(start);
    expect(countAuditRows(db)).toBe(rowCount);
  });

  it("treats done as terminal", async () => {
    const task = await createTask(app);
    for (const status of ["pending", "in_progress", "done"] as const) {
      await putStatus(app, task.id, status);
    }
    const rowCount = countAuditRows(db);

    for (const target of ["to_do", "pending", "in_progress"] as const) {
      const res = await putStatus(app, task.id, target);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { allowedNext: null } });
    }

    expect(readTaskRow(db, task.id)?.status).toBe("done");
    expect(countAuditRows(db)).toBe(rowCount);
  });

  it("rejects an unknown status with 400", async () => {
    const task = await createTask(app);
    const res = await request(app)
      .put(`/tasks/${task.id}/status`)
      .set("X-Actor", "john.doe")
      .send({ status: "archived" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for an unknown task", async () => {
    const res = await putStatus(app, "00000000-0000-4000-8000-000000000000", "pending");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("X-Actor header", () => {
  const badActors = [
    ["missing", undefined],
    ["unknown", "mallory"],
  ] as const;

  it.each(badActors)("returns 400 and writes nothing when %s on POST", async (_label, actor) => {
    const req = request(app).post("/tasks").send({ title: "Prepare Invoice" });
    const res = await (actor ? req.set("X-Actor", actor) : req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(countTaskRows(db)).toBe(0);
    expect(countAuditRows(db)).toBe(0);
  });

  it.each(badActors)("returns 400 and writes nothing when %s on PUT", async (_label, actor) => {
    const task = await createTask(app);
    const req = request(app).put(`/tasks/${task.id}/status`).send({ status: "pending" });
    const res = await (actor ? req.set("X-Actor", actor) : req);

    expect(res.status).toBe(400);
    expect(readTaskRow(db, task.id)?.status).toBe("to_do");
    expect(countAuditRows(db)).toBe(1);
  });

  it.each(badActors)("returns 400 and writes nothing when %s on DELETE", async (_label, actor) => {
    const task = await createTask(app);
    const req = request(app).delete(`/tasks/${task.id}`);
    const res = await (actor ? req.set("X-Actor", actor) : req);

    expect(res.status).toBe(400);
    expect(readTaskRow(db, task.id)?.deleted_at).toBeNull();
    expect(countAuditRows(db)).toBe(1);
  });

  it("is checked before the task lookup, so a bad actor on an unknown task is 400", async () => {
    const res = await request(app)
      .put("/tasks/00000000-0000-4000-8000-000000000000/status")
      .send({ status: "pending" });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /tasks/:id", () => {
  it("hides the task, keeps its audit logs, and ends them with a deleted row", async () => {
    const task = await createTask(app);
    await putStatus(app, task.id, "pending");
    await putStatus(app, task.id, "in_progress");
    const logsBefore: AuditLog[] = (await request(app).get(`/tasks/${task.id}/audit-logs`)).body;

    const res = await request(app).delete(`/tasks/${task.id}`).set("X-Actor", "budi.santoso");
    expect(res.status).toBe(204);

    const list = await request(app).get("/tasks");
    expect(list.body).toEqual([]);

    const logsAfter = await request(app).get(`/tasks/${task.id}/audit-logs`);
    expect(logsAfter.status).toBe(200);
    // Invariant 4: earlier rows are untouched; the delete only appends.
    expect(logsAfter.body.slice(0, logsBefore.length)).toEqual(logsBefore);
    expect(logsAfter.body).toHaveLength(logsBefore.length + 1);
    expect(logsAfter.body.at(-1)).toMatchObject({
      event: "deleted",
      fromStatus: "in_progress",
      toStatus: null,
      actor: "budi.santoso",
    });
  });

  it("returns 404 for PUT or DELETE on a deleted task", async () => {
    const task = await createTask(app);
    await request(app).delete(`/tasks/${task.id}`).set("X-Actor", "john.doe");
    const rowCount = countAuditRows(db);

    const put = await putStatus(app, task.id, "pending");
    const secondDelete = await request(app).delete(`/tasks/${task.id}`).set("X-Actor", "john.doe");

    expect(put.status).toBe(404);
    expect(secondDelete.status).toBe(404);
    expect(countAuditRows(db)).toBe(rowCount);
  });

  it("returns 404 for an unknown task", async () => {
    const res = await request(app)
      .delete("/tasks/00000000-0000-4000-8000-000000000000")
      .set("X-Actor", "john.doe");

    expect(res.status).toBe(404);
  });
});

describe("GET /tasks/:id/audit-logs", () => {
  it("returns 404 for a task that never existed", async () => {
    const res = await request(app).get("/tasks/00000000-0000-4000-8000-000000000000/audit-logs");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("error body", () => {
  it("uses the standard shape for malformed JSON", async () => {
    const res = await request(app)
      .post("/tasks")
      .set("X-Actor", "john.doe")
      .set("Content-Type", "application/json")
      .send('{"title":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: expect.any(String), details: {} },
    });
  });

  it("uses the standard shape for unknown routes", async () => {
    const res = await request(app).get("/nothing-here");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String), details: {} },
    });
  });
});
