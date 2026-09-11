// Local web dashboard server (Express).

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { loadConfig } from '../core/config.js';
import { initDatabase } from '../core/db.js';
import { registerApi } from './api.js';

export function startDashboard(port?: number): void {
  const config = loadConfig();
  initDatabase(config.db_path);

  const app = express();
  app.use(express.json());
  app.use(registerApi());

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
  app.use(express.static(publicDir));

  const listenPort = port ?? config.dashboard_port;
  app.listen(listenPort, () => {
    console.log(`Mem8 dashboard running at http://localhost:${listenPort}`);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startDashboard();
}
