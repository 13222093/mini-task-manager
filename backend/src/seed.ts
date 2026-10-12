import { formatAuditLog, formatUtcTime } from "@task-manager/shared";
import { openAppDatabase } from "./db/connection";
import { seedDemoTasks } from "./demoSeed";
import { createTasksService } from "./services/tasksService";

const db = openAppDatabase();
const service = createTasksService(db);
const taskIds = seedDemoTasks(service);

console.log(`Seeded ${taskIds.length} tasks. Audit log (UTC):`);
for (const taskId of taskIds) {
  for (const log of service.listAuditLogs(taskId)) {
    console.log(formatAuditLog(log, formatUtcTime));
  }
}

db.close();
