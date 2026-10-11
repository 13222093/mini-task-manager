// Exported as "@task-manager/shared/schemas", separate from the main entry,
// so the frontend can import shared rules without pulling zod into its bundle.
import { z } from "zod";
import { ACTORS } from "./actors";
import { STATUSES } from "./statuses";

export const createTaskBodySchema = z.object(
  {
    title: z
      .string({ error: "Title must be a string" })
      .trim()
      .min(1, "Title must not be empty")
      .max(120, "Title must be at most 120 characters"),
  },
  { error: "Body must be a JSON object" },
);

export const updateStatusBodySchema = z.object(
  {
    status: z.enum(STATUSES, { error: `Status must be one of: ${STATUSES.join(", ")}` }),
  },
  { error: "Body must be a JSON object" },
);

export const actorSchema = z.enum(ACTORS, {
  error: `X-Actor header must be one of: ${ACTORS.join(", ")}`,
});

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type UpdateStatusBody = z.infer<typeof updateStatusBodySchema>;
