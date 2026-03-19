import { Request, Response, NextFunction } from "express";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function apiErrorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";

  // Log error for debugging (but not details in production)
  if (statusCode >= 500) {
    console.error(`[Error] ${code}:`, err.message);
  }

  // Don't leak internal error details in production
  const detail = statusCode < 500 ? err.message : "Internal server error";

  res.status(statusCode).json({
    error: code,
    message: detail
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "Resource not found"
  });
}
