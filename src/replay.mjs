#!/usr/bin/env node
/**
 * rp-megapool-auditor replay
 *
 * Reads a saved capture bundle and reruns the reconciler against the saved
 * snapshot.json. Produces no network calls — fully deterministic replay.
 *
 * Usage:
 *   node src/replay.mjs --capture capture/ --format json
 */

import fs from 'node:fs';
import path from 'node:path';
import { reconcile, toMarkdown, toTerminal } from './reconcile.mjs';

const argv = process.argv.slice(2);
const get = (f, d) => { const i = argv.indexOf(`--${f}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const captureDir = get('capture', 'capture');
const format = get('format', 'terminal');

const snapshotPath = path.join(captureDir, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  console.error(`ERROR: No snapshot.json found in '${captureDir}'.`);
  console.error('Run capture.mjs first to create the bundle.');
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
// Pin the timestamp so replay is byte-identical to original
snapshot.metadata.generatedAt = snapshot.metadata.capturedAt ?? snapshot.metadata.generatedAt;

const report = reconcile(snapshot);

if (format === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else if (format === 'markdown') {
  console.log(toMarkdown(report));
} else {
  console.log(toTerminal(report));
}
