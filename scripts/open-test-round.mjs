// Optional one-time deployment input. Reusing an ID never resets its clock.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

if (process.env.PF_OPEN_TEST_ROUND_ID) {
  registerHooks({resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && existsSync(new URL(specifier+'.ts', context.parentURL)))
      return next(specifier+'.ts', context);
    return next(specifier,context);
  }});
  const { openTestRound } = await import('../lib/server/league/test-round.ts');
  const { closeDatabasePool } = await import('../lib/server/database.ts');
  try {
    console.log(JSON.stringify(await openTestRound(process.env.PF_OPEN_TEST_ROUND_ID)));
  } finally {
    await closeDatabasePool();
  }
}
