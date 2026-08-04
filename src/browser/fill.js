/**
 * Config-driven tab filling.
 *
 * Verticals do not share a schema. Table Cover asks for 9 Product Description
 * fields; Blanket asks for 15, all mandatory, and names almost none of them the
 * same. Hardcoding one vertical's labels in the executor means every new vertical
 * needs code, so each path declares its own field map instead and this walks it.
 *
 * A field entry looks like:
 *   { label: 'Seller SKU ID', type: 'text',      from: 'sku' }
 *   { label: 'Length',        type: 'text',      from: 'package.length' }
 *   { label: 'Material',      type: 'multi-pick',from: 'material' }
 *   { label: 'Color',         type: 'pills',     from: 'colorText', at: 0 }
 *
 * `type` mirrors what describeFields() reports, so a discovery run can be turned
 * into a field map directly. `at` disambiguates repeated labels (Product
 * Description has two fields called "Color").
 */

import * as F from './form.js';

/** Resolve 'package.length' against the flattened variant object. */
function valueAt(data, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
}

/**
 * Fill one tab from its field map. Fields whose value is empty are skipped, which
 * is how optional attributes stay blank without needing to be listed as absent.
 */
export async function fillTab(page, tabName, fields, data, log) {
  await F.openTab(page, tabName);
  log(`Filling ${tabName}…`);

  for (const field of fields) {
    const value = field.from ? valueAt(data, field.from) : field.value;
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    // Conditional fields (Importer Details, handling fees) vanish based on other
    // answers, so a missing optional field is not an error.
    if (field.optional && !(await F.hasField(page, field.label))) continue;

    const at = field.at || 0;
    switch (field.type) {
      case 'dropdown':
        await F.pick(page, field.label, value, at);
        break;
      case 'multi-pick':
        await F.pickMulti(page, field.label, value, at);
        break;
      case 'pills':
      case 'multi-value':
        await F.setPills(page, field.label, value, at);
        break;
      case 'text':
      case 'long text':
      default:
        await F.setText(page, field.label, value, at);
        break;
    }
  }
}

/**
 * Turn a discovery result into a starter field map, so adding a vertical is
 * "discover, then fill in the `from` keys" rather than writing it from scratch.
 */
export function fieldMapFromDiscovery(tabs) {
  const out = {};
  for (const [tab, fields] of Object.entries(tabs)) {
    const seen = new Map();
    out[tab] = fields.map((f) => {
      const n = seen.get(f.label) || 0;
      seen.set(f.label, n + 1);
      return {
        label: f.label,
        type: f.type,
        from: '',              // fill this in
        ...(n ? { at: n } : {}),
        ...(f.mandatory ? {} : { optional: true }),
      };
    });
  }
  return out;
}
