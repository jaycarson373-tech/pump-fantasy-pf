import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const refusedPort = 1;
const local = `postgres://127.0.0.1:${refusedPort}/pf_wallet_test_validation`;
for (const database of [`${local}?host=127.0.0.2`, `${local}#fragment`, local.replace('postgres:', 'http:')]) {
  test(`local setup rejects connection overrides: ${new URL(database).protocol}${new URL(database).search || new URL(database).hash}`, () => {
    const result = spawnSync(process.execPath, ['scripts/dev-wallet-test.mjs'], {
      env: { PATH: process.env.PATH, PF_WALLET_TEST_DATABASE_URL: database }, encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PostgreSQL URL without query parameters or fragment/);
  });
}
