/**
 * Low-level primitives for the Flipkart Seller Hub "Add a Single Listing" form.
 *
 * Every function here encodes a behaviour that was verified by hand-driving a real
 * listing (SKU TC_BT/1.1, vertical Table Cover) on 2026-07-30. The comments marked
 * WHY explain traps that silently corrupt data if you do the obvious thing instead.
 */

// The form's own scroll container. NOT document.body — body.scrollHeight is 0 on
// this page, so window.scrollTo() does nothing and elements never come into view.
const SECTION = 'section[class*=ContentSection]';
const PANEL = '[class*=InfoWrapper]';
const LABEL = '[class*=AttributeItemLabelName]';
const NAME_WRAP = '[class*=EditAttributeNameWrapper]';
const DROPDOWN = 'button[class*=DropdownButton]';
const OPTION = '[class*="LabelText-sc-n7qfg8"]';
const PILL = '[class*=SmallPillContainer]';

const settle = (page, ms = 400) => page.waitForTimeout(ms);

/**
 * Tag the DOM node for a labelled field row with a unique attribute, then hand back
 * a Playwright locator for it.
 *
 * WHY mark-then-locate: field rows have no stable id or test hook, and their
 * position shifts as you fill the form (multi-value fields drop their <input> once
 * they hold a value; whole fields appear and disappear based on other answers —
 * the handling-fee fields vanish when Shipping provider = Flipkart, Importer
 * Details vanishes when Country of Origin = India). Addressing by index is
 * therefore guaranteed to drift. We find the row by its visible label inside the
 * page, stamp it, and then drive it with real Playwright events.
 */
async function rowFor(page, label, occurrence = 0) {
  const token = 'fkq' + Math.random().toString(36).slice(2, 10);
  const found = await page.evaluate(
    ({ label, token, occurrence, LABEL, NAME_WRAP, PANEL }) => {
      const panel = document.querySelector(PANEL);
      if (!panel) return false;
      const want = label.trim().toLowerCase();
      let seen = 0;
      for (const el of panel.querySelectorAll(LABEL)) {
        // Labels carry a trailing "*" for mandatory fields — ignore it when matching.
        const text = (el.innerText || '').replace(/\*/g, '').trim().toLowerCase();
        if (text !== want) continue;
        const wrap = el.closest(NAME_WRAP);
        const row = wrap?.parentElement;
        if (!row) continue;
        // "Color" appears twice on the Product Description tab: a free-text pill
        // field and a dropdown refiner. Callers disambiguate with `occurrence`.
        if (seen++ !== occurrence) continue;
        row.setAttribute('data-fkq', token);
        return true;
      }
      return false;
    },
    { label, token, occurrence, LABEL, NAME_WRAP, PANEL },
  );
  if (!found) throw new Error(`Field not found on this tab: "${label}"${occurrence ? ` (occurrence ${occurrence})` : ''}`);

  const row = page.locator(`[data-fkq="${token}"]`);
  await row.scrollIntoViewIfNeeded().catch(() => {});
  return row;
}

/** Is a labelled field present on the current tab? Used for conditional fields. */
export async function hasField(page, label) {
  try { await rowFor(page, label); return true; } catch { return false; }
}

/**
 * Fill a plain text / number field.
 *
 * WHY one at a time with a settle: the package group (Length / Breadth / Height /
 * Weight) shares a single React state object. Writing all four in one synchronous
 * pass makes each write clobber the previous — you end up with only the last value.
 * Filling sequentially and letting React commit between writes is the fix.
 */
export async function setText(page, label, value, occurrence = 0) {
  if (value === undefined || value === null || value === '') return;
  const row = await rowFor(page, label, occurrence);
  const input = row.locator('input:not([type=hidden]), textarea').first();
  await input.fill(String(value));
  await settle(page, 350);
}

/** Read a field's current value back — used to verify a save actually stuck. */
export async function readText(page, label, occurrence = 0) {
  const row = await rowFor(page, label, occurrence);
  const input = row.locator('input:not([type=hidden]), textarea').first();
  if (!(await input.count())) return '';
  return (await input.inputValue().catch(() => '')) || '';
}

/**
 * Choose an option from one of the custom dropdowns.
 *
 * WHY not just write to the inner input: several cells that look like plain text
 * inputs are actually dropdowns (Listing Status, Fullfilment by, Procurement type,
 * Shipping provider, Country Of Origin, Tax Code, MinOQ, Color, Reversible,
 * Wrinkle Free, Gift Pack). Setting their input's value appears to work but the
 * cell still reads "Select" and the value is never submitted.
 *
 * Display labels are not the enum values — procurement type shows instock/express,
 * shipping provider shows "Flipkart", seating shows "4 Seater". Matching is
 * case-insensitive so callers can pass either casing.
 */
export async function pick(page, label, optionText, occurrence = 0) {
  if (!optionText) return;
  const row = await rowFor(page, label, occurrence);
  const button = row.locator(DROPDOWN).first();
  await button.click();
  await settle(page, 600);

  const want = String(optionText).trim().toLowerCase();
  const option = page.locator(OPTION).filter({ hasText: new RegExp(`^\\s*${escapeRe(optionText)}\\s*$`, 'i') }).first();

  if (!(await option.count())) {
    // Long lists (Country Of Origin has 248 entries) render a search box first.
    const search = page.locator('input[placeholder="Select"]:visible').first();
    if (await search.count()) {
      await search.fill(String(optionText));
      await settle(page, 600);
    }
  }

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
  throw new Error(`Option "${optionText}" not found for "${label}". Available: ${seen.join(' / ')}`);
}

