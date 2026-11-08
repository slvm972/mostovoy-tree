// tree-card-icons.js - which contact icons to show on a person card (pure logic, no DOM).
// Rule: icons only for LIVING persons. "Deceased" = death is non-empty after trimming spaces
// (the same rule as the contacts .vcf export). A field counts as filled when, after splitting
// by comma / line break and trimming, at least one non-empty piece remains.
// The page decides separately whether the user is logged in; this file knows nothing about it.

// Position of the icon row on a 150x100 card, measured from the top-left corner.
// x: start of the first icon; y: text baseline; step: distance between icons; size: font size.
// The row sits between the top-left corner marker (ends at x=18) and the role label (starts at x>=52).
var CONTACT_ICONS = { x: 20, y: 14, step: 10, size: 9 };

function cardContactHasValue(v) {
  if (v === null || v === undefined) return false;
  return String(v).split(/[,\r\n]+/).some(function (p) { return p.trim() !== ''; });
}

function cardContactIsDeceased(n) {
  return !!(n && n.death !== null && n.death !== undefined && String(n.death).trim() !== '');
}

// Returns the list of icons in display order: phone, e-mail, social page.
function contactIconsFor(n) {
  if (!n || cardContactIsDeceased(n)) return [];
  var out = [];
  if (cardContactHasValue(n.phone)) out.push('\uD83D\uDCDE');
  if (cardContactHasValue(n.email)) out.push('\u2709\uFE0F');
  if (cardContactHasValue(n.social)) out.push('\uD83D\uDD17');
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONTACT_ICONS: CONTACT_ICONS, cardContactHasValue: cardContactHasValue,
                     cardContactIsDeceased: cardContactIsDeceased, contactIconsFor: contactIconsFor };
}
