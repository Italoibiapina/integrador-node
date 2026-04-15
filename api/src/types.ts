export const queueNames = {
  step1CaptureOrders: 'step1.captureOrders',
  step2SendOrders: 'step2.sendOrders',
  notifierDispatch: 'notifier.dispatch',
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];

export type ExecutionStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped';
export type ExecutionTrigger = 'manual' | 'scheduled' | 'notifier';
