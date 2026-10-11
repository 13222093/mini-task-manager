import { formatAuditLog, formatUtcTime } from "@task-manager/shared";
import { openAppDatabase } from "./db/connection";
import { createTasksService } from "./services/tasksService";

// Goes through the service layer, not raw SQL, so every seeded change has a real audit row.
const db = openAppDatabase();
const service = createTasksService(db);

const invoice = service.createTask("Prepare Invoice", "john.doe");
service.updateStatus(invoice.id, "pending", "jane.smith");

const contract = service.createTask("Review contract", "jane.smith");
service.updateStatus(contract.id, "pending", "budi.santoso");
service.updateStatus(contract.id, "in_progress", "john.doe");

const venue = service.createTask("Book venue", "budi.santoso");
service.updateStatus(venue.id, "pending", "john.doe");
service.updateStatus(venue.id, "in_progress", "jane.smith");
service.updateStatus(venue.id, "done", "budi.santoso");

console.log("Seeded 3 tasks. Audit log (UTC):");
for (const task of [invoice, contract, venue]) {
  for (const log of service.listAuditLogs(task.id)) {
    console.log(formatAuditLog(log, formatUtcTime));
  }
}

db.close();
