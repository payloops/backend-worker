import { pgTable, text, timestamp, integer, boolean, jsonb, varchar, index, uuid } from 'drizzle-orm/pg-core';

export const merchants = pgTable('merchants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const processorConfigs = pgTable(
  'processor_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    processor: varchar('processor', { length: 50 }).notNull(),
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    priority: integer('priority').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    testMode: boolean('test_mode').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (table) => [index('processor_configs_merchant_id_idx').on(table.merchantId)]
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    processor: varchar('processor', { length: 50 }),
    processorOrderId: varchar('processor_order_id', { length: 255 }),
    metadata: jsonb('metadata').default({}),
    customerId: varchar('customer_id', { length: 255 }),
    customerEmail: varchar('customer_email', { length: 255 }),
    description: text('description'),
    returnUrl: text('return_url'),
    cancelUrl: text('cancel_url'),
    workflowId: varchar('workflow_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (table) => [
    index('orders_merchant_id_idx').on(table.merchantId),
    index('orders_external_id_idx').on(table.externalId),
    index('orders_status_idx').on(table.status),
    index('orders_created_at_idx').on(table.createdAt)
  ]
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    amount: integer('amount').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    processorTransactionId: varchar('processor_transaction_id', { length: 255 }),
    processorResponse: jsonb('processor_response'),
    errorCode: varchar('error_code', { length: 100 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [index('transactions_order_id_idx').on(table.orderId)]
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextRetryAt: timestamp('next_retry_at'),
    deliveredAt: timestamp('delivered_at'),
    workflowId: varchar('workflow_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (table) => [
    index('webhook_events_merchant_id_idx').on(table.merchantId),
    index('webhook_events_status_idx').on(table.status),
    index('webhook_events_next_retry_at_idx').on(table.nextRetryAt)
  ]
);
