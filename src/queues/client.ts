import { Queue } from "bullmq";

/**
 * Returns BullMQ ConnectionOptions (a union type so we let
 * TypeScript infer rather than cast it explicitly. This is fine)
 * for use in Queue constructors (producer side only).
 * Do NOT use this to create Worker instances in tachyon-api.
 */
export function getBullMQConnectionOptions() {
  return {
    host: process.env.VALKEY_HOST ?? "localhost",
    port: Number(process.env.VALKEY_PORT ?? 6379),
    password: process.env.VALKEY_PASSWORD || undefined,
    tls: process.env.VALKEY_TLS === "true" ? {} : undefined,
  };
}

/**
 * Creates a BullMQ Queue instance for use as a producer (job enqueueing only).
 * No Worker is instantiated here.
 */
export function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: getBullMQConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  });
}
