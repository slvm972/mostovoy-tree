// test-data/login-limit-test.js - login rate limiting and password length rules of src/index.js
// Runs the Worker code in plain Node with a fake KV store: no network, nothing is deployed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = crypto.webcrypto;

const srcPath = path.join(__dirname, '..', 'src', 'index.js');
const src = fs.readFileSync(srcPath, 'utf8');
if (!src.includes('export default {')) { console.log('FAIL  export default not found in src/index.js'); process.exit(1); }
const tmp = path.join(os.tmpdir(), 'worker-under-test-' + process.pid + '.cjs');
fs.writeFileSync(tmp, src.replace('export default {', 'module.exports = {'));
const worker = require(tmp);
fs.unlinkSync(tmp);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}

function makeEnv() {
  const m = new Map();
  const putCalls = [];
  const kv = {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { putCalls.push({ k, o }); m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [] }; },
  };
  return { TREE_KV: kv, putCalls, ADMIN_PASSWORD_HASH: sha('admin-password-1'), GUEST_PASSWORD_HASH: sha('guest-password-1'), TREE_ACTIVE: 'true' };
}

async function call(env, method, p, o) {
  o = o || {};
  const headers = { 'CF-Connecting-IP': o.ip || '10.0.0.1', 'Content-Type': 'application/json' };
  if (o.header) headers['X-Password'] = o.header;
  const init = { method, headers };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  const res = await worker.fetch(new Request('https://t.example' + p, init), env);
  return res.status;
}
const login = (env, pw, ip) => call(env, 'POST', '/api/login', { body: { password: pw }, ip });

(async () => {
  let env = makeEnv();
  check('correct guest password logs in', (await login(env, 'guest-password-1')) === 200);
  check('wrong password is rejected with 401', (await login(env, 'nope')) === 401);

  env = makeEnv();
  let all401 = true;
  for (let i = 0; i < 10; i++) { if ((await login(env, 'bad' + i)) !== 401) all401 = false; }
  check('ten wrong passwords are answered with 401', all401);
  check('the eleventh attempt is blocked with 429', (await login(env, 'bad-again')) === 429);
  check('the correct password is also blocked from that IP', (await login(env, 'guest-password-1')) === 429);
  check('another IP is not affected', (await login(env, 'guest-password-1', '10.0.0.2')) === 200);
  check('failures are stored with an expiry', env.putCalls.length > 0 && env.putCalls.every(c => c.o && c.o.expirationTtl > 0));

  env = makeEnv();
  let all401b = true;
  for (let i = 0; i < 10; i++) { if ((await call(env, 'GET', '/api/tree', { header: 'wrong' + i })) !== 401) all401b = false; }
  check('wrong passwords sent in the X-Password header are counted too', all401b);
  check('the next request with a password header is blocked', (await call(env, 'GET', '/api/tree', { header: 'wrong-more' })) === 429);
  check('the correct password in the header is blocked as well', (await call(env, 'GET', '/api/tree', { header: 'guest-password-1' })) === 429);

  env = makeEnv();
  for (let i = 0; i < 9; i++) await login(env, 'bad' + i);
  check('nine failures do not block yet', (await login(env, 'guest-password-1')) === 200);

  env = makeEnv();
  check('guest password shorter than 8 characters is refused', (await call(env, 'PATCH', '/api/settings/guest-password', { header: 'admin-password-1', body: { password: '1234567' } })) === 400);
  check('guest password of 8 characters is accepted', (await call(env, 'PATCH', '/api/settings/guest-password', { header: 'admin-password-1', body: { password: '12345678' } })) === 200);
  check('the new guest password works afterwards', (await login(env, '12345678')) === 200);
  check('a guest cannot change the guest password', (await call(env, 'PATCH', '/api/settings/guest-password', { header: 'guest-password-1', body: { password: 'another-long-one' } })) === 403);

  console.log('');
  if (failed === 0) { console.log('LOGIN LIMIT TEST: all ' + passed + ' passed'); process.exit(0); }
  console.log('LOGIN LIMIT TEST: ' + failed + ' FAILED, ' + passed + ' passed');
  process.exit(1);
})();
