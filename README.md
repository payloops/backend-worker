# Backend Worker

Temporal worker for PayLoops backend operations. Handles all database activities using `@astami/temporal-functions`.

## Overview

This worker runs on the `backend-operations` task queue and provides DB activities that can be called cross-queue by processor workers (stripe, razorpay).

```
┌─────────────────┐     ┌───────────────────────┐     ┌──────────────────┐
│ processor-stripe│     │   backend-worker      │     │processor-razorpay│
│  stripe-payments│────▶│  backend-operations   │◀────│razorpay-payments │
│     queue       │     │       queue           │     │      queue       │
└─────────────────┘     └───────────────────────┘     └──────────────────┘
        │                         │                          │
   Stripe API               PostgreSQL                 Razorpay API
```

## Functions

| Function | Description |
|----------|-------------|
| `getProcessorConfig` | Fetches and decrypts processor credentials for a merchant |
| `updateOrderStatus` | Updates order status and creates transaction records |
| `getOrder` | Retrieves order by ID |
| `getMerchantWebhookUrl` | Gets merchant's webhook URL and secret |
| `deliverWebhook` | Delivers webhook to merchant endpoint with signature |
| `createWebhookEvent` | Creates a webhook event record |

## Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start in development mode
npm dev

# Build for production
npm build

# Start production worker
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `loop` |
| `ENCRYPTION_KEY` | Key for decrypting processor credentials (min 32 chars) | - |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry endpoint | `http://localhost:4318` |
| `OTEL_SERVICE_NAME` | Service name for telemetry | `loop-backend-worker` |

## Cross-Queue Activity Pattern

Processor workers call backend activities using Temporal's cross-queue invocation:

```typescript
// In processor workflow
import { proxyActivities } from '@temporalio/workflow';
import type * as backendActivities from './activities/backend-types';

const backend = proxyActivities<typeof backendActivities>({
  taskQueue: 'backend-operations',
  startToCloseTimeout: '30 seconds'
});

// Call backend activity from processor workflow
const config = await backend.getProcessorConfig({
  merchantId: 'merchant-123',
  processor: 'stripe'
});
```

## Project Structure

```
src/
├── index.ts              # Package exports
├── worker.ts             # Worker entry point
├── functions/
│   ├── index.ts          # Function exports
│   └── db.ts             # DB functions using tfn.fn()
└── lib/
    ├── env.ts            # Environment config
    ├── crypto.ts         # Encryption/decryption
    ├── db.ts             # Database client
    └── schema.ts         # Drizzle schema
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm dev` | Start worker in development mode with hot reload |
| `npm build` | Build for production |
| `npm start` | Start production worker |
| `npm lint` | Run ESLint |
| `npm typecheck` | Run TypeScript type checking |
