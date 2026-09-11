// Copy static dashboard assets into dist/ after tsc build.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/dashboard', { recursive: true });
cpSync('src/dashboard/public', 'dist/dashboard/public', { recursive: true });
console.log('Copied dashboard assets to dist/dashboard/public');
