// Production entry point: one server for the API and the built frontend.
// Development uses server.ts instead, with Vite serving the frontend.
import express from "express";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { openAppDatabase } from "./db/connection";
import { seedDemoTasks } from "./demoSeed";
import { createTasksService } from "./services/tasksService";

// Cloud Run passes the port in PORT and uses 8080 by default.
const PORT = Number(process.env.PORT ?? 8080);
const FRONTEND_DIST = fileURLToPath(new URL("../../frontend/dist", import.meta.url));

const db = openAppDatabase();

// For the hosted demo, whose database starts empty after every restart.
// listTasks() skips deleted tasks, so "empty" means no task a visitor would see.
if (process.env.DEMO_SEED === "1") {
  const service = createTasksService(db);
  if (service.listTasks().length === 0) {
    seedDemoTasks(service);
    console.log("DEMO_SEED=1 and no tasks found: created the demo tasks");
  }
}

const app = express();
// The frontend calls /api/... In development the Vite proxy strips /api;
// here the API app is mounted under /api, so the routes inside it are the same.
app.use("/api", createApp(db));
// Serves index.html at / and the hashed files under /assets. Any other path gets 404.
app.use(express.static(FRONTEND_DIST));

app.listen(PORT, () => {
  console.log(`Serving the app on http://localhost:${PORT}`);
});
