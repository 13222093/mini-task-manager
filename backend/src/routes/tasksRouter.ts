import { Router, type Request } from "express";
import type { z } from "zod";
import type { Actor } from "@task-manager/shared";
import {
  actorSchema,
  createTaskBodySchema,
  updateStatusBodySchema,
} from "@task-manager/shared/schemas";
import { AppError } from "../domain/errors";
import type { TasksService } from "../services/tasksService";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  throw new AppError("VALIDATION_ERROR", issues.map((issue) => issue.message).join("; "), {
    issues,
  });
}

function actorFrom(req: Request): Actor {
  return parse(actorSchema, req.get("X-Actor"));
}

// Mutating handlers validate the actor and body before calling the service,
// so a bad request is a 400 and writes nothing, whether or not the task exists.
export function createTasksRouter(service: TasksService): Router {
  const router = Router();

  router.get("/tasks", (_req, res) => {
    res.json(service.listTasks());
  });

  router.post("/tasks", (req, res) => {
    const actor = actorFrom(req);
    const { title } = parse(createTaskBodySchema, req.body);
    res.status(201).json(service.createTask(title, actor));
  });

  router.put("/tasks/:id/status", (req, res) => {
    const actor = actorFrom(req);
    const { status } = parse(updateStatusBodySchema, req.body);
    res.json(service.updateStatus(req.params.id, status, actor));
  });

  router.delete("/tasks/:id", (req, res) => {
    const actor = actorFrom(req);
    service.deleteTask(req.params.id, actor);
    res.status(204).end();
  });

  router.get("/tasks/:id/audit-logs", (req, res) => {
    res.json(service.listAuditLogs(req.params.id));
  });

  return router;
}
