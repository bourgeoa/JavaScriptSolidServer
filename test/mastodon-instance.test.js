/**
 * Mastodon instance endpoint tests — subdomain-mode identity
 *
 * Regression coverage for the nodeinfo probe error:
 * Phanpy builds its nodeinfo fetch as `${uri}/.well-known/nodeinfo`, where
 * `uri` comes from /api/v2/instance. JSS must advertise the account's own
 * host (<username>.<baseDomain>) with a full URL scheme, otherwise Phanpy
 * tries to fetch a scheme-less string like
 * "pivot-test.solidproject.org:3200/.well-known/nodeinfo" and the browser
 * throws "URL scheme is not supported".
 *
 * AP is per-pod (no global --ap-username): the username comes from the pod
 * subdomain, or from the authenticated pod's WebID when the client connects
 * to the base host.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import { createServer } from '../src/server.js';

describe('Mastodon instance (subdomain mode)', () => {
  let server = null;

  before(async () => {
    // Use the same scratch data dir as the other tests and start clean.
    await fs.emptyDir('./data');
    server = createServer({
      logger: false,
      forceCloseConnections: true,
      activitypub: true,
      subdomains: true,
      baseDomain: 'pivot-test.solidproject.org:3200'
    });
    await server.listen({ port: 0, host: '127.0.0.1' });
  });

  after(async () => {
    if (server) await server.close();
    await fs.emptyDir('./data');
  });

  function instanceRequest(url, headers = {}) {
    return server.inject({
      method: 'GET',
      url,
      headers: {
        host: 'pivot-test.solidproject.org:3200',
        'x-forwarded-proto': 'https',
        ...headers
      }
    });
  }

  it('pod-subdomain request: uri includes the pod and has a scheme', async () => {
    const res = await instanceRequest('/api/v2/instance', {
      host: 'bourgeoa.pivot-test.solidproject.org:3200'
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(
      body.uri,
      'https://bourgeoa.pivot-test.solidproject.org:3200',
      'uri should be a full URL on the pod subdomain'
    );
    assert.strictEqual(
      body.domain,
      'bourgeoa.pivot-test.solidproject.org:3200',
      'domain should be the pod subdomain (host-only)'
    );
    assert.ok(
      body.urls?.streaming_api?.startsWith('wss://bourgeoa.pivot-test.solidproject.org:3200'),
      'streaming API should point at the pod subdomain'
    );
  });

  it('pod-subdomain request: v1 instance also uses the pod subdomain', async () => {
    const res = await instanceRequest('/api/v1/instance', {
      host: 'bourgeoa.pivot-test.solidproject.org:3200'
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.uri, 'https://bourgeoa.pivot-test.solidproject.org:3200');
    assert.strictEqual(body.domain, 'bourgeoa.pivot-test.solidproject.org:3200');
  });

  it('base-host request with pod token: uri resolves to the authenticated pod', async () => {
    // Create the bourgeoa pod on its subdomain (via the base host) and get its token.
    const createRes = await server.inject({
      method: 'POST',
      url: '/.pods',
      headers: {
        host: 'pivot-test.solidproject.org:3200',
        'x-forwarded-proto': 'https',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ name: 'bourgeoa' })
    });
    assert.strictEqual(createRes.statusCode, 201, 'pod creation should succeed');
    const created = createRes.json();
    assert.ok(created.token, 'pod creation should return a token');

    const res = await instanceRequest('/api/v2/instance', {
      Authorization: `Bearer ${created.token}`
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(
      body.uri,
      'https://bourgeoa.pivot-test.solidproject.org:3200',
      'base-host instance should resolve to the authenticated pod'
    );
    assert.strictEqual(body.domain, 'bourgeoa.pivot-test.solidproject.org:3200');
  });

  it('custom_emojis returns an empty array (no 404)', async () => {
    const res = await instanceRequest('/api/v1/custom_emojis', {
      host: 'bourgeoa.pivot-test.solidproject.org:3200'
    });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), []);
  });

  it('search does not fabricate accounts for nonexistent pods', async () => {
    // Search-as-you-type: partial queries like "a", "al", "ali" must NOT
    // produce accounts with avatars on nonexistent subdomains.
    for (const q of ['a', 'al', 'ali', 'alic', 'alice', 'ghost']) {
      const res = await instanceRequest(`/api/v2/search?q=${q}`, {
        host: 'bourgeoa.pivot-test.solidproject.org:3200'
      });
      assert.strictEqual(res.statusCode, 200, `search q=${q} should be 200`);
      assert.deepStrictEqual(res.json().accounts, [], `q=${q} should not fabricate accounts`);
    }
  });

  it('search returns the real pod account once it exists', async () => {
    // The bourgeoa pod was created in the token test above — search for it
    // by exact handle must return its account (subdomain host, not base host).
    const res = await instanceRequest('/api/v2/search?q=bourgeoa', {
      host: 'bourgeoa.pivot-test.solidproject.org:3200'
    });
    assert.strictEqual(res.statusCode, 200);
    const accounts = res.json().accounts;
    assert.strictEqual(accounts.length, 1);
    assert.strictEqual(accounts[0].username, 'bourgeoa');
    assert.strictEqual(
      accounts[0].url,
      'https://bourgeoa.pivot-test.solidproject.org:3200/profile/card'
    );
  });
});
