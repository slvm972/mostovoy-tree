// setup.js — запустите один раз: node setup.js
// Создаёт хэши паролей и обновляет wrangler.toml

const crypto = require('crypto');
const fs     = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, res));

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

(async () => {
  console.log('\n🌳 Настройка семейного дерева Мостовых\n');

  const guest = await ask('Введите пароль для гостей (родственники): ');
  const admin = await ask('Введите пароль администратора (только для вас): ');

  if(!guest || !admin) { console.log('❌ Пароли не могут быть пустыми'); process.exit(1); }
  if(guest === admin)  { console.log('❌ Пароли должны отличаться'); process.exit(1); }

  const gHash = sha256(guest);
  const aHash = sha256(admin);

  console.log('\n✅ Хэши паролей сгенерированы');
  console.log('   Гость:', gHash.slice(0,16) + '...');
  console.log('   Админ:', aHash.slice(0,16) + '...');

  // Update wrangler.toml
  let toml = fs.readFileSync('wrangler.toml', 'utf8');
  toml = toml.replace('PLACEHOLDER_GUEST_HASH', gHash);
  toml = toml.replace('PLACEHOLDER_ADMIN_HASH', aHash);
  fs.writeFileSync('wrangler.toml', toml);

  console.log('\n✅ wrangler.toml обновлён');
  console.log('\n📋 Следующие шаги:');
  console.log('   1. npx wrangler login          (войти в Cloudflare)');
  console.log('   2. npx wrangler kv namespace create TREE_KV');
  console.log('      → скопируйте ID и вставьте в wrangler.toml вместо PLACEHOLDER_KV_ID');
  console.log('   3. npx wrangler deploy         (задеплоить Worker)');
  console.log('   4. Скопируйте URL Worker\'а и вставьте в tree_a4a.html\n');

  rl.close();
})();
