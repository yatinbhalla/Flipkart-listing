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
  // Prefixed AND singular, under Shopsy / Bathing Accessories. Read off the live
  // typeahead on 2026-10-03.
  'Bath Towels': 'Shopsy / Bathing Accessories / Shopsy Bath Towel',
  // Under "Combo Sets", not under Shopsy's own "Co-ords and Combo Sets" branch where
  // Flipkart files it. Read off the complete category tree on 2026-10-12.
  'Kids Apparel Combo': 'Shopsy / Combo Sets / Shopsy Kids Apparel Combo',
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
 *
 *   A move is written `{ from, to }` and applies ONLY to the field on the `from` tab.
 *   The bare `'<tab>'` form moves every field of that label and is kept for rules that
 *   predate this, but it is a trap worth knowing about: labels are not unique across
 *   tabs. "Height" is the package height on Price, Stock and Shipping AND the product
 *   height on Product Description, so an unqualified Height rule drags the package
 *   dimension off the price tab, leaves a mandatory field empty, and types the packet's
 *   height into the product's. Qualify every new rule.
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
      Width: { from: 'Product Description', to: 'Additional Description' },
      // Qualified deliberately: "Height" is also the package height on Price, Stock and
      // Shipping, and the unqualified rule moved that one too — leaving a mandatory
      // price-tab field empty and typing the packet's height into the product's.
      Height: { from: 'Product Description', to: 'Additional Description' },
      'Ideal Usage': { from: 'Product Description', to: 'Additional Description' },
      Organic: { from: 'Product Description', to: 'Additional Description' },
    },
  },
  'Hanging Organizers': {
    rename: { 'Items Included': 'Sales Package' },
    drop: ['Pack of'],
    retype: {},
    substitute: {},
    move: {
      'Holder Type': { from: 'Product Description', to: 'Additional Description' },
      'Mounting Type': { from: 'Product Description', to: 'Additional Description' },
      Foldable: { from: 'Product Description', to: 'Additional Description' },
    },
  },
  /**
   * Discovered on both storefronts 2026-10-03.
   *
   * Shopsy demotes four of Flipkart's mandatory Product Description attributes to
   * optional ones on Additional Description. Design and GSM are unique labels; Length
   * and Width are NOT — both are also package dimensions on the price tab — so all four
   * are written in the qualified form.
   *
   * Material is the one option list that differs: Shopsy drops Aloe Vera and Banana
   * Fiber. Cotton is on both, so no substitution is needed.
   */
  'Bath Towels': {
    rename: { 'Items Included': 'Sales Package' },
    drop: [],
    retype: {},
    substitute: {},
    move: {
      Design: { from: 'Product Description', to: 'Additional Description' },
      GSM: { from: 'Product Description', to: 'Additional Description' },
      Length: { from: 'Product Description', to: 'Additional Description' },
      Width: { from: 'Product Description', to: 'Additional Description' },
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
  /**
   * Discovered on both storefronts 2026-10-13, with complete option lists — see
   * content/KIDS_APPAREL_COMBO_SCHEMA.json and its SHOPSY_ twin.
   *
   * Flipkart's Brand Size is Shopsy's Size, with the same age ranges. Five of
   * Flipkart's mandatory Product Description attributes are optional on Shopsy's
   * Additional Description.
   *
   * Shopsy has no plain "Cotton" in Fabric, only Pure Cotton, Cotton Blend and
   * friends. A 100% cotton garment is Pure Cotton there.
   *
   * The fields that exist on one storefront only — Suitable For on Shopsy; Number of
   * Apparel Combo, Net Quantity and Suitable for Gifting on Flipkart — are marked
   * optional in the path's field map, so each storefront skips the ones it lacks.
   */
  'Kids Apparel Combo': {
    rename: { 'Brand Size': 'Size', 'Items Included': 'Sales Package' },
    drop: [],
    retype: {},
    substitute: { Fabric: { Cotton: 'Pure Cotton' } },
    move: {
      'Label Size': { from: 'Product Description', to: 'Additional Description' },
      'Primary Product Type': { from: 'Product Description', to: 'Additional Description' },
      'Secondary Product Type': { from: 'Product Description', to: 'Additional Description' },
      Pattern: { from: 'Product Description', to: 'Additional Description' },
      Occasion: { from: 'Product Description', to: 'Additional Description' },
    },
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
      const rule = rules.move[field.label];
      // A `{ from, to }` rule only fires on the tab it names. Without that check a
      // label that exists on two tabs is moved from both — see the note on `move`.
      const target = typeof rule === 'string' ? rule : rule && rule.from === tab ? rule.to : null;
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
