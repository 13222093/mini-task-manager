import type { TasksService } from "./services/tasksService";

// The demo data used by npm run seed and by serve.ts when DEMO_SEED=1.
// Goes through the service layer, not raw SQL, so every change has a real audit row.
// Returns the ids of the created tasks.
export function seedDemoTasks(service: TasksService): string[] {
  const invoice = service.createTask("Prepare Invoice", "john.doe");
  service.updateStatus(invoice.id, "pending", "jane.smith");

  const contract = service.createTask("Review contract", "jane.smith");
  service.updateStatus(contract.id, "pending", "budi.santoso");
  service.updateStatus(contract.id, "in_progress", "john.doe");

  const venue = service.createTask("Book venue", "budi.santoso");
  service.updateStatus(venue.id, "pending", "john.doe");
  service.updateStatus(venue.id, "in_progress", "jane.smith");
  service.updateStatus(venue.id, "done", "budi.santoso");

  return [invoice.id, contract.id, venue.id];
}
