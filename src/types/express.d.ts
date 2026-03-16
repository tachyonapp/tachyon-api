/** Express Request type augmentation
 *
 * Express's Request type does not include custom properties that our middleware
 * attaches to `req` at runtime. Without this augmentation, TypeScript throws
 * errors anywhere those properties are read or written — in the middleware that
 * sets them and in downstream code (e.g. Apollo context builder).
 *
 * `auth` is set by src/middleware/auth.ts after successful JWT verification.
 * It is optional because unauthenticated requests pass through without it.
 *
 * `correlationId` is set by src/middleware/correlationId.ts on every request.
 * It is always present — middleware runs before any handler can access req.
 *
 * The `export {}` at the bottom makes this file a module, which is required for
 * global interface merging to be recognized correctly by TypeScript.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        sub: string;
        email: string;
        userId: string;
        roles: string[];
      };
      correlationId: string;
    }
  }
}

export {};
