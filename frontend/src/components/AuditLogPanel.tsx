import { useEffect, useState } from "react";
import { formatAuditLog, formatLocalTime, type AuditLog } from "@task-manager/shared";
import { api, errorMessage } from "../api/client";

interface Props {
  taskId: string;
  // Changes after every successful mutation, which triggers a refetch.
  version: number;
}

export function AuditLogPanel({ taskId, version }: Props) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ignore a response that arrives after the panel closed or a newer fetch started.
    let ignore = false;
    api.listAuditLogs(taskId).then(
      (result) => {
        if (!ignore) {
          setLogs(result);
          setError(null);
        }
      },
      (err: unknown) => {
        if (!ignore) {
          setError(errorMessage(err));
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [taskId, version]);

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!logs) {
    return <p className="muted">Loading history</p>;
  }
  return (
    <ol className="audit-log">
      {logs.map((log) => (
        <li key={log.id}>{formatAuditLog(log, formatLocalTime)}</li>
      ))}
    </ol>
  );
}
