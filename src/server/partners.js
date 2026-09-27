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
};

/** What the vertical is called on `partner`. */
export function verticalFor(vertical, partner) {
  if (String(partner).toLowerCase() !== 'shopsy') return vertical;
  const name = SHOPSY_VERTICAL[vertical];
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
 * `unavailable` — the field exists but no longer offers a value a path uses.
 */
const SHOPSY_FIELDS = {
  'Table Cover': {
    rename: { 'Items Included': 'Sales Package' },
    drop: [],
    retype: { Color: { at: 1, label: 'Color For Refiner', type: 'multi-pick' } },
    unavailable: {},
  },
  'Blanket': {
    rename: { 'Items Included': 'Sales Package' },
    // Model Number has no equivalent on Shopsy Blanket. The SKU still goes into
    // Model Name, which does exist.
    drop: ['Model Number'],
    retype: {},
    // Shopsy's Ideal Usage offers only AC Room / Heavy Winter / Mild Winter.
    // "All Season" is not among them, and the field is optional there, so it is
    // left blank rather than guessed at — a wrong season is worse than none.
    unavailable: { 'Ideal Usage': ['All Season'] },
  },
  'Hanging Organizers': {
    rename: { 'Items Included': 'Sales Package' },
    drop: ['Pack of'],
    retype: {},
    unavailable: {},
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
  const rules = SHOPSY_FIELDS[vertical];
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
      const gone = rules.unavailable[f.label];
      return gone ? { ...f, unavailableValues: gone } : f;
    });
}

/** Adapt a whole `path.fields` map. */
export function adaptFieldMap(fieldMap, vertical, partner) {
  if (!fieldMap || String(partner).toLowerCase() !== 'shopsy') return fieldMap;
  return Object.fromEntries(
    Object.entries(fieldMap).map(([tab, fields]) => [tab, adaptFields(fields, vertical, partner)]),
  );
}
