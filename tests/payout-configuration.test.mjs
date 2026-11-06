import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('disabled automatic payouts do not read signer credentials or make RPC calls', () => {
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const root = new URL('./', import.meta.url).href;
    registerHooks({ resolve(specifier, context, next) {
      if (['next/server', 'next/headers'].includes(specifier)) return next(specifier + '.js', context);
      const local = context.parentURL?.startsWith(root + 'lib/server/');
      return next(local && specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier) ? specifier + '.ts' : specifier, context);
    }});
    const reads = [];
    process.env = new Proxy(process.env, { get(target, name) {
      if (['PF_PAYOUT_SIGNER_KEYPAIR_JSON', 'PF_PRIZE_WALLET_ADDRESS'].includes(name)) {
        reads.push(name);
        throw new Error('Disabled payouts accessed signer configuration');
      }
      return target[name];
    }});
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Unexpected network request'); };
    const { getPayoutConfiguration, processNextAutomaticPayout } = await import('./lib/server/automatic-payout.ts');
    for (const enabled of [undefined, 'false']) {
      if (enabled === undefined) delete process.env.PF_AUTO_PAYOUT_ENABLED;
      else process.env.PF_AUTO_PAYOUT_ENABLED = enabled;
      const config = await getPayoutConfiguration();
      assert.equal(config.enabled, false);
      assert.equal(config.signerAddress, null);
      assert.equal(config.blockers.length, 1);
      assert.equal((await processNextAutomaticPayout()).action, 'payout-disabled');
    }
    assert.deepEqual(reads, []);
    assert.equal(requests, 0);
  `], { cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
