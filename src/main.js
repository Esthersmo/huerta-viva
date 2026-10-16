import { initStore } from './store.js';

await initStore();
await import('./app.js');
