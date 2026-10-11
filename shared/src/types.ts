import type { Actor } from "./actors";
import type { Status } from "./statuses";

export interface Task {
  id: string;
  title: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type AuditEvent = "created" | "status_changed" | "deleted";

interface AuditLogBase {
  id: number;
  taskId: string;
  taskTitle: string;
  actor: Actor;
  createdAt: string;
}

// One variant per event so the allowed from/to combinations are part of the type.
// The audit_logs table has a CHECK constraint with the same rules.
export type AuditLog =
  | (AuditLogBase & { event: "created"; fromStatus: null; toStatus: Status })
  | (AuditLogBase & { event: "status_changed"; fromStatus: Status; toStatus: Status })
  | (AuditLogBase & { event: "deleted"; fromStatus: Status; toStatus: null });

export interface UpdateStatusResponse {
  task: Task;
  changed: boolean;
  auditLog: AuditLog | null;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "STALE_STATUS"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}
