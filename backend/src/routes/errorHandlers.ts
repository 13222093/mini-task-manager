import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiErrorBody, ErrorCode } from "@task-manager/shared";
import { AppError } from "../domain/errors";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  STALE_STATUS: 409,
  INTERNAL_ERROR: 500,
};

// Registered after all routes so unknown paths get the same error body as everything else.
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const appError = toAppError(err);
  if (appError.code === "INTERNAL_ERROR") {
    console.error(err);
  }
  const body: ApiErrorBody = {
    error: { code: appError.code, message: appError.message, details: appError.details },
  };
  res.status(HTTP_STATUS[appError.code]).json(body);
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  // express.json() reports bodies it cannot read (malformed JSON, too large)
  // as errors carrying a 4xx status.
  if (err instanceof Error && "status" in err && typeof err.status === "number" && err.status < 500) {
    return new AppError("VALIDATION_ERROR", `Invalid request body: ${err.message}`);
  }
  return new AppError("INTERNAL_ERROR", "Unexpected server error");
}
