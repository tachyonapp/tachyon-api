import type { GraphQLFormattedError } from "graphql";

const mockCaptureException = jest.fn();
jest.mock("@sentry/node", () => ({ captureException: mockCaptureException }));
jest.mock("../../lib/logger", () => ({ logger: { error: jest.fn() } }));

let formatError: (
  formattedError: GraphQLFormattedError,
  error: unknown,
) => GraphQLFormattedError;

beforeEach(async () => {
  jest.resetModules();
  mockCaptureException.mockClear();
  ({ formatError } = await import("../formatter"));
});

function makeFormatted(
  message: string,
  code: string,
): GraphQLFormattedError {
  return { message, extensions: { code } };
}

describe("formatError", () => {
  describe("safe error codes", () => {
    const safeCodes = [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "GRAPHQL_VALIDATION_FAILED",
      "BAD_USER_INPUT",
      "PERSISTED_QUERY_NOT_FOUND",
    ];

    it.each(safeCodes)(
      "preserves message and code for %s in production",
      async (code) => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        const formatted = makeFormatted("Original message", code);
        const result = formatError(formatted, new Error("original"));

        expect(result.message).toBe("Original message");
        expect(result.extensions?.code).toBe(code);

        process.env.NODE_ENV = original;
      },
    );

    it.each(safeCodes)(
      "does not call Sentry.captureException for %s",
      async (code) => {
        const formatted = makeFormatted("Original message", code);
        formatError(formatted, new Error("original"));

        expect(mockCaptureException).not.toHaveBeenCalled();
      },
    );
  });

  describe("non-safe error codes", () => {
    it("sanitizes message in production", () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const formatted = makeFormatted("Sensitive DB error", "INTERNAL_SERVER_ERROR");
      const result = formatError(formatted, new Error("Sensitive DB error"));

      expect(result.message).toBe("An unexpected error occurred");
      expect(result.extensions?.code).toBe("INTERNAL_SERVER_ERROR");

      process.env.NODE_ENV = original;
    });

    it("preserves original message in development", () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const formatted = makeFormatted("Sensitive DB error", "INTERNAL_SERVER_ERROR");
      const result = formatError(formatted, new Error("Sensitive DB error"));

      expect(result.message).toBe("Sensitive DB error");

      process.env.NODE_ENV = original;
    });

    it("calls Sentry.captureException for Error instances", () => {
      const error = new Error("unexpected failure");
      const formatted = makeFormatted("unexpected failure", "INTERNAL_SERVER_ERROR");

      formatError(formatted, error);

      expect(mockCaptureException).toHaveBeenCalledWith(error);
    });

    it("does not call Sentry.captureException for non-Error values", () => {
      const formatted = makeFormatted("unexpected failure", "INTERNAL_SERVER_ERROR");

      formatError(formatted, "string error");

      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });
});
