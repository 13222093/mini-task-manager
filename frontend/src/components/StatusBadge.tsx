import type { Status } from "@task-manager/shared";

// The status text is always shown; the color only reinforces it.
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}
