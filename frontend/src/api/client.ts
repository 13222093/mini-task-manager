import type {
  Actor,
  ApiErrorBody,
  AuditLog,
  Status,
  Task,
  UpdateStatusResponse,
} from "@task-manager/shared";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // The Vite dev server proxies /api to the backend and strips the prefix.
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// The backend always sends ApiErrorBody, but the proxy may answer on its own
// with a non-JSON body if the backend is not running.
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error.message;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function mutation(method: "POST" | "PUT" | "DELETE", actor: Actor, body?: unknown): RequestInit {
  if (body === undefined) {
    return { method, headers: { "X-Actor": actor } };
  }
  return {
    method,
    headers: { "X-Actor": actor, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export const api = {
  listTasks: () => request<Task[]>("/tasks"),

  createTask: (title: string, actor: Actor) =>
    request<Task>("/tasks", mutation("POST", actor, { title })),

  updateStatus: (taskId: string, status: Status, actor: Actor) =>
    request<UpdateStatusResponse>(`/tasks/${taskId}/status`, mutation("PUT", actor, { status })),

  deleteTask: (taskId: string, actor: Actor) =>
    request<void>(`/tasks/${taskId}`, mutation("DELETE", actor)),

  listAuditLogs: (taskId: string) => request<AuditLog[]>(`/tasks/${taskId}/audit-logs`),
};
