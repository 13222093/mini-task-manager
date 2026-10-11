import { describe, expect, it } from "vitest";
import { formatAuditLog, formatUtcTime, type AuditLog } from "@task-manager/shared";

const base = {
  id: 1,
  taskId: "6f1c2a8e-0000-4000-8000-000000000000",
  taskTitle: "Prepare Invoice",
  actor: "john.doe",
} as const;

describe("formatAuditLog", () => {
  it("formats a created event", () => {
    const log: AuditLog = {
      ...base,
      event: "created",
      fromStatus: null,
      toStatus: "to_do",
      createdAt: "2025-01-01T09:00:00.000Z",
    };
    expect(formatAuditLog(log, formatUtcTime)).toBe(
      'User "john.doe" created Task "Prepare Invoice" with status "to_do" at 2025-01-01 09:00',
    );
  });

  it("formats a status_changed event", () => {
    const log: AuditLog = {
      ...base,
      event: "status_changed",
      fromStatus: "pending",
      toStatus: "in_progress",
      createdAt: "2025-01-01T10:00:00.000Z",
    };
    expect(formatAuditLog(log, formatUtcTime)).toBe(
      'User "john.doe" changed Task "Prepare Invoice" status from "pending" to "in_progress" at 2025-01-01 10:00',
    );
  });

  it("formats a deleted event", () => {
    const log: AuditLog = {
      ...base,
      event: "deleted",
      fromStatus: "in_progress",
      toStatus: null,
      createdAt: "2025-01-02T08:00:00.000Z",
    };
    expect(formatAuditLog(log, formatUtcTime)).toBe(
      'User "john.doe" deleted Task "Prepare Invoice" (last status "in_progress") at 2025-01-02 08:00',
    );
  });

  it("uses the time formatter it is given", () => {
    const log: AuditLog = {
      ...base,
      event: "created",
      fromStatus: null,
      toStatus: "to_do",
      createdAt: "2025-01-01T09:00:00.000Z",
    };
    expect(formatAuditLog(log, () => "LOCAL")).toMatch(/ at LOCAL$/);
  });
});

describe("formatUtcTime", () => {
  it("drops seconds and keeps UTC", () => {
    expect(formatUtcTime("2025-12-31T23:59:59.999Z")).toBe("2025-12-31 23:59");
  });
});
