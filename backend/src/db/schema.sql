-- Applied on every boot, so every statement must be idempotent.

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('to_do', 'pending', 'in_progress', 'done')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Tasks are soft-deleted, so RESTRICT never fires in normal use. It is a guard.
  task_id     TEXT NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  task_title  TEXT NOT NULL,
  event       TEXT NOT NULL CHECK (event IN ('created', 'status_changed', 'deleted')),
  from_status TEXT CHECK (from_status IN ('to_do', 'pending', 'in_progress', 'done')),
  to_status   TEXT CHECK (to_status IN ('to_do', 'pending', 'in_progress', 'done')),
  actor       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  -- Which status columns may be null depends on the event. Matches the AuditLog type in shared.
  CHECK (
    (event = 'created' AND from_status IS NULL AND to_status = 'to_do')
    OR (event = 'status_changed' AND from_status IS NOT NULL AND to_status IS NOT NULL)
    OR (event = 'deleted' AND from_status IS NOT NULL AND to_status IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS audit_logs_task_id ON audit_logs (task_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
