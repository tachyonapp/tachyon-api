/** Correlation ID Middleware
 *
 * Assigns a unique ID to every incoming request and propagates it through the
 * system so that a single user action can be traced across API logs, worker
 * jobs, and any downstream services.
 *
 * If the client sends an `X-Correlation-ID` header (e.g. from a mobile retry
 * or a service-to-service call), that value is reused so the trace stays
 * continuous. Otherwise a new UUID v4 is generated.
 *
 * The ID is attached to `req.correlationId` (typed via src/types/express.d.ts)
 * and echoed back in the `X-Correlation-ID` response header so clients can
 * correlate their request with server-side logs.
 *
 * This middleware must run first in the stack — before rate limiting, auth,
 * and Apollo — so that every subsequent layer has access to the ID.
 */
import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Honor client-provided ID for distributed tracing; otherwise generate new
  const id = (req.headers["x-correlation-id"] as string) ?? uuidv4();
  req.correlationId = id;
  res.setHeader("X-Correlation-ID", id);
  next();
}
