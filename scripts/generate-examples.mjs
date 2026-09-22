import fs from 'node:fs';
import path from 'node:path';
import { reconcile, toMarkdown } from '../src/reconcile.mjs';

const cases = [
  { name: 'withdrawable', fixture: '../fixtures/withdrawable.json' },
  { name: 'healthy', fixture: '../fixtures/healthy.json' },
  { name: 'dissolved', fixture: '../fixtures/dissolved.json' }
];

for (const c of cases) {
  const fixturePath = path.resolve(new URL(c.fixture, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
  const input = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const report = reconcile(input);
  const jsonPath = path.resolve(new URL(`../examples/${c.name}-report.json`, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
  const mdPath = path.resolve(new URL(`../examples/${c.name}-report.md`, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, toMarkdown(report), 'utf8');
}

console.log('Successfully generated sample reports in UTF-8');
