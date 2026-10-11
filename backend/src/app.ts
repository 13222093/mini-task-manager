import express from "express";
import type { Db } from "./db/connection";
import { errorHandler, notFoundHandler } from "./routes/errorHandlers";
import { createTasksRouter } from "./routes/tasksRouter";
import { createTasksService } from "./services/tasksService";

export function createApp(db: Db) {
  const app = express();
  app.use(express.json());
  app.use(createTasksRouter(createTasksService(db)));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
