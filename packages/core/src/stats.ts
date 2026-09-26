import type { Change, ChangeStats } from './types.js';

export function computeStats(changes: Change[]): ChangeStats {
  const stats: ChangeStats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const c of changes) stats[c.kind]++;
  return stats;
}
