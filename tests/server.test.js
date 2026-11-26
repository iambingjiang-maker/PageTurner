import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { encryptSecret, decryptSecret, maskCardNumber, createSessionToken, verifySessionToken } from '../server/crypto.js';
import { getBranchLiveStatus, MAIN_BRANCH } from '../server/config.js';
import { createApp } from '../server/index.js';
import { resetStoreForTests } from '../server/store.js';
import { BiblioCommonsClient } from '../server/bibliocommons.js';

function startTestServer() {
  const app = createApp();
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('AES-256-GCM encryption round-trips secrets and masks card numbers', () => {
  const original = '29041000123456';
  const encrypted = encryptSecret(original);
  assert.ok(encrypted.startsWith('v1:'));
  assert.notEqual(encrypted, original);
  assert.equal(decryptSecret(encrypted), original);
  assert.equal(maskCardNumber(original), '2904••••••3456');
});

test('Session token signing and verification works', () => {
  const token = createSessionToken();
  assert.equal(verifySessionToken(token), true);
  assert.equal(verifySessionToken(`${token}tampered`), false);
  assert.equal(verifySessionToken('invalid'), false);
});

test('San Mateo Main Library hours compute live open/closed states accurately in Pacific Time', () => {
  // Wednesday 2:00 PM PST (UTC-8 -> 22:00 UTC)
  const wedAfternoon = new Date('2026-11-25T22:00:00Z');
  const openStatus = getBranchLiveStatus(MAIN_BRANCH, wedAfternoon);
  assert.equal(openStatus.isOpen, true);
  assert.equal(openStatus.statusLabel, 'Open now');

  // Wednesday 9:30 PM PST (Thursday 05:30 UTC)
  const wedNight = new Date('2026-11-26T05:30:00Z');
  const closedStatus = getBranchLiveStatus(MAIN_BRANCH, wedNight);
  assert.equal(closedStatus.isOpen, false);
  assert.equal(closedStatus.statusLabel, 'Closed');
  assert.equal(MAIN_BRANCH.biblioCode, '7S');
});

test('API dashboard, Grab & Go checkoff, family queue, and Main Library reserve flow', async () => {
  delete process.env.APP_PASSCODE;
  resetStoreForTests();
  const srv = await startTestServer();
  try {
    const dashRes = await fetch(`${srv.baseUrl}/api/dashboard`);
    assert.equal(dashRes.status, 200);
    const dash = await dashRes.json();
    assert.equal(dash.mode, 'demo');
    assert.equal(dash.branch.id, 'main');
    assert.ok(dash.aisles.length >= 6);
    assert.ok(dash.holds.length >= 3);

    const readyHold = dash.holds.find((h) => h.status === 'ready');
    const grabRes = await fetch(`${srv.baseUrl}/api/holds/${readyHold.id}/grab`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grabbed: true }),
    });
    assert.equal(grabRes.status, 200);
    const grabData = await grabRes.json();
    assert.equal(grabData.hold.grabbed, true);

    const qRes = await fetch(`${srv.baseUrl}/api/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Frog and Toad Are Friends', author: 'Arnold Lobel' }),
    });
    assert.equal(qRes.status, 201);
    const qData = await qRes.json();

    const reserveRes = await fetch(`${srv.baseUrl}/api/holds/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: qData.item.title,
        author: qData.item.author,
        queueItemId: qData.item.id,
      }),
    });
    assert.equal(reserveRes.status, 200);
    const reserveData = await reserveRes.json();
    assert.equal(reserveData.ok, true);
    assert.equal(reserveData.hold.pickupBranch, 'main');
  } finally {
    await srv.close();
  }
});

test('Family Passcode Gate blocks unauthenticated API requests when APP_PASSCODE is set', async () => {
  process.env.APP_PASSCODE = 'sanmateo-family-2026';
  const srv = await startTestServer();
  try {
    const blocked = await fetch(`${srv.baseUrl}/api/dashboard`);
    assert.equal(blocked.status, 401);

    const wrong = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'wrong' }),
    });
    assert.equal(wrong.status, 401);

    const right = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'sanmateo-family-2026' }),
    });
    assert.equal(right.status, 200);
    const cookie = right.headers.get('set-cookie').split(';')[0];

    const allowed = await fetch(`${srv.baseUrl}/api/dashboard`, {
      headers: { Cookie: cookie },
    });
    assert.equal(allowed.status, 200);
  } finally {
    delete process.env.APP_PASSCODE;
    await srv.close();
  }
});

test('Family Book Log supports adding entries, CSV import, and CSV export', async () => {
  delete process.env.APP_PASSCODE;
  resetStoreForTests();
  const srv = await startTestServer();
  try {
    const addRes = await fetch(`${srv.baseUrl}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Room on the Broom',
        author: 'Julia Donaldson',
        reader: '4-Year-Old',
        status: 'loved',
        theme: 'Bedtime & Cozy',
      }),
    });
    assert.equal(addRes.status, 201);

    const impRes = await fetch(`${srv.baseUrl}/api/log/import-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: 'Where the Wild Things Are, Maurice Sendak\nChicka Chicka Boom Boom, Bill Martin Jr.',
      }),
    });
    assert.equal(impRes.status, 200);
    const imp = await impRes.json();
    assert.equal(imp.added, 2);

    const expRes = await fetch(`${srv.baseUrl}/api/log/export.csv`);
    assert.equal(expRes.status, 200);
    const csv = await expRes.text();
    assert.ok(csv.includes('Room on the Broom'));
    assert.ok(csv.includes('Where the Wild Things Are'));

    // Verify 44-book starter catalog + 1-click multi-select batch reserve
    const dash = await (await fetch(`${srv.baseUrl}/api/dashboard`)).json();
    assert.ok(dash.bookLog.length >= 44);
    const toBorrow = dash.bookLog.filter((b) => b.status === 'to_borrow').slice(0, 2);
    assert.equal(toBorrow.length, 2);

    const batchRes = await fetch(`${srv.baseUrl}/api/holds/place-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logIds: toBorrow.map((b) => b.id) }),
    });
    assert.equal(batchRes.status, 200);
    const batch = await batchRes.json();
    assert.equal(batch.succeeded, 2);
  } finally {
    await srv.close();
  }
});

test('BiblioCommonsClient extracts accountId, auth headers, and gateway error messages cleanly', () => {
  const client = new BiblioCommonsClient();
  client.ingestSessionPayload({
    auth: { sessionId: 'sess-abc', authToken: 'tok-xyz', currentUserId: 999 },
    entities: {
      accounts: {
        111111: { id: 111111, libId: 12 },
        222222: { id: 222222, libId: 76 },
      },
      libraries: {
        76: {
          branches: [
            { code: '7H', name: 'San Mateo-Hillsdale' },
            { code: '7S', name: 'San Mateo-Main' },
          ],
        },
      },
    },
  });

  assert.equal(client.accountId, '222222');
  assert.equal(client.mainBranchCode, '7S');
  const headers = client.gatewayHeaders();
  assert.equal(headers['X-Session-Id'], 'sess-abc');
  assert.equal(headers['X-Access-Token'], 'tok-xyz');
  assert.equal(
    client.parseGatewayError(
      JSON.stringify({ error: { message: 'Required parameters: accountId' } })
    ),
    'Required parameters: accountId'
  );
});
