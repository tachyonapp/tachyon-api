/** Valkey (Redis-compatible) client singleton
 *
 * Provides a single shared ioredis instance for the lifetime of the process.
 * Valkey is a direct fork of Redis — ioredis is fully compatible.
 *
 * getValkey() is synchronous and safe to call on every request. The client
 * connects lazily on first use (lazyConnect: true), so importing this module
 * does not immediately open a socket.
 *
 * Used by: rate limiting middleware, BullMQ queue producers, and any resolver
 * that needs direct cache or pub/sub access.
 */
import Redis from 'ioredis';

let valkeyClient: Redis | null = null;

export function getValkey(): Redis {
  if (!valkeyClient) {
    valkeyClient = new Redis({
      host: process.env.VALKEY_HOST || 'localhost',
      port: parseInt(process.env.VALKEY_PORT || '6379', 10),
      password: process.env.VALKEY_PASSWORD || undefined,
      tls: process.env.VALKEY_TLS === 'true' ? {} : undefined,
      lazyConnect: true,
    });
  }

  return valkeyClient;
}
