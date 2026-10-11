import type { Actor, AuditEvent, AuditLog, Status } from "@task-manager/shared";
import type { Db } from "../db/connection";

export interface NewAuditLog {
  taskId: string;
  taskTitle: string;
  event: AuditEvent;
  fromStatus: Status | null;
  toStatus: Status | null;
  actor: Actor;
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  task_id: string;
  task_title: string;
  event: AuditEvent;
  from_status: Status | null;
  to_status: Status | null;
  actor: Actor;
  created_at: string;
}

function toAuditLog(row: AuditLogRow): AuditLog {
  // The table's CHECK constraint guarantees that event, from_status, and to_status
  // form one of the AuditLog variants. TypeScript cannot see that, hence the cast.
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    event: row.event,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: row.actor,
    createdAt: row.created_at,
  } as AuditLog;
}

// Insert and select only. The table is append-only, enforced by triggers in schema.sql.
export function createAuditLogsRepo(db: Db) {
  const insertStatement = db.prepare<NewAuditLog, AuditLogRow>(`
    INSERT INTO audit_logs (task_id, task_title, event, from_status, to_status, actor, created_at)
    VALUES (@taskId, @taskTitle, @event, @fromStatus, @toStatus, @actor, @createdAt)
    RETURNING *
  `);

  const selectByTaskId = db.prepare<[string], AuditLogRow>(`
    SELECT * FROM audit_logs WHERE task_id = ? ORDER BY created_at ASC, id ASC
  `);

  return {
    insert(entry: NewAuditLog): AuditLog {
      // INSERT ... RETURNING always yields the inserted row.
      return toAuditLog(insertStatement.get(entry)!);
    },

    listByTaskId(taskId: string): AuditLog[] {
      return selectByTaskId.all(taskId).map(toAuditLog);
    },
  };
}
