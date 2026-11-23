import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { getConfig } from './config.js';
import { api } from './routes.js';
import { startScheduler } from './services/scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = existsSync(join(here, 'public')) ? join(here, 'public') : resolve(here, '../public');
const config = getConfig();

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true }));
app.use(express.json({ limit: '25mb' }));
app.use('/files', express.static(join(config.dataDir, 'outputs')));
app.use('/api', api);
app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Erreur inconnue';
  res.status(500).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`FluxLibre backend: http://localhost:${config.port}`);
  console.log(`Données: ${config.dataDir}`);
  startScheduler();
});
