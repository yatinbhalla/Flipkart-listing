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

/**
 * Does this matrix have such a column?
 *
 * The column set is per-vertical and does not match the tab field set — Hanging
 * Organizers has no Model Number column even though Model Number is a mandatory
 * field on its Product Description tab. A config-driven row filler needs to skip
 * what is not there rather than abort the listing.
 */
export async function hasColumn(page, name, occurrence = 0) {
  return colIndex(page, name, occurrence).then(() => true).catch(() => false);
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

/**
 * Open a cell's dropdown and wait for its options to render.
 *
 * WHY it retries: a single click is not reliable here. The column before a
 * dropdown is often a pill cell, and committing a pill leaves its input focused —
 * the blur that follows re-renders that part of the row, and a click landing in
 * that window opens nothing. The symptom is a menu with zero options and an error
 * reading `Available: ` with nothing after it, which looks like a bad option value
 * rather than a menu that never opened.
 */
async function openCellMenu(page, td, name) {
  const options = page.locator(`${OPTION}:visible`);
  for (let attempt = 0; attempt < 3; attempt++) {
    // Close whatever is already open BEFORE clicking. The option locator is global,
    // so a menu left behind by the previous column still counts as "options are
    // visible" — the caller then searches that stale list and reports a perfectly
    // valid value as missing. That is exactly how "Flipkart" went missing from
    // Shipping provider on a column that had worked the run before.
    if (await options.count()) {
      await page.keyboard.press('Escape').catch(() => {});
      await settle(page, 400);
    }
    await td.scrollIntoViewIfNeeded().catch(() => {});
    await td.locator('button[class*=DropdownButton]').first().click().catch(() => {});
    await settle(page, 700);
    if (await options.count()) return true;
  }
  throw new Error(`Variant column "${name}" dropdown would not open after 3 attempts.`);
}

export async function setCellText(page, rowIdx, name, value, occurrence = 0) {
  if (value === undefined || value === null || value === '') return;
  const td = await cell(page, rowIdx, name, occurrence);
  const input = td.locator('input:not([type=hidden]), textarea').first();
  // Name the column in the failure. A bare Playwright timeout quoting an internal
  // data-fkv token says nothing about which of ~35 columns went wrong.
  await input.fill(String(value)).catch((err) => {
    throw new Error(
      `Could not type into variant column "${name}"${occurrence ? ` (#${occurrence + 1})` : ''} ` +
        `on row ${rowIdx}: ${String(err.message).split('\n')[0]}`,
    );
  });
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
  await openCellMenu(page, td, name);

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
  const seen = [];
  for (let i = 0; i < Math.min(count, 30); i++) {
    seen.push(((await visible.nth(i).innerText().catch(() => '')) || '').trim());
  }
  await page.keyboard.press('Escape').catch(() => {});
  throw new Error(
    `Variant option "${optionText}" not found for column "${name}". Available: ${seen.join(' / ')}`,
  );
}

/**
 * Multi-select columns — the matrix twin of form.js `pickMulti`.
 *
 * Material and Color on Hanging Organizers take several values each, and the menu
 * stays open between clicks, so every value is picked from one opening and the menu
 * is closed with Escape at the end. Passing an array to setCellPick instead
 * stringifies it to "Cloth,Fabric" and matches no option at all.
 */
export async function setCellPickMulti(page, rowIdx, name, values, occurrence = 0) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return;

  const td = await cell(page, rowIdx, name, occurrence);
  await openCellMenu(page, td, name);

  for (const value of list) {
    const want = value.toLowerCase();
    const visible = page.locator(`${OPTION}:visible`);
    const count = await visible.count();
    let hit = false;
    for (let i = 0; i < count; i++) {
      const el = visible.nth(i);
      const text = ((await el.innerText().catch(() => '')) || '').trim().toLowerCase();
      if (text === want) { await el.click(); await settle(page, 350); hit = true; break; }
    }
    if (!hit) {
      const seen = [];
      for (let i = 0; i < Math.min(count, 30); i++) {
        seen.push(((await visible.nth(i).innerText().catch(() => '')) || '').trim());
      }
      await page.keyboard.press('Escape').catch(() => {});
      throw new Error(
        `Variant option "${value}" not found for column "${name}". Available: ${seen.join(' / ')}`,
      );
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 300);
}

/** Multi-value columns use the same pill widget as the main form. */
export async function setCellPills(page, rowIdx, name, values, occurrence = 0) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return;
  // A dropdown menu left open by an earlier column floats over the row and
  // swallows the container click, so clear it before touching this cell.
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 250);

  const td = await cell(page, rowIdx, name, occurrence);
  const container = td.locator('.rti--container').first();

  // Pills carry their text in a `label` attribute, so committed values can be read
  // back exactly instead of counted. Counting is not enough: a retry that re-types
  // a value already present proves nothing about WHICH value is missing.
  const committed = async () =>
    new Set(
      await td
        .locator(PILL)
        .evaluateAll((els) =>
          els.map((e) => (e.getAttribute('label') || e.innerText || '').trim().toLowerCase()),
        )
        .catch(() => []),
    );

  const outstanding = async () => {
    const have = await committed();
    return list.filter((v) => !have.has(v.toLowerCase()));
  };

  // WHY one focused burst per pass instead of a click before every value: the
  // container click is itself the race. Committing a pill re-renders the widget, so
  // clicking again immediately lands mid-render and the keystrokes go nowhere — that
  // is how "Dusty Pink" vanished from the middle of three, and how Key Features kept
  // only its first of seven. Typing straight into the still-focused input avoids the
  // re-click entirely, and whatever slips through is picked up by the next pass.
  //
  // The widget's own helper text says Enter OR comma commits, so alternate: if Enter
  // is being swallowed on this render, comma usually is not.
  for (let pass = 0; pass < 4; pass++) {
    const todo = await outstanding();
    if (!todo.length) return;

    await container.click().catch(() => {});
    const input = td.locator('.rti--input').first();
    const ready = await input
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) {
      await settle(page, 700);
      continue;
    }

    try {
      await input.fill('');
      for (const value of todo) {
        await input.type(value, { delay: 12 });
        await input.press(pass % 2 === 0 ? 'Enter' : ',');
        await settle(page, 350);
      }
    } catch {
      // The input was torn out mid-burst. Whatever committed still counts; the
      // next pass re-reads the cell and retypes only what is genuinely missing.
    }
    await settle(page, 800);
  }

  const left = await outstanding();
  if (left.length) {
    const got = [...(await committed())];
    throw new Error(
      `Variant cell "${name}" (row ${rowIdx}) would not accept: ${left.join(' / ')}. ` +
        `Cell holds: ${got.join(' / ') || '(empty)'}`,
    );
  }
}

/**
 * Point the variant image strip at one variant.
 *
 * The Variant tab carries its own "Image addition" block with a side menu listing
 * every variant by its axis value (6 / 3 / 12 for Number of Holders). Clicking an
 * entry swaps the strip below it, and the strip then reuses the same
 * `#thumbnail_N` / `#upload-image` ids as the main Image tab — so the ordinary
 * uploader works once the right variant is selected.
 */
export async function selectVariantImageTarget(page, value) {
  const want = String(value).trim();
  const item = page
    .locator('[class*=SideMenuItem]')
    .filter({ has: page.locator(`[class*=SideMenuItemText]:text-is("${want}")`) })
    .first();
  const found = await item
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!found) {
    const seen = await page
      .locator('[class*=SideMenuItemText]')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `No variant image target "${want}". Side menu shows: ${seen.map((s) => s.trim()).join(' / ') || '(none)'}`,
    );
  }
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await item.click();
  await settle(page, 1200);
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
