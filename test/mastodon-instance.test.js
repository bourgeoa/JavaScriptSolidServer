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
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from '../src/server.js';

describe('Mastodon instance (subdomain mode)', () => {
  let server = null;

  before(async () => {
    server = createServer({
      logger: false,
      forceCloseConnections: true,
      activitypub: true,
      apUsername: 'bourgeoa',
      subdomains: true,
      baseDomain: 'pivot-test.solidproject.org:3200'
    });
    await server.listen({ port: 0, host: '127.0.0.1' });
  });

  after(async () => {
    if (server) await server.close();
  });

  it('v2 instance uri includes the account subdomain and has a scheme', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v2/instance',
      headers: {
        host: 'pivot-test.solidproject.org:3200',
        'x-forwarded-proto': 'https'
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(
      body.uri,
      'https://bourgeoa.pivot-test.solidproject.org:3200',
      'uri should be a full URL on the account subdomain'
    );
    assert.strictEqual(
      body.domain,
      'bourgeoa.pivot-test.solidproject.org:3200',
      'domain should be the account subdomain (host-only)'
    );
    assert.ok(
      body.urls?.streaming_api?.startsWith('wss://bourgeoa.pivot-test.solidproject.org:3200'),
      'streaming API should point at the account subdomain'
    );
  });

  it('v1 instance also uses the account subdomain', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/instance',
      headers: {
        host: 'pivot-test.solidproject.org:3200',
        'x-forwarded-proto': 'https'
      }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.uri, 'https://bourgeoa.pivot-test.solidproject.org:3200');
    assert.strictEqual(body.domain, 'bourgeoa.pivot-test.solidproject.org:3200');
  });
});
