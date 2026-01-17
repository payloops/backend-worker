// Initialize OpenTelemetry FIRST, before any other imports
import { initTelemetry, logger } from '@payloops/processor-core/observability';
initTelemetry(process.env.OTEL_SERVICE_NAME || 'loop-worker-backend', '0.0.1');

import { tfn } from '@astami/temporal-functions/worker';
import * as functions from './functions';

const TASK_QUEUE = 'backend-operations';

async function run() {
  logger.info({ taskQueue: TASK_QUEUE }, 'Starting backend worker');

  const worker = tfn.worker({
    temporal: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      namespace: process.env.TEMPORAL_NAMESPACE || 'loop'
    },
    taskQueue: TASK_QUEUE
  });

  // Register all DB functions
  worker.registerModule(functions);

  logger.info({ taskQueue: TASK_QUEUE }, 'Backend worker started');

  await worker.start();
}

run().catch((err) => {
  logger.error({ error: err }, 'Backend worker failed');
  process.exit(1);
});
