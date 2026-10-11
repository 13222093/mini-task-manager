import { randomUUID } from "node:crypto";
import {
  evaluateTransition,
  type Actor,
  type AuditLog,
  type Status,
  type Task,
  type UpdateStatusResponse,
} from "@task-manager/shared";
import type { Db } from "../db/connection";
import { AppError } from "../domain/errors";
import { createAuditLogsRepo } from "../repositories/auditLogsRepo";
import { createTasksRepo } from "../repositories/tasksRepo";

function taskNotFound(taskId: string): AppError {
  return new AppError("NOT_FOUND", `Task ${taskId} not found`);
}

function invalidTransition(current: Status, target: Status, allowedNext: Status | null): AppError {
  const reason =
    allowedNext === null
      ? `"${current}" is a final status`
      : `the only allowed next status is "${allowedNext}"`;
  return new AppError(
    "INVALID_TRANSITION",
    `Cannot change status from "${current}" to "${target}": ${reason}`,
    { allowedNext },
  );
}

export function createTasksService(db: Db) {
  const tasks = createTasksRepo(db);
  const auditLogs = createAuditLogsRepo(db);

  // Each mutation runs inside db.transaction, which commits when the function
  // returns and rolls back when it throws. The task write and its audit row are
  // therefore saved together or not at all.

  const createTask = db.transaction((title: string, actor: Actor): Task => {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title,
      status: "to_do",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    tasks.insert(task);
    auditLogs.insert({
      taskId: task.id,
      taskTitle: task.title,
      event: "created",
      fromStatus: null,
      toStatus: task.status,
      actor,
      createdAt: now,
    });
    return task;
  });

  const updateStatus = db.transaction(
    (taskId: string, target: Status, actor: Actor): UpdateStatusResponse => {
      const task = tasks.findActiveById(taskId);
      if (!task) {
        throw taskNotFound(taskId);
      }

      const transition = evaluateTransition(task.status, target);
      if (transition.kind === "noop") {
        return { task, changed: false, auditLog: null };
      }
      if (transition.kind === "invalid") {
        throw invalidTransition(task.status, target, transition.allowedNext);
      }

      const now = new Date().toISOString();
      // The UPDATE only matches if the status is still the one read above. With one
      // synchronous connection that is always true, but the guard protects against
      // concurrent writers if the app ever runs as more than one process or moves
      // to an async database.
      if (!tasks.updateStatus(task.id, task.status, target, now)) {
        throw new AppError(
          "STALE_STATUS",
          "The task status changed while this request was running. Reload and try again.",
        );
      }
      const auditLog = auditLogs.insert({
        taskId: task.id,
        taskTitle: task.title,
        event: "status_changed",
        fromStatus: task.status,
        toStatus: target,
        actor,
        createdAt: now,
      });
      return { task: { ...task, status: target, updatedAt: now }, changed: true, auditLog };
    },
  );

  const deleteTask = db.transaction((taskId: string, actor: Actor): void => {
    const task = tasks.findActiveById(taskId);
    if (!task) {
      throw taskNotFound(taskId);
    }

    const now = new Date().toISOString();
    // Same concurrent-writer guard as in updateStatus.
    if (!tasks.softDelete(task.id, now)) {
      throw taskNotFound(taskId);
    }
    auditLogs.insert({
      taskId: task.id,
      taskTitle: task.title,
      event: "deleted",
      fromStatus: task.status,
      toStatus: null,
      actor,
      createdAt: now,
    });
  });

  function listTasks(): Task[] {
    return tasks.listActive();
  }

  // Deleted tasks keep their history, so only a task that never existed is a 404.
  function listAuditLogs(taskId: string): AuditLog[] {
    if (!tasks.existsIncludingDeleted(taskId)) {
      throw taskNotFound(taskId);
    }
    return auditLogs.listByTaskId(taskId);
  }

  return { listTasks, createTask, updateStatus, deleteTask, listAuditLogs };
}

export type TasksService = ReturnType<typeof createTasksService>;
