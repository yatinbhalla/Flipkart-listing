/**
 * Flipkart and Shopsy are two storefronts behind one Seller Hub, and a product
 * listed on one is not listed on the other. The same path data drives both, so a
 * path is not duplicated per storefront — the run picks the partner, and this
 * module translates the path for it.
 *
 * Captured from live forms on 2026-09-27; see content/SHOPSY_*_SCHEMA.json.
 */

export const PARTNERS = ['flipkart', 'shopsy'];

/**
 * Shopsy's name for each vertical.
 *
 * Mostly "Shopsy " + the Flipkart name, but Hanging Organizers is singular on
 * Shopsy. Deriving the name by prefixing would therefore search for a vertical
 * that does not exist, and the typeahead would come back empty.
 */
const SHOPSY_VERTICAL = {
  'Table Cover': 'Shopsy Table Cover',
  'Blanket': 'Shopsy Blanket',
  'Hanging Organizers': 'Shopsy Hanging Organizer',
  // Not prefixed. Verified by discovering the vertical on the Shopsy catalogue under
  // this exact name on 2026-10-01 — "Shopsy Bath Linen Set" does not exist.
  'Bath Linen Set': 'Bath Linen Set',
};

/** What the vertical is called on `partner`. */
/**
 * Look a vertical up by its leaf.
 *
 * A path may carry the full category path Flipkart shows — "Baby Care / Bath Care,
 * Diapering & Potty / Bath Towels" — while these tables are keyed on the vertical
 * name alone. Keying on the whole string meant every Shopsy run on such a path threw
 * after the images were already uploaded.
 */
function byLeaf(table, vertical) {
  if (table[vertical]) return table[vertical];
  const leaf = String(vertical || '').split('/').pop().trim();
  return table[leaf];
}

export function verticalFor(vertical, partner) {
  if (String(partner).toLowerCase() !== 'shopsy') return vertical;
  const name = byLeaf(SHOPSY_VERTICAL, vertical);
  if (!name) throw new Error(`No Shopsy vertical is known for "${vertical}".`);
  return name;
}

/**
 * Per-vertical field differences on Shopsy.
 *
 * `rename` — same attribute, different label. Shopsy calls Items Included
 *   "Sales Package" on all three verticals.
 * `drop` — the attribute does not exist on Shopsy at all. Filling it would send
 *   the label hunt looking for a row that is not there.
 * `retype` — the control changed arity. Table Cover's second "Color" is a
 *   single-select dropdown on Flipkart and a multi-select named "Color For
 *   Refiner" on Shopsy; driving a multi-select as a single-select leaves its menu
 *   open and the next field then searches a stale option list.
 * `substitute` — the field exists but no longer offers a value a path uses, and the
 *   seller has chosen what it becomes instead.
 * `move` — the attribute lives on a different tab. Filling is tab-scoped, so a field
 *   left on its Flipkart tab is hunted for on a page that does not have it. These
 *   all move from mandatory on Product Description to optional on Additional
 *   Description, so they are marked optional as they go.
 */
const SHOPSY_FIELDS = {
  'Table Cover': {
    rename: { 'Items Included': 'Sales Package' },
    drop: [],
    retype: { Color: { at: 1, label: 'Color For Refiner', type: 'multi-pick' } },
    substitute: {},
    move: {},
  },
  'Blanket': {
    rename: { 'Items Included': 'Sales Package' },
    // Model Number has no equivalent on Shopsy Blanket. The SKU still goes into
    // Model Name, which does exist.
    drop: ['Model Number'],
    retype: {},
    // Shopsy's Ideal Usage offers only AC Room / Heavy Winter / Mild Winter, so the
    // muslin paths' "All Season" has nowhere to go. AC Room is the seller's choice
    // for it, not a guess.
    substitute: { 'Ideal Usage': { 'All Season': 'AC Room' } },
    move: {
      Width: 'Additional Description',
      Height: 'Additional Description',
      'Ideal Usage': 'Additional Description',
      Organic: 'Additional Description',
    },
  },
  'Hanging Organizers': {
    rename: { 'Items Included': 'Sales Package' },
    drop: ['Pack of'],
    retype: {},
    substitute: {},
    move: {
      'Holder Type': 'Additional Description',
      'Mounting Type': 'Additional Description',
      Foldable: 'Additional Description',
    },
  },
  // Discovered on both storefronts 2026-10-01. The two forms are identical field for
  // field except the Sales Package rename and Procurement type, which drops "domestic
  // procurement" on Shopsy — a value no path uses. Nothing moves tab, nothing is
  // dropped, and every option list matches value for value.
  'Bath Linen Set': {
    rename: { 'Items Included': 'Sales Package' },
    drop: [],
    retype: {},
    substitute: {},
    move: {},
  },
};

/**
 * Translate one tab's field map for `partner`.
 *
 * Returns a new array; the path's own config is never mutated, so the same loaded
 * path can drive a Flipkart run and a Shopsy run in the same batch.
 */
export function adaptFields(fields, vertical, partner) {
  if (String(partner).toLowerCase() !== 'shopsy') return fields;
  const rules = byLeaf(SHOPSY_FIELDS, vertical);
  if (!rules) throw new Error(`No Shopsy field rules are known for "${vertical}".`);

  return (fields || [])
    .filter((f) => !rules.drop.includes(f.label))
    .map((f) => {
      const retype = rules.retype[f.label];
      // `at` disambiguates repeated labels, so a retype rule only applies to the
      // occurrence it names — Table Cover has two fields called "Color" and only
      // the second one becomes Color For Refiner.
      if (retype && (f.at || 0) === retype.at) {
        return { ...f, label: retype.label, type: retype.type, at: 0 };
      }
      if (rules.rename[f.label]) return { ...f, label: rules.rename[f.label] };
      return { ...f };
    })
    .map((f) => {
      const swap = rules.substitute[f.label];
      return swap ? { ...f, substitute: swap } : f;
    });
}

/**
 * Adapt a whole `path.fields` map, including fields that change tab.
 *
 * Moves are applied across the whole map rather than per tab, because filling is
 * tab-scoped: `fillTab` opens one tab and addresses labels within it, so a field
 * still listed under its Flipkart tab would be searched for on a page that does
 * not contain it.
 */
export function adaptFieldMap(fieldMap, vertical, partner) {
  if (!fieldMap || String(partner).toLowerCase() !== 'shopsy') return fieldMap;
  const rules = byLeaf(SHOPSY_FIELDS, vertical);
  if (!rules) throw new Error(`No Shopsy field rules are known for "${vertical}".`);

  const out = Object.fromEntries(
    Object.entries(fieldMap).map(([tab, fields]) => [tab, adaptFields(fields, vertical, partner)]),
  );

  for (const [tab, fields] of Object.entries(out)) {
    const staying = [];
    for (const field of fields) {
      const target = rules.move[field.label];
      if (!target || target === tab) {
        staying.push(field);
        continue;
      }
      out[target] = out[target] || [];
      // Optional on arrival: every move so far is a field Shopsy demotes from
      // mandatory, and marking it lets the fill skip it if the form omits it.
      out[target].push({ ...field, optional: true });
    }
    out[tab] = staying;
  }
  return out;
}
