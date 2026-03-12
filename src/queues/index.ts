/**
 * API only uses BullMQ as a Queue producer — it never instantiates Worker processors.
 * The queue client provides named Queue instances that will be consumed by GraphQL
 * resolvers to enqueue jobs (e.g., `approveProposal` → order submission job).
 */
import { QUEUE_NAMES } from "@tachyonapp/tachyon-queue-types";
import { createQueue } from "./client";

// Producer-only Queue instances for use by GraphQL resolvers (Feature 4+)
export const scanDispatchQueue = createQueue(QUEUE_NAMES.SCAN_DISPATCH);
export const scanBotQueue = createQueue(QUEUE_NAMES.SCAN_BOT);
export const expiryQueue = createQueue(QUEUE_NAMES.EXPIRY);
export const reconciliationQueue = createQueue(QUEUE_NAMES.RECONCILIATION);
export const notificationQueue = createQueue(QUEUE_NAMES.NOTIFICATION);
export const summaryQueue = createQueue(QUEUE_NAMES.SUMMARY);

// Array for use by Bull Board dashboard
export const allQueues = [
  scanDispatchQueue,
  scanBotQueue,
  expiryQueue,
  reconciliationQueue,
  notificationQueue,
  summaryQueue,
];
