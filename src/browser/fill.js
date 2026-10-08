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
 * Render "Cover size: {sizeInches.width} x {sizeInches.length} inch" against the
 * variant.
 *
 * Some attributes are just other attributes restated, and storing a copy means it
 * goes stale the moment a variant's dimensions change. Returns an array because
 * every field that needs this is a pill field. Yields nothing if any placeholder
 * is missing, so a half-substituted string never reaches the form.
 */
function renderTemplate(template, data) {
  let missing = false;
  const text = String(template).replace(/\{([^}]+)\}/g, (_, path) => {
    const v = valueAt(data, path.trim());
    if (v === undefined || v === null || v === '') missing = true;
    return String(v ?? '');
  });
  return missing ? [] : [text];
}

/**
 * Fill one tab from its field map. Fields whose value is empty are skipped, which
 * is how optional attributes stay blank without needing to be listed as absent.
 */
export async function fillTab(page, tabName, fields, data, log) {
  await F.openTab(page, tabName);
  log(`Filling ${tabName}…`);

  for (const field of fields) {
    const value = field.template
      ? renderTemplate(field.template, data)
      : field.from
        ? valueAt(data, field.from)
        : field.value;
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    // Conditional fields (Importer Details, handling fees) vanish based on other
    // answers, so a missing optional field is not an error.
    if (field.optional && !(await F.hasField(page, field.label))) continue;


    // A storefront that does not offer the path's value takes the seller's chosen
    // stand-in instead — Shopsy has no "All Season" for Ideal Usage, so the muslin
    // paths list as "AC Room" there while Flipkart keeps "All Season".
    const swap = field.substitute;
    const swapOne = (v) => (swap ? swap[String(v)] ?? v : v);
    // Arrayness is preserved: a dropdown takes a scalar, and wrapping one in an
    // array here would hand pick() something it cannot match against an option.
    const final = !swap ? value : Array.isArray(value) ? value.map(swapOne) : swapOne(value);
    if (swap && String(final) !== String(value)) {
      log(`↷ ${field.label}: "${value}" → "${final}" on this storefront.`);
    }

    const at = field.at || 0;
    // Time each field. A tab that takes three minutes says nothing about WHICH field
    // took it, and the obvious suspects have twice turned out innocent — so report any
    // field slow enough to matter and stay quiet about the rest.
    const started = Date.now();
    switch (field.type) {
      case 'dropdown':
        await F.pick(page, field.label, final, at);
        break;
      case 'multi-pick':
        await F.pickMulti(page, field.label, final, at);
        break;
      case 'pills':
      case 'multi-value':
        await F.setPills(page, field.label, final, at);
        break;
      case 'text':
      case 'long text':
      default:
        await F.setText(page, field.label, final, at);
        break;
    }
    const took = Date.now() - started;
    if (took > 4000) log(`  ⏱ ${field.label} took ${(took / 1000).toFixed(1)}s`);
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
