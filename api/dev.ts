process.env.PORT ??= '3005';

await import('./src/api.js');
await import('./src/worker.js');
