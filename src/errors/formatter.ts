import type { GraphQLFormattedError } from "graphql";
import * as Sentry from "@sentry/node";
import { logger } from "../lib/logger";

const SAFE_CODES = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "GRAPHQL_VALIDATION_FAILED",
  "BAD_USER_INPUT",
  "PERSISTED_QUERY_NOT_FOUND",
]);

export function formatError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const code =
    (formattedError.extensions?.code as string) ?? "INTERNAL_SERVER_ERROR";

  // Report unknown errors to Sentry in staging + production
  if (!SAFE_CODES.has(code) && error instanceof Error) {
    Sentry.captureException(error);
    logger.error({ err: error, code }, "Unhandled GraphQL error");
  }

  // In production: sanitize internals — never leak stack traces or DB messages to client
  if (process.env.NODE_ENV === "production" && !SAFE_CODES.has(code)) {
    return {
      message: "An unexpected error occurred",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    };
  }

  return formattedError;
}
