import { tfn } from '@astami/temporal-functions';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../lib/db';
import { orders, transactions, processorConfigs, webhookEvents, merchants } from '../lib/schema';
import { decrypt } from '../lib/crypto';
import { logger } from '@payloops/processor-core/observability';

// =============================================================================
// Types
// =============================================================================

export interface PaymentConfig {
  merchantId: string;
  processor: string;
  testMode: boolean;
  credentials: Record<string, string>;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  status: string;
  processorOrderId?: string;
  processorTransactionId?: string;
}

export interface WebhookDeliveryInput {
  webhookEventId: string;
  webhookUrl: string;
  webhookSecret?: string;
  payload: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  attempts: number;
  deliveredAt?: Date;
  errorMessage?: string;
}

// =============================================================================
// Get Processor Config
// =============================================================================

export const getProcessorConfig = tfn.fn(
  'getProcessorConfig',
  async (input: { merchantId: string; processor: string }): Promise<PaymentConfig | null> => {
    const { merchantId, processor } = input;

    const config = await db
      .select()
      .from(processorConfigs)
      .where(and(eq(processorConfigs.merchantId, merchantId), eq(processorConfigs.processor, processor)))
      .limit(1);

    if (config.length === 0) return null;

    const credentials = JSON.parse(decrypt(config[0].credentialsEncrypted));

    logger.debug({ merchantId, processor }, 'Retrieved processor config');

    return {
      merchantId,
      processor,
      testMode: config[0].testMode,
      credentials
    };
  },
  { startToCloseTimeout: '30s', retries: 3 }
);

// =============================================================================
// Update Order Status
// =============================================================================

export const updateOrderStatus = tfn.fn(
  'updateOrderStatus',
  async (input: UpdateOrderStatusInput): Promise<void> => {
    const { orderId, status, processorOrderId, processorTransactionId } = input;

    await db
      .update(orders)
      .set({
        status,
        processorOrderId: processorOrderId || undefined,
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));

    // Create transaction record if we have a transaction id
    if (processorTransactionId) {
      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

      if (order.length > 0) {
        await db.insert(transactions).values({
          orderId,
          type: status === 'captured' ? 'capture' : status === 'authorized' ? 'authorization' : 'authorization',
          amount: order[0].amount,
          status: status === 'failed' ? 'failed' : 'success',
          processorTransactionId
        });
      }
    }

    logger.info({ orderId, status, processorOrderId }, 'Updated order status');

    // TODO: Call merchant webhook API here for order status updates
  },
  { startToCloseTimeout: '30s', retries: 3 }
);

// =============================================================================
// Get Order
// =============================================================================

export const getOrder = tfn.fn(
  'getOrder',
  async (input: { orderId: string }) => {
    const order = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
    return order[0] || null;
  },
  { startToCloseTimeout: '30s', retries: 3 }
);

// =============================================================================
// Get Merchant Webhook URL
// =============================================================================

export const getMerchantWebhookUrl = tfn.fn(
  'getMerchantWebhookUrl',
  async (input: { merchantId: string }): Promise<{ url: string | null; secret: string | null }> => {
    const merchant = await db.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1);

    return {
      url: merchant[0]?.webhookUrl || null,
      secret: merchant[0]?.webhookSecret || null
    };
  },
  { startToCloseTimeout: '30s', retries: 3 }
);

// =============================================================================
// Deliver Webhook
// =============================================================================

function getRetryDelay(attempt: number): number {
  const baseDelay = 60 * 1000; // 1 minute
  const maxDelay = 24 * 60 * 60 * 1000; // 24 hours
  const delay = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, maxDelay);
}

export const deliverWebhook = tfn.fn(
  'deliverWebhook',
  async (input: WebhookDeliveryInput): Promise<WebhookDeliveryResult> => {
    const { webhookEventId, webhookUrl, webhookSecret, payload } = input;

    // Get current attempt count
    const event = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId)).limit(1);

    const attempts = (event[0]?.attempts || 0) + 1;

    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Loop-Event-Id': webhookEventId,
        'X-Loop-Timestamp': String(Date.now())
      };

      // Sign the webhook if secret is provided
      if (webhookSecret) {
        const timestamp = headers['X-Loop-Timestamp'];
        const signaturePayload = `${timestamp}.${body}`;
        const signature = crypto.createHmac('sha256', webhookSecret).update(signaturePayload).digest('hex');
        headers['X-Loop-Signature'] = `v1=${signature}`;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      const success = response.ok;

      await db
        .update(webhookEvents)
        .set({
          status: success ? 'delivered' : 'pending',
          attempts,
          lastAttemptAt: new Date(),
          deliveredAt: success ? new Date() : undefined,
          nextRetryAt: success ? undefined : new Date(Date.now() + getRetryDelay(attempts))
        })
        .where(eq(webhookEvents.id, webhookEventId));

      logger.info({ webhookEventId, success, attempts, statusCode: response.status }, 'Webhook delivery attempt');

      return {
        success,
        statusCode: response.status,
        attempts,
        deliveredAt: success ? new Date() : undefined,
        errorMessage: success ? undefined : `HTTP ${response.status}`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await db
        .update(webhookEvents)
        .set({
          status: attempts >= 5 ? 'failed' : 'pending',
          attempts,
          lastAttemptAt: new Date(),
          nextRetryAt: attempts >= 5 ? undefined : new Date(Date.now() + getRetryDelay(attempts))
        })
        .where(eq(webhookEvents.id, webhookEventId));

      logger.error({ webhookEventId, attempts, error: errorMessage }, 'Webhook delivery failed');

      return {
        success: false,
        attempts,
        errorMessage
      };
    }
  },
  { startToCloseTimeout: '60s', retries: 0 } // No auto-retry, we handle retries in the workflow
);

// =============================================================================
// Create Webhook Event
// =============================================================================

export const createWebhookEvent = tfn.fn(
  'createWebhookEvent',
  async (input: {
    merchantId: string;
    orderId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<string> => {
    const result = await db
      .insert(webhookEvents)
      .values({
        merchantId: input.merchantId,
        orderId: input.orderId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'pending'
      })
      .returning({ id: webhookEvents.id });

    logger.info({ webhookEventId: result[0].id, eventType: input.eventType }, 'Created webhook event');

    return result[0].id;
  },
  { startToCloseTimeout: '30s', retries: 3 }
);
