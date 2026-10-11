import type { Status } from "./statuses";

export type TransitionResult =
  | { kind: "noop" }
  | { kind: "change" }
  | { kind: "invalid"; allowedNext: Status | null };

const NEXT_STATUS: Record<Status, Status | null> = {
  to_do: "pending",
  pending: "in_progress",
  in_progress: "done",
  done: null,
};

export function nextStatus(current: Status): Status | null {
  return NEXT_STATUS[current];
}

export function evaluateTransition(current: Status, target: Status): TransitionResult {
  if (target === current) {
    return { kind: "noop" };
  }
  const allowedNext = nextStatus(current);
  if (target === allowedNext) {
    return { kind: "change" };
  }
  return { kind: "invalid", allowedNext };
}
