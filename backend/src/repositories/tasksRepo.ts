import type { Status, Task } from "@task-manager/shared";
import type { Db } from "../db/connection";

interface TaskRow {
  id: string;
  title: string;
  status: Status;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function createTasksRepo(db: Db) {
  const insertStatement = db.prepare<Task>(`
    INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at)
    VALUES (@id, @title, @status, @createdAt, @updatedAt, @deletedAt)
  `);

  const selectActiveById = db.prepare<[string], TaskRow>(`
    SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL
  `);

  const selectAnyById = db.prepare<[string], { id: string }>(`
    SELECT id FROM tasks WHERE id = ?
  `);

  // rowid follows insertion order, so it breaks ties between tasks created in the same millisecond.
  const selectActive = db.prepare<[], TaskRow>(`
    SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC
  `);

  const updateStatusStatement = db.prepare<{ id: string; from: Status; to: Status; updatedAt: string }>(`
    UPDATE tasks SET status = @to, updated_at = @updatedAt
    WHERE id = @id AND status = @from AND deleted_at IS NULL
  `);

  const softDeleteStatement = db.prepare<{ id: string; deletedAt: string }>(`
    UPDATE tasks SET deleted_at = @deletedAt WHERE id = @id AND deleted_at IS NULL
  `);

  return {
    insert(task: Task): void {
      insertStatement.run(task);
    },

    findActiveById(id: string): Task | undefined {
      const row = selectActiveById.get(id);
      return row && toTask(row);
    },

    existsIncludingDeleted(id: string): boolean {
      return selectAnyById.get(id) !== undefined;
    },

    listActive(): Task[] {
      return selectActive.all().map(toTask);
    },

    // Returns false when no row matched, which means the status changed since it was read.
    updateStatus(id: string, from: Status, to: Status, updatedAt: string): boolean {
      return updateStatusStatement.run({ id, from, to, updatedAt }).changes === 1;
    },

    // Returns false when no row matched, which means the task was already deleted.
    softDelete(id: string, deletedAt: string): boolean {
      return softDeleteStatement.run({ id, deletedAt }).changes === 1;
    },
  };
}
