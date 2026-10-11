import type { AuditLog } from "./types";

export type FormatTime = (isoTimestamp: string) => string;

export function formatAuditLog(log: AuditLog, formatTime: FormatTime): string {
  const user = `User "${log.actor}"`;
  const task = `Task "${log.taskTitle}"`;
  const at = `at ${formatTime(log.createdAt)}`;

  switch (log.event) {
    case "created":
      return `${user} created ${task} with status "${log.toStatus}" ${at}`;
    case "status_changed":
      return `${user} changed ${task} status from "${log.fromStatus}" to "${log.toStatus}" ${at}`;
    case "deleted":
      return `${user} deleted ${task} (last status "${log.fromStatus}") ${at}`;
  }
}

// Both time formatters produce "YYYY-MM-DD HH:mm".

export function formatUtcTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().slice(0, 16).replace("T", " ");
}

export function formatLocalTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
