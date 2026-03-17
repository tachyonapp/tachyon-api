/**
 * API only uses BullMQ as a Queue producer — it never instantiates Worker processors.
 *
 * Queue instances are created lazily on first access (not at import time).
 * This prevents BullMQ from attempting a Valkey connection during schema export,
 * test runs, or any other context where Valkey is unavailable.
 */
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@tachyonapp/tachyon-queue-types";
import { createQueue } from "./client";

let _scanDispatchQueue: Queue | null = null;
let _scanBotQueue: Queue | null = null;
let _expiryQueue: Queue | null = null;
let _reconciliationQueue: Queue | null = null;
let _notificationQueue: Queue | null = null;
let _summaryQueue: Queue | null = null;

export const getScanDispatchQueue = (): Queue =>
  (_scanDispatchQueue ??= createQueue(QUEUE_NAMES.SCAN_DISPATCH));

export const getScanBotQueue = (): Queue =>
  (_scanBotQueue ??= createQueue(QUEUE_NAMES.SCAN_BOT));

export const getExpiryQueue = (): Queue =>
  (_expiryQueue ??= createQueue(QUEUE_NAMES.EXPIRY));

export const getReconciliationQueue = (): Queue =>
  (_reconciliationQueue ??= createQueue(QUEUE_NAMES.RECONCILIATION));

export const getNotificationQueue = (): Queue =>
  (_notificationQueue ??= createQueue(QUEUE_NAMES.NOTIFICATION));

export const getSummaryQueue = (): Queue =>
  (_summaryQueue ??= createQueue(QUEUE_NAMES.SUMMARY));

// Array for use by Bull Board dashboard — initializes all queues on first call
export const getAllQueues = (): Queue[] => [
  getScanDispatchQueue(),
  getScanBotQueue(),
  getExpiryQueue(),
  getReconciliationQueue(),
  getNotificationQueue(),
  getSummaryQueue(),
];
