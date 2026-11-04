const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');

test('Netlify publishes static assets and bundles private data for file endpoints', () => {
  const config = fs.readFileSync(require('node:path').join(__dirname, '../netlify.toml'), 'utf8');
  assert.match(config, /publish = "public"/);
  assert.match(config, /directory = "netlify\/functions"/);
  for (const endpoint of ['token', 'output']) {
    assert.ok(config.includes('[functions.' + endpoint + ']\n  included_files = ["data/**"]'));
  }
  assert.equal(fs.existsSync(require('node:path').join(__dirname, '../vercel.json')), false);
});

test('each deployed function handles methods without a central router', async () => {
  for (const endpoint of ['markets', 'token']) {
    let body;
    const headers = {};
    const res = { setHeader(k,v) { headers[k] = v; }, end(value) { body = value; } };
    await require('../api/' + endpoint)({method:'POST'}, res);
    assert.equal(res.statusCode, 405);
    assert.equal(headers.Allow, 'GET, HEAD');
    assert.ok(JSON.parse(body).error);
  }
});

test('local HTTP serves static dashboard, aliases token, and rejects private paths', async t => {
  const original = global.fetch;
  global.fetch = async () => ({ok:true,json:async()=>({bitcoin:{usd:100},ethereum:{usd:20}})});
  const server = http.createServer(require('../scripts/local-router.cjs'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { global.fetch = original; await new Promise(resolve => server.close(resolve)); });
  const address = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await original(address)).status, 200);
  assert.match(await (await original(address + '/app.js')).text(), /timeout\(25000\)/);
  assert.equal((await original(address + '/lib/token.js')).status, 404);
  for (const route of ['/token', '/api/token']) {
    const response = await original(address + route);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ethereum.price, 20);
  }
});
