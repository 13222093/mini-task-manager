import { useState } from "react";
import { formatLocalTime, nextStatus, type Actor, type Task } from "@task-manager/shared";
import { api, ApiError, errorMessage } from "../api/client";
import { AuditLogPanel } from "./AuditLogPanel";
import { StatusBadge } from "./StatusBadge";

interface Props {
  task: Task;
  actor: Actor;
  historyVersion: number;
  onMutated: () => Promise<void>;
  onConflict: () => Promise<void>;
}

export function TaskRow({ task, actor, historyVersion, onMutated, onConflict }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const next = nextStatus(task.status);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onMutated();
    } catch (err) {
      setError(errorMessage(err));
      // A 409 means this row is out of date, so reload it.
      if (err instanceof ApiError && err.status === 409) {
        await onConflict();
      }
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    if (window.confirm(`Delete task "${task.title}"?`)) {
      void run(() => api.deleteTask(task.id, actor));
    }
  }

  return (
    <>
      <tr>
        <td>{task.title}</td>
        <td>
          <StatusBadge status={task.status} />
        </td>
        <td>
          <time dateTime={task.updatedAt}>{formatLocalTime(task.updatedAt)}</time>
        </td>
        <td>
          <div className="actions">
            {next && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.updateStatus(task.id, next, actor))}
              >
                Move to {next}
              </button>
            )}
            <button type="button" disabled={busy} onClick={handleDelete}>
              Delete
            </button>
            <button
              type="button"
              disabled={busy}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              History
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </td>
      </tr>
      {historyOpen && (
        <tr className="history-row">
          <td colSpan={4}>
            <AuditLogPanel taskId={task.id} version={historyVersion} />
          </td>
        </tr>
      )}
    </>
  );
}
