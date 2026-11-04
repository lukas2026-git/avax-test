const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

async function endpoint(name) {
  return import('../netlify/functions/' + name + '.mts');
}

test('Netlify functions expose existing public routes and return method errors', async () => {
  for (const [name, paths, allow] of [
    ['markets', ['/api/markets'], 'GET, HEAD'],
    ['token', ['/api/token', '/token'], 'GET'],
    ['output', ['/api/output', '/output'], 'GET, HEAD'],
  ]) {
    const fn = await endpoint(name);
    assert.deepEqual(fn.config.path, paths);
    const response = await fn.default(new Request('https://example.test' + paths[0], { method: 'POST' }), { ip: '192.0.2.1' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), allow);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok((await response.json()).error);
  }
});

test('Netlify grants use trusted context IP and runtime environment across endpoints', async t => {
  const previous = globalThis.Netlify;
  const originalSecret = process.env.OUTPUT_ACCESS_PASSWORD;
  delete process.env.OUTPUT_ACCESS_PASSWORD;
  globalThis.Netlify = { env: { get: name => name === 'OUTPUT_ACCESS_PASSWORD' ? 'test-only-' + 'x'.repeat(40) : undefined } };
  t.after(() => {
    if (previous === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = previous;
    if (originalSecret !== undefined) process.env.OUTPUT_ACCESS_PASSWORD = originalSecret;
  });
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ bitcoin: { usd: 100 }, ethereum: { usd: 20 } }) }));
  t.mock.method(fs, 'readFile', async file => {
    assert.ok(file.endsWith('/data/fixture.json'));
    return '{"fixture":true}';
  });
  const token = await endpoint('token');
  const output = await endpoint('output');
  const issued = await token.default(new Request('https://example.test/token?purpose=output', {
    headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '192.0.2.99' },
  }), { ip: '192.0.2.1' });
  assert.equal(issued.status, 200);
  const grant = await issued.json();
  assert.equal(grant.expiresInMs, 1000);
  const request = () => new Request('https://example.test/output?purpose=fixture.json', {
    headers: { authorization: 'Bearer ' + grant.val, 'x-nf-client-connection-ip': '192.0.2.99' },
  });
  const accepted = await output.default(request(), { ip: '192.0.2.1' });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { fixture: true });
  assert.equal((await output.default(request(), { ip: '192.0.2.2' })).status, 403);
});

test('Netlify adapter suppresses HEAD bodies and retains error headers', async () => {
  const { invoke } = await import('../lib/netlify-handler.mts');
  const response = await invoke((req, res) => {
    assert.equal(req.url, 'https://example.test/output?format=text');
    assert.equal(req.socket.remoteAddress, '192.0.2.1');
    res.statusCode = 503;
    res.setHeader('Retry-After', '60');
    res.end('body');
  }, new Request('https://example.test/output?format=text', { method: 'HEAD' }), { ip: '192.0.2.1' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(await response.text(), '');
});
