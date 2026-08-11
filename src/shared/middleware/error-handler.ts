import type { NextFunction, Request, Response } from "express";
import { AppError, isAppError } from "../errors/app-error.js";

/**
 * Central error handler — keeps route handlers free of try/catch boilerplate
 * when they throw AppError with a status code.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isAppError(err)) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ error: "Internal server error" });
}

/**
 * Wraps async route handlers so rejected promises reach errorHandler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
