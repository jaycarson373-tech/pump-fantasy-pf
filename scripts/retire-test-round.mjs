// Explicit cutover input: preserve rehearsal records and prevent further entries.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

if (process.env.PF_RETIRE_TEST_ROUND_ID) {
  registerHooks({resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && existsSync(new URL(specifier+'.ts', context.parentURL)))
      return next(specifier+'.ts', context);
    return next(specifier,context);
  }});
  const { retireTestRound } = await import('../lib/server/league/test-round.ts');
  const { closeDatabasePool } = await import('../lib/server/database.ts');
  try {
    console.log(JSON.stringify(await retireTestRound(process.env.PF_RETIRE_TEST_ROUND_ID)));
  } finally {
    await closeDatabasePool();
  }
}
