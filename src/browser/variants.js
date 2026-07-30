/**
 * The per-variant matrix table at the bottom of the "Variant addition" tab.
 *
 * Each variant gets a full row with its OWN Seller SKU, MRP, selling price, package
 * dimensions, Width/Length, Description, Search Keywords, Key Features and so on —
 * variants are not limited to inheriting the parent's price and size.
 *
 * Type / Material / Pattern are NOT columns here. They are product-level and shared
 * across every variant.
 */

import { OPTION, PILL, scrollSection } from './form.js';

const settle = (page, ms = 400) => page.waitForTimeout(ms);

/**
 * Column headers repeat: "Length" is both the package dimension (cm) and the
 * product dimension (inch); "Weight" is both package (kg) and product (g). Callers
 * disambiguate with `occurrence` — 0 for the first (package), 1 for the second.
 */
export async function readHeaders(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    return [...table.querySelectorAll('th')].map((th) => (th.innerText || '').replace(/\*/g, '').trim());
  });
}

export async function readRowCount(page) {
  return page.evaluate(() => document.querySelectorAll('table tbody tr').length);
}

/** Resolve a column name (+ which occurrence of it) to a cell index. */
async function colIndex(page, name, occurrence = 0) {
  const headers = await readHeaders(page);
  const want = name.trim().toLowerCase();
  let seen = 0;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase() !== want) continue;
    if (seen === occurrence) return i;
    seen++;
  }
  throw new Error(
    `Variant column "${name}"${occurrence ? ` (occurrence ${occurrence})` : ''} not found. ` +
      `Columns: ${headers.filter(Boolean).join(' | ')}`,
  );
}

/** Tag one cell so we can drive it with real Playwright events. */
async function cell(page, rowIdx, name, occurrence = 0) {
  const col = await colIndex(page, name, occurrence);
  const token = 'fkv' + Math.random().toString(36).slice(2, 10);
  const ok = await page.evaluate(
    ({ rowIdx, col, token }) => {
      const row = document.querySelectorAll('table tbody tr')[rowIdx];
      const td = row?.children[col];
      if (!td) return false;
      td.setAttribute('data-fkv', token);
      return true;
    },
    { rowIdx, col, token },
  );
  if (!ok) throw new Error(`Variant cell not found: row ${rowIdx}, column "${name}"`);

  const loc = page.locator(`[data-fkv="${token}"]`);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  return loc;
}

export async function setCellText(page, rowIdx, name, value, occurrence = 0) {
  if (value === undefined || value === null || value === '') return;
  const td = await cell(page, rowIdx, name, occurrence);
  const input = td.locator('input:not([type=hidden]), textarea').first();
  await input.fill(String(value));
  await settle(page, 300);
}

export async function readCellText(page, rowIdx, name, occurrence = 0) {
  const td = await cell(page, rowIdx, name, occurrence);
  const input = td.locator('input:not([type=hidden]), textarea').first();
  if (!(await input.count())) return '';
  return (await input.inputValue().catch(() => '')) || '';
}

/**
 * Many matrix columns that render as plain boxes are really dropdowns — Listing
 * Status, Fullfilment by, Procurement type, Shipping provider, Country Of Origin,
 * Tax Code, MinOQ, Color, Reversible, Wrinkle Free, Gift Pack. Typing into their
 * inner input looks like it works but leaves the cell reading "Select".
 */
export async function setCellPick(page, rowIdx, name, optionText, occurrence = 0) {
  if (!optionText) return;
  const td = await cell(page, rowIdx, name, occurrence);
  await td.locator('button[class*=DropdownButton]').first().click();
  await settle(page, 600);

  const want = String(optionText).trim().toLowerCase();
  const visible = page.locator(`${OPTION}:visible`);
  const count = await visible.count();
  for (let i = 0; i < count; i++) {
    const el = visible.nth(i);
    const text = ((await el.innerText().catch(() => '')) || '').trim().toLowerCase();
    if (text === want) {
      await el.click();
      await settle(page, 500);
      return;
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  throw new Error(`Variant option "${optionText}" not found for column "${name}"`);
}

/** Multi-value columns use the same pill widget as the main form. */
export async function setCellPills(page, rowIdx, name, values, occurrence = 0) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return;
  const td = await cell(page, rowIdx, name, occurrence);
  const container = td.locator('.rti--container').first();
  for (const value of list) {
    await container.click();
    const input = td.locator('.rti--input').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.type(value, { delay: 8 });
    await input.press('Enter');
    await settle(page, 250);
  }
}

export async function countCellPills(page, rowIdx, name, occurrence = 0) {
  const td = await cell(page, rowIdx, name, occurrence);
  return td.locator(PILL).count();
}

/**
 * Add a variant on one of the three axes the vertical offers (Color, Pack of,
 * Seating Capacity). Free-text axes have an "Enter New ..." box; enumerated axes
 * (Seating Capacity) have a dropdown. Either way you then press Create.
 */
export async function addVariant(page, axis, value) {
  await scrollSection(page, 0);
  const rowLabel = page.locator('text=' + axis).first();
  await rowLabel.scrollIntoViewIfNeeded().catch(() => {});

  const container = page.locator('div').filter({ hasText: new RegExp(`^${axis}$`) }).last();
  const box = container.locator('xpath=..');

  const dropdown = box.locator('button[class*=DropdownButton], [class*=Dropdown]').first();
  const textBox = box.locator(`input[placeholder*="Enter New"]`).first();

  if (await textBox.count()) {
    await textBox.fill(String(value));
  } else if (await dropdown.count()) {
    await dropdown.click();
    await settle(page, 600);
    const opt = page.locator(`${OPTION}:visible`).filter({ hasText: new RegExp(`^\\s*${value}\\s*$`, 'i') }).first();
    await opt.click();
  } else {
    throw new Error(`Could not find the "${axis}" variant input.`);
  }
  await settle(page, 400);

  const create = box.locator('text=Create').first();
  await create.click();
  await page.waitForTimeout(3000);
}

/**
 * Snapshot a whole variant row so a caller can verify it survived the save.
 *
 * WHY this exists: on the first save after filling the matrix, Procurement SLA,
 * Stock and the package L/B/H/Weight silently came back EMPTY and had to be
 * re-entered. Never trust a matrix write until you have re-read it post-save.
 */
export async function readRow(page, rowIdx) {
  return page.evaluate(
    ({ rowIdx, PILL }) => {
      const table = document.querySelector('table');
      const headers = [...table.querySelectorAll('th')].map((th) => (th.innerText || '').replace(/\*/g, '').trim());
      const row = document.querySelectorAll('table tbody tr')[rowIdx];
      if (!row) return null;
      const out = {};
      [...row.children].forEach((td, i) => {
        const key = headers[i] || `col${i}`;
        const pills = td.querySelectorAll(PILL).length;
        const input = td.querySelector('input:not([type=hidden]), textarea');
        const drop = td.querySelector('button[class*=DropdownButton]');
        let value;
        if (pills) value = `${pills} pill(s)`;
        else if (drop) value = (td.innerText || '').trim().split('\n')[0];
        else if (input) value = String(input.value);
        else value = (td.innerText || '').trim();
        if (out[key] === undefined) out[key] = value;
        else out[`${key} (2)`] = value;
      });
      return out;
    },
    { rowIdx, PILL },
  );
}
