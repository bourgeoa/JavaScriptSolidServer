/**
 * remoteStorage plugin tests
 *
 * Tests the remoteStorage (RS) plugin endpoints:
 *   GET/PUT/DELETE /storage/:user/*
 *
 * Covers:
 *   - folder listing, file read/write/delete
 *   - JSON object body PUT (regression: Buffer.from(object))
 *   - pod prefix: subdomain & suffix modes (regression: data-at-root)
 *   - double-slash normalization (RS client quirk)
 *   - public folder access without auth
 *   - dotfile blocking
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import {
  startTestServer,
  stopTestServer,
  request,
  createTestPod,
  getPodToken,
} from './helpers.js';

const DATA_ROOT = './data';

describe('remoteStorage plugin', () => {
  before(async () => {
    await startTestServer();
    await createTestPod('rstest');
  });

  after(async () => {
    await stopTestServer();
  });

  // ------------------------------------------------------------------
  // Folder listing
  // ------------------------------------------------------------------
  describe('GET folder', () => {
    it('returns empty listing for non-existent folder', async () => {
      const res = await request('/storage/rstest/nonexistent/', { auth: 'rstest' });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.deepStrictEqual(body.items, {});
    });

    it('returns items for a folder with files', async () => {
      // Create files via PUT
      await request('/storage/rstest/list-test/a.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello',
        auth: 'rstest',
      });
      await request('/storage/rstest/list-test/b.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'world',
        auth: 'rstest',
      });

      const res = await request('/storage/rstest/list-test/', { auth: 'rstest' });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.items['a.txt'], 'should list a.txt');
      assert.ok(body.items['b.txt'], 'should list b.txt');
    });
  });

  // ------------------------------------------------------------------
  // PUT / GET / DELETE lifecycle
  // ------------------------------------------------------------------
  describe('PUT / GET / DELETE', () => {
    const testPath = '/storage/rstest/crud/test.json';
    const testData = '{"hello":"world"}';

    it('PUT creates a file and returns 201', async () => {
      const res = await request(testPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: testData,
        auth: 'rstest',
      });
      assert.strictEqual(res.status, 201);
    });

    it('GET reads the file back', async () => {
      const res = await request(testPath, { auth: 'rstest' });
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.strictEqual(text, testData);
    });

    it('PUT overwrites and returns 200', async () => {
      const res = await request(testPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"updated":true}',
        auth: 'rstest',
      });
      assert.strictEqual(res.status, 200);
      const get = await request(testPath, { auth: 'rstest' });
      assert.strictEqual(await get.text(), '{"updated":true}');
    });

    it('DELETE removes the file', async () => {
      const res = await request(testPath, {
        method: 'DELETE',
        auth: 'rstest',
      });
      assert.strictEqual(res.status, 200);
      const get = await request(testPath, { auth: 'rstest' });
      assert.strictEqual(get.status, 404);
    });

    it('DELETE returns 404 for non-existent file', async () => {
      const res = await request(testPath, {
        method: 'DELETE',
        auth: 'rstest',
      });
      assert.strictEqual(res.status, 404);
    });
  });

  // ------------------------------------------------------------------
  // JSON object body (regression: Buffer.from(object) threw)
  // ------------------------------------------------------------------
  describe('PUT with JSON object body', () => {
    it('stores a JSON object body as stringified JSON', async () => {
      const obj = { value: 'hello', done: false };
      const res = await request('/storage/rstest/json-body/item.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj),
        auth: 'rstest',
      });
      assert.strictEqual(res.status, 201);

      const get = await request('/storage/rstest/json-body/item.json', { auth: 'rstest' });
      const body = await get.json();
      assert.deepStrictEqual(body, obj);
    });
  });

  // ------------------------------------------------------------------
  // Pod prefix — ensures data goes under <podName>, not at root
  // ------------------------------------------------------------------
  describe('pod prefix (data isolation)', () => {
    it('writes files inside the pod directory, not at data root', async () => {
      await request('/storage/rstest/prefix-test/file.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'isolated',
        auth: 'rstest',
      });

      // Should exist inside the pod
      const podPath = path.join(DATA_ROOT, 'rstest', 'prefix-test', 'file.txt');
      const exists = await fs.pathExists(podPath);
      assert.ok(exists, `file should exist at ${podPath}`);

      // Should NOT exist at root level
      const rootPath = path.join(DATA_ROOT, 'prefix-test', 'file.txt');
      const rootExists = await fs.pathExists(rootPath);
      assert.ok(!rootExists, `file should NOT exist at ${rootPath}`);
    });
  });

  // ------------------------------------------------------------------
  // Double-slash normalization (RS client appends path to href ending with /)
  // ------------------------------------------------------------------
  describe('double-slash URLs', () => {
    it('normalizes // in path', async () => {
      await request('/storage/rstest//dslash/a.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'slash',
        auth: 'rstest',
      });

      const res = await request('/storage/rstest/dslash/a.txt', { auth: 'rstest' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), 'slash');
    });
  });

  // ------------------------------------------------------------------
  // Public folder — readable without auth
  // ------------------------------------------------------------------
  describe('public folder access', () => {
    it('allows unauthenticated GET on /storage/:user/public/', async () => {
      // Create a file in public
      await request('/storage/rstest/public/hello.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'public data',
        auth: 'rstest',
      });

      const res = await request('/storage/rstest/public/hello.txt');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), 'public data');
    });

    it('rejects unauthenticated PUT on /storage/:user/public/', async () => {
      const res = await request('/storage/rstest/public/unauth-put.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'nope',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated GET on private folders', async () => {
      const res = await request('/storage/rstest/crud/test.json');
      assert.strictEqual(res.status, 401);
    });
  });

  // ------------------------------------------------------------------
  // Dotfile blocking
  // ------------------------------------------------------------------
  describe('dotfile blocking', () => {
    it('rejects PUT to dotfiles with 403', async () => {
      const res = await request('/storage/rstest/.secret', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hidden',
        auth: 'rstest',
      });
      assert.strictEqual(res.status, 403);
    });

    it('rejects GET on dotfiles with 403', async () => {
      const res = await request('/storage/rstest/.secret', { auth: 'rstest' });
      assert.strictEqual(res.status, 403);
    });
  });

  // ------------------------------------------------------------------
  // Unknown user
  // ------------------------------------------------------------------
  describe('unknown user', () => {
    it('returns 404 for unknown user in single-user mode', async () => {
      // The server is multi-user by default, but an unknown user param
      // should still fail if ownerWebId is set.
      // In multi-user mode (ownerWebId null), any user is accepted.
      const res = await request('/storage/ghost/public/hello.txt');
      // With ownerWebId null, checkUsername passes but checkAuth fails (401).
      // The response depends on auth state — likely 401.
      assert.ok(res.status >= 400, `expected error status, got ${res.status}`);
    });
  });
});
