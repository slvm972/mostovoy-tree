// card-icons-test.js - run: node test-data\card-icons-test.js
const { contactIconsFor, cardContactHasValue, cardContactIsDeceased, CONTACT_ICONS } = require('../public/tree-card-icons.js');

const PHONE = '\uD83D\uDCDE', MAIL = '\u2709\uFE0F', LINK = '\uD83D\uDD17';
let passed = 0, failed = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + '\n   got:  ' + g + '\n   want: ' + w); }
}

eq('phone only',                   contactIconsFor({ phone: '050-000-0000' }), [PHONE]);
eq('email only',                   contactIconsFor({ email: 'a@b.c' }), [MAIL]);
eq('social only',                  contactIconsFor({ social: 'https://x.y/z' }), [LINK]);
eq('all three, fixed order',       contactIconsFor({ social: 'https://x.y/z', email: 'a@b.c', phone: '1' }), [PHONE, MAIL, LINK]);
eq('phone and social',             contactIconsFor({ phone: '1', social: 'u' }), [PHONE, LINK]);
eq('none at all',                  contactIconsFor({ name: 'A' }), []);
eq('empty strings',                contactIconsFor({ phone: '', email: '', social: '' }), []);
eq('spaces only',                  contactIconsFor({ phone: '   ', email: ' \t ', social: ' ' }), []);
eq('commas and breaks only',       contactIconsFor({ phone: ' , ,\n, ', email: ',', social: '\r\n' }), []);
eq('several values with comma',    contactIconsFor({ phone: '050-1, 052-2' }), [PHONE]);
eq('several values with break',    contactIconsFor({ social: 'https://a\nhttps://b' }), [LINK]);
eq('empty piece then a value',     contactIconsFor({ phone: ' , 050-1' }), [PHONE]);
eq('null and undefined values',    contactIconsFor({ phone: null, email: undefined, social: 'u' }), [LINK]);
eq('deceased with contacts',       contactIconsFor({ death: '12 JAN 2020', phone: '1', email: 'a@b.c', social: 'u' }), []);
eq('deceased, date unknown (ум.)', contactIconsFor({ death: '\u0443\u043c.', phone: '1', email: 'a@b.c', social: 'u' }), []);
eq('deceased, year only',          contactIconsFor({ death: '1999', phone: '1' }), []);
eq('death empty string = alive',   contactIconsFor({ death: '', phone: '1' }), [PHONE]);
eq('death spaces only = alive',    contactIconsFor({ death: '   ', phone: '1' }), [PHONE]);
eq('death null = alive',           contactIconsFor({ death: null, email: 'a@b.c' }), [MAIL]);
eq('no person object',             contactIconsFor(null), []);
eq('no person (undefined)',        contactIconsFor(undefined), []);
eq('helper: hasValue number',      cardContactHasValue(12345), true);
eq('helper: isDeceased',           [cardContactIsDeceased({ death: 'x' }), cardContactIsDeceased({ death: ' ' }), cardContactIsDeceased({})], [true, false, false]);
eq('position constant is set',     [typeof CONTACT_ICONS.x, typeof CONTACT_ICONS.y, typeof CONTACT_ICONS.step, typeof CONTACT_ICONS.size], ['number', 'number', 'number', 'number']);
eq('icons fit before the role label', CONTACT_ICONS.x + 2 * CONTACT_ICONS.step + CONTACT_ICONS.size <= 52, true);

console.log(failed ? ('CARD ICONS TEST: ' + failed + ' FAILED, ' + passed + ' passed') : ('CARD ICONS TEST: all ' + passed + ' passed'));
process.exit(failed ? 1 : 0);
