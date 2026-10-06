import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DirFile } from '@diffsense/core';

const MAX_TEXT_BYTES = 10 * 1024 * 1024;

/** Walks [root] (not following symlinks) and reads every file. Paths are relative and use `/`. */
export function readDirectory(root: string): DirFile[] {
  const out: DirFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        walk(join(dir, e.name), path);
      } else if (e.isFile()) {
        const bytes = readFileSync(join(dir, e.name));
        const binary = bytes.length > MAX_TEXT_BYTES || bytes.subarray(0, 8000).includes(0);
        out.push({
          path,
          binary,
          content: binary ? undefined : bytes.toString('utf8'),
          signature: createHash('sha1').update(bytes).digest('hex'),
        });
      }
    }
  };
  walk(root, '');
  return out;
}
