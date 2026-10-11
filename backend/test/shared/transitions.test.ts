import { describe, expect, it } from "vitest";
import {
  STATUSES,
  evaluateTransition,
  nextStatus,
  type Status,
  type TransitionResult,
} from "@task-manager/shared";

const noop: TransitionResult = { kind: "noop" };
const change: TransitionResult = { kind: "change" };
const invalid = (allowedNext: Status | null): TransitionResult => ({ kind: "invalid", allowedNext });

// Written out in full rather than generated, so the table itself is the spec.
const matrix: Array<[Status, Status, TransitionResult]> = [
  ["to_do", "to_do", noop],
  ["to_do", "pending", change],
  ["to_do", "in_progress", invalid("pending")],
  ["to_do", "done", invalid("pending")],

  ["pending", "to_do", invalid("in_progress")],
  ["pending", "pending", noop],
  ["pending", "in_progress", change],
  ["pending", "done", invalid("in_progress")],

  ["in_progress", "to_do", invalid("done")],
  ["in_progress", "pending", invalid("done")],
  ["in_progress", "in_progress", noop],
  ["in_progress", "done", change],

  ["done", "to_do", invalid(null)],
  ["done", "pending", invalid(null)],
  ["done", "in_progress", invalid(null)],
  ["done", "done", noop],
];

describe("evaluateTransition", () => {
  it("covers every pair of statuses exactly once", () => {
    const pairs = new Set(matrix.map(([current, target]) => `${current}->${target}`));
    expect(pairs.size).toBe(STATUSES.length * STATUSES.length);
  });

  it.each(matrix)("%s -> %s", (current, target, expected) => {
    expect(evaluateTransition(current, target)).toEqual(expected);
  });
});

describe("nextStatus", () => {
  it("returns the single allowed next status, or null for done", () => {
    expect(STATUSES.map(nextStatus)).toEqual(["pending", "in_progress", "done", null]);
  });
});
