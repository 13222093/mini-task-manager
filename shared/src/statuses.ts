export const STATUSES = ["to_do", "pending", "in_progress", "done"] as const;

export type Status = (typeof STATUSES)[number];
