/**
 * Type declaration for basic-auth-connect.
 * The package has no @types/* entry on DefinitelyTyped.
 *
 * We use the (username, password) overload only — returns an Express RequestHandler
 * that responds with 401 if the Authorization header does not match.
 */
declare module 'basic-auth-connect' {
  import type { RequestHandler } from 'express';

  function basicAuth(username: string, password: string): RequestHandler;

  export = basicAuth;
}
