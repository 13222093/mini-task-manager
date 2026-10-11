import request from "supertest";
import { expect } from "vitest";
import type { Actor, Status, Task } from "@task-manager/shared";
import { createApp } from "../src/app";
import { openDatabase, type Db } from "../src/db/connection";

export type App = ReturnType<typeof createApp>;

// Every test gets its own in-memory database, so no state leaks between tests.
export function createTestContext(): { db: Db; app: App } {
  const db = openDatabase(":memory:");
  return { db, app: createApp(db) };
}

export async function createTask(app: App, title = "Prepare Invoice", actor: Actor = "john.doe"): Promise<Task> {
  const res = await request(app).post("/tasks").set("X-Actor", actor).send({ title });
  expect(res.status).toBe(201);
  return res.body;
}

export function putStatus(app: App, taskId: string, status: Status, actor: Actor = "john.doe") {
  return request(app).put(`/tasks/${taskId}/status`).set("X-Actor", actor).send({ status });
}

export function countAuditRows(db: Db): number {
  return db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM audit_logs").get()!.count;
}

export function countTaskRows(db: Db): number {
  return db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM tasks").get()!.count;
}

// Reads the stored row directly, including soft-deleted tasks.
export function readTaskRow(db: Db, taskId: string) {
  return db
    .prepare<[string], { status: Status; updated_at: string; deleted_at: string | null }>(
      "SELECT status, updated_at, deleted_at FROM tasks WHERE id = ?",
    )
    .get(taskId);
}
