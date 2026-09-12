// Remove the dist directory so stale build output never ships.
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
