import type { ErrorCode } from "@task-manager/shared";

// The single error type the service and routes throw. The error middleware
// maps the code to an HTTP status, so this file knows nothing about HTTP.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}