/**
 * Fill a multi-value (pill / chip) field.
 *
 * These are react-tag-input-component widgets. Three rules, all learned the hard way:
 *
 *  1. Each value is committed with a real Enter keypress.
 *  2. After the first value the <input> is removed from the DOM — you have to click
 *     the container again to bring it back before typing the next value.
 *  3. NEVER dispatch change or blur on these. Doing so commits whatever raw text is
 *     sitting in the box as one giant pill. That is how a 1700-character description
 *     once ended up inside Search Keywords as a single keyword.
 */
export async function setPills(page, label, values, occurrence = 0) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return;

  const row = await rowFor(page, label, occurrence);
  const container = row.locator('.rti--container').first();

  for (const value of list) {
    await container.click();
    const input = row.locator('.rti--input').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.type(value, { delay: 8 });
    await input.press('Enter');
    await settle(page, 250);
  }
}

/** How many pills a multi-value field currently holds. */
export async function countPills(page, label, occurrence = 0) {
  const row = await rowFor(page, label, occurrence);
  return row.locator(PILL).count();
}

/**
 * Choose one or more options from a multi-select dropdown (Material, Pattern, and
 * the Color refiner). These stay open after each click and the button then reads
 * "N Selected" rather than the value, so we close with Escape when done.
 */
export async function pickMulti(page, label, values, occurrence = 0) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return;

  const row = await rowFor(page, label, occurrence);
  await row.locator(DROPDOWN).first().click();
  await settle(page, 600);

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
      await page.keyboard.press('Escape').catch(() => {});
      throw new Error(`Option "${value}" not found for "${label}"`);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 300);
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

export const TABS = {
  images: 'Image addition',
  price: 'Price, Stock and Shipping',
  description: 'Product Description',
  additional: 'Additional Description',
  variants: 'Variant addition',
};

/**
 * Switch tabs — which is also how you SAVE.
 *
 * WHY: there is no save button on the tabs. Leaving a tab POSTs it, and only then
 * does its "(filled/total)" counter and error badge refresh. Read those counters
 * before the switch and they are stale. Every save in this app is therefore a tab
 * switch followed by a re-read.
 */
export async function openTab(page, tabName) {
  const tab = page.locator('[role=tab]').filter({ hasText: tabName }).first();
  await tab.click();
  await page.waitForTimeout(2500);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

/**
 * Save the current tab by bouncing to another tab and back, then report the tab's
 * post-save state: how many fields are filled and whether it still has errors.
 */
export async function saveAndInspect(page, tabName, viaTab = TABS.images) {
  const bounce = tabName.startsWith(viaTab) ? TABS.price : viaTab;
  await openTab(page, bounce);
  await openTab(page, tabName);
  return readTabStates(page);
}

/** Parse every tab's "(filled/total)" counter and error badge in one shot. */
export async function readTabStates(page) {
  return page.evaluate(() => {
    const out = {};
    for (const tab of document.querySelectorAll('[role=tab]')) {
      const raw = (tab.innerText || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const name = raw.split('(')[0].trim();
      const counter = raw.match(/\((\d+)\/(\d+)\)/);
      const errors = raw.match(/(\d+)\s*Errors?/i);
      out[name] = {
        filled: counter ? Number(counter[1]) : null,
        total: counter ? Number(counter[2]) : null,
        errors: errors ? Number(errors[1]) : 0,
      };
    }
    return out;
  });
}

/** Every inline validation message currently rendered on this tab. */
export async function readErrors(page) {
  return page.evaluate(
    (PANEL) => {
      const panel = document.querySelector(PANEL);
      if (!panel) return [];
      const seen = new Set();
      for (const el of panel.querySelectorAll('*')) {
        if (el.children.length) continue;
        const t = (el.innerText || '').trim();
        if (/mandatory|cannot be|is missing|not present|invalid|required/i.test(t)) seen.add(t);
      }
      return [...seen];
    },
    PANEL,
  );
}

// ─── Images ────────────────────────────────────────────────────────────────────

export const IMAGE_SLOTS = ['Front View', 'Close Up Shot', 'Edge View', 'Flip Side', 'Package View'];

/**
 * Upload one image into slot `index` (0-based).
 *
 * WHY strictly sequential: all five slots share a single `#upload-image` file
 * input. You click a slot to make it the active target, then set the input. Slot
 * N+1 cannot be started until slot N's POST /napi/scf/uploadImage has finished —
 * otherwise the second file lands in the wrong slot or is dropped.
 */
export async function uploadImage(page, index, filePath) {
  const slot = page.locator('[class*=ImageCardWrapper], [class*=ThumbnailWrapper]').nth(index);
  if (await slot.count()) {
    await slot.click().catch(() => {});
    await settle(page, 500);
  }

  const input = page.locator('#upload-image');
  await input.waitFor({ state: 'attached', timeout: 10000 });

  // Wait for this specific slot's upload to come back before returning.
  const done = page
    .waitForResponse((r) => r.url().includes('/napi/scf/uploadImage'), { timeout: 90000 })
    .catch(() => null);
  await input.setInputFiles(filePath);
  await done;
  await page.waitForTimeout(1500);
}

/** Count how many image slots show the green "uploaded" tick. */
export async function countUploadedImages(page) {
  return page.evaluate(() => document.querySelectorAll('[class*=SuccessTick], [class*=CheckIcon]').length);
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

/** Scroll the form's own container (not the window — see SECTION above). */
export async function scrollSection(page, top) {
  await page.evaluate(
    ({ SECTION, top }) => {
      const s = document.querySelector(SECTION);
      if (s) s.scrollTop = top === 'bottom' ? s.scrollHeight : top;
    },
    { SECTION, top },
  );
  await settle(page, 600);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { SECTION, PANEL, DROPDOWN, OPTION, PILL, rowFor };
