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

import { DROPDOWN, OPTION, PILL, clickEmptySpace, closeMenu, scrollSection } from './form.js';

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
  // Centre rather than minimal-scroll — see bringCellIntoView.
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {});
  return loc;
}

/**
 * Collapse Flipkart's "Variant Issues" sidebar.
 *
 * WHY this is not an overlay problem and dismissOverlays cannot help: the panel is
 * `position: static` with no z-index — it is a ~253px LAYOUT COLUMN pinned to the
 * right of the matrix, and the table's scroll wrapper runs underneath it. Measured
 * on a live draft (viewport 1366): the wrapper spans x=123..1366 with clientWidth
 * 1243, the sidebar covers x=1103..1356, and the matrix is 11127px wide. Scrolled
 * hard right (scrollLeft 9884, the maximum) the LAST column lands at x=1122..1310 —
 * entirely beneath the sidebar, and no scroll position can free it because there is
 * no scroll left to give. `elementFromPoint` on its dropdown returns
 * ProductErrorSidebarBody, so the click never reaches the button.
 *
 * That single fact explains both symptoms: "Gift Pack dropdown would not open"
 * (column 53 of 54), and pill cells near the right edge taking exactly one value —
 * clickEmptySpace finds no point whose topmost element is the widget, so it falls
 * back to a container click that lands on the sidebar instead.
 *
 * The sidebar shows up the moment a row has errors, which is the entire time a row
 * is being filled ("SKU ID cannot be empty" is there until the SKU goes in), so
 * this is the normal state during a run, not an edge case. Its header carries a
 * collapse toggle; clicking that hands the width back to the table.
 */
export async function collapseErrorSidebar(page) {
  const body = page.locator('[class*=ProductErrorSidebarBody]').first();
  if (!(await body.isVisible().catch(() => false))) return false; // absent or already collapsed
  const toggle = page.locator('[class*=ProductErrorToggleButton]').first();
  if (!(await toggle.count())) return false;
  await toggle.click({ timeout: 5000 }).catch(() => {});
  await settle(page, 600);
  return !(await body.isVisible().catch(() => false));
}

/**
 * Centre a cell in every scroller that holds it.
 *
 * `scrollIntoViewIfNeeded` does the MINIMUM scroll, which parks a far-right column
 * hard against the wrapper's right edge — the exact strip the error sidebar covers.
 * `scrollIntoView({block:'center', inline:'center'})` moves both the form's vertical
 * scroller and the table's horizontal one in one call, and centring leaves margin on
 * both sides instead of landing on the boundary.
 */
async function bringCellIntoView(td) {
  await td.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {});
}

/** Does this control's own centre point actually belong to it, or is something over it? */
async function pointIsClear(button) {
  return button
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(at && (at === el || el.contains(at)));
    })
    .catch(() => false);
}

/** What a cell actually holds — for failures where the control is not what we assumed. */
async function describeCell(td, dropdown) {
  return td
    .evaluate((el, sel) => {
      const kind = el.querySelector('.rti--container')
        ? 'pills'
        : el.querySelector(sel)
          ? 'dropdown'
          : el.querySelector('textarea')
            ? 'textarea'
            : el.querySelector('input:not([type=hidden])')
              ? 'input'
              : 'no control';
      return `${kind}, reading "${(el.innerText || '').trim().slice(0, 40)}"`;
    }, dropdown)
    .catch(() => '(unreadable)');
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
 *
 * WHY it polls for the options instead of sleeping, and why every failed attempt
 * closes the menu before the next one: this used to click, sleep 700ms, then count.
 * The matrix renders its option list asynchronously and slower than the main form
 * does — late in a ~35 column row it regularly needs longer than that — so the
 * count came back 0 on a menu that was in fact opening, and the next attempt
 * clicked the SAME button again, which toggles an open menu shut. Three attempts
 * alternating open/shut can never see an option, which is how Gift Pack failed with
 * "would not open" on a cell that opens perfectly by hand. form.js `openMenu`
 * already had the answer for the main form: wait for an option to become visible
 * rather than guessing how long the render takes.
 */
async function openCellMenu(page, td, name) {
  const options = page.locator(`${OPTION}:visible`);
  let why = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    // Close whatever is already open BEFORE clicking. The option locator is global,
    // so a menu left behind by the previous column still counts as "options are
    // visible" — the caller then searches that stale list and reports a perfectly
    // valid value as missing. That is exactly how "Flipkart" went missing from
    // Shipping provider on a column that had worked the run before.
    //
    // Escape on its own is not enough: it is not always wired up, which is why the
    // main form's closeMenu falls back to clicking a neutral spot. Reuse it here.
    if (await options.count()) await closeMenu(page);

    // The Variant Issues sidebar covers the right-hand columns outright, and it is
    // open for most of a fill. Collapse it before deciding a cell cannot be clicked.
    await collapseErrorSidebar(page);
    await bringCellIntoView(td);

    // An absent button is not proof the column is not a dropdown — some matrix
    // cells render their control only once the cell itself has been clicked.
    let button = td.locator(DROPDOWN).first();
    if (!(await button.count())) {
      await td.click({ timeout: 5000 }).catch(() => {});
      await settle(page, 400);
      button = td.locator(DROPDOWN).first();
    }

    if (await button.count()) {
      // A real mouse click goes to whatever sits on top of the point, so check the
      // point first. When it is covered, activate from the keyboard instead: focus
      // plus Enter produces a trusted click on a <button> with no hit testing at
      // all, which is the one route an occluding element cannot block. (A
      // programmatic element.click() is NOT a substitute — Flipkart's React
      // buttons ignore it.)
      if (await pointIsClear(button)) {
        // Bounded: on the default 30s timeout an unreachable cell becomes a 90s
        // silent hang across three attempts, with the reason swallowed too.
        await button.click({ timeout: 5000 }).catch((err) => {
          why = String(err.message).split('\n')[0];
        });
      } else {
        why = 'click point is covered by another element — activated from the keyboard';
        await button.focus().catch(() => {});
        await button.press('Enter').catch(() => {
          why = 'click point is covered, and keyboard activation failed too';
        });
      }
      const appeared = await options
        .first()
        .waitFor({ state: 'visible', timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) return true;
      if (!why) why = 'clicked, but no options rendered within 6s';
    } else {
      why = 'the cell has no dropdown button, even after clicking the cell';
    }

    // Nothing usable came up. Close deliberately so the next attempt starts from a
    // known-shut menu instead of toggling a slow one back down.
    await closeMenu(page);
  }
  throw new Error(
    `Variant column "${name}" dropdown would not open after 3 attempts ` +
      `(${why || 'no options rendered'}). Cell holds: ${await describeCell(td, DROPDOWN)}.`,
  );
}

export async function setCellText(page, rowIdx, name, value, occurrence = 0) {
  if (value === undefined || value === null || value === '') return;
  const want = String(value);

  // Three tries, because the matrix is documented to swallow a value it has just
  // accepted: Procurement SLA, Stock and the package L/B/H/Weight have all come back
  // EMPTY after a fill. Read the cell back rather than trusting the write.
  for (let attempt = 0; attempt < 3; attempt++) {
    const td = await cell(page, rowIdx, name, occurrence);
    const input = td.locator('input:not([type=hidden]), textarea').first();
    // Name the column in the failure. A bare Playwright timeout quoting an internal
    // data-fkv token says nothing about which of ~54 columns went wrong.
    await input.fill(want).catch((err) => {
      throw new Error(
        `Could not type into variant column "${name}"${occurrence ? ` (#${occurrence + 1})` : ''} ` +
          `on row ${rowIdx}: ${String(err.message).split('\n')[0]}`,
      );
    });
    await settle(page, 300);

    // ONLY an empty read-back is retried. An earlier version also retried anything
    // that looked truncated, on the strength of a Seller SKU ID that seemed to lose
    // its "/28762" — which turned out to be the /api/debug/variantrow route previewing
    // values with slice(0, 14), not a defect at all. Treating a short read as
    // truncation would fail any cell Flipkart legitimately caps, the long Description
    // first, and would loop on any widget that reformats what it is given.
    const got = (await input.inputValue().catch(() => want)) || '';
    if (got !== '') return;
    if (attempt === 2) {
      throw new Error(
        `Variant column "${name}" came back empty on row ${rowIdx} after three tries ` +
          `(typed "${want}").`,
      );
    }
  }
}

export async function readCellText(page, rowIdx, name, occurrence = 0) {
  const td = await cell(page, rowIdx, name, occurrence);
  const input = td.locator('input:not([type=hidden]), textarea').first();
  if (!(await input.count())) return '';
  return (await input.inputValue().catch(() => '')) || '';
}

/**
 * Every visible option label, in ONE round trip.
 *
 * WHY not `visible.nth(i).innerText()` in a loop: that is one protocol call per
 * option and the locator is GLOBAL, so it sees every rendered menu on the page.
 * Country Of Origin carries 248 entries — a single miss meant hundreds of round
 * trips, and a run went silent on that one cell for 22 minutes.
 */
async function optionLabels(page) {
  return page
    .locator(`${OPTION}:visible`)
    .evaluateAll((els) => els.map((e) => (e.innerText || '').trim()))
    .catch(() => []);
}

/**
 * Index of the wanted option, narrowing a long list through its search box first.
 *
 * Long lists render a search box and only a SLICE of their options, so scanning
 * whatever happens to be rendered can miss a perfectly valid value — Country Of
 * Origin is the case. form.js `pick` has typed into that box all along; the matrix
 * twin never learned to, which is why "India" was unreachable here and fine there.
 */
async function findOption(page, want, raw) {
  let labels = await optionLabels(page);
  let idx = labels.findIndex((t) => t.toLowerCase() === want);
  if (idx !== -1) return idx;

  const search = page.locator('input[placeholder="Select"]:visible').first();
  if (await search.count()) {
    await search.fill(String(raw));
    await settle(page, 700);
    labels = await optionLabels(page);
    idx = labels.findIndex((t) => t.toLowerCase() === want);
  }
  return idx;
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

  const idx = await findOption(page, String(optionText).trim().toLowerCase(), optionText);
  if (idx !== -1) {
    await page.locator(`${OPTION}:visible`).nth(idx).click();
    await settle(page, 500);
    return;
  }
  const labels = await optionLabels(page);
  await page.keyboard.press('Escape').catch(() => {});
  throw new Error(
    `Variant option "${optionText}" not found for column "${name}". ` +
      `Available: ${labels.slice(0, 30).join(' / ')}`,
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
    const idx = await findOption(page, value.toLowerCase(), value);
    if (idx === -1) {
      const labels = await optionLabels(page);
      await page.keyboard.press('Escape').catch(() => {});
      throw new Error(
        `Variant option "${value}" not found for column "${name}". ` +
          `Available: ${labels.slice(0, 30).join(' / ')}`,
      );
    }
    await page.locator(`${OPTION}:visible`).nth(idx).click();
    await settle(page, 350);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 300);
}

/** Multi-value columns use the same pill widget as the main form. */
/**
 * Drop a pill that is a strict prefix of the value we are about to enter.
 *
 * Only ever removes a genuine stump — a pill equal to the value is left alone, and
 * so is any pill that is not a prefix of it.
 */
async function removePartialPill(page, td, value) {
  const want = String(value).trim().toLowerCase();
  const pills = td.locator(PILL);
  const n = await pills.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const pill = pills.nth(i);
    const label = (
      (await pill.getAttribute('label').catch(() => null)) ||
      (await pill.innerText().catch(() => '')) ||
      ''
    ).trim().toLowerCase();
    if (!label || label === want) continue;
    if (!want.startsWith(label)) continue;
    await pill.locator('[data-testid=suffix-icon]').first().click().catch(() => {});
    await settle(page, 300);
    return true;
  }
  return false;
}

export async function setCellPills(page, rowIdx, name, values, occurrence = 0) {
  const list = (Array.isArray(values) ? values : [values]).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return;
  // A dropdown menu left open by an earlier column floats over the row and
  // swallows the container click, so clear it before touching this cell.
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 250);
  // Same reason as openCellMenu: with the sidebar open, clickEmptySpace can find
  // no point inside a right-hand cell whose topmost element is the widget, so it
  // falls back to a container click that lands on the sidebar and the input never
  // appears.
  await collapseErrorSidebar(page);

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

  /**
   * Bring the widget's text input back, and hand it over.
   *
   * WHY it cannot just click the container: committing a pill REMOVES the input
   * from the DOM, and `container.click()` targets the container's centre — which,
   * the moment the cell holds even one chip, is the chip. Clicking a chip selects
   * or removes it and never reveals the input, so exactly one value ever went in
   * and every later value was reported as refused. That is precisely what Key
   * Features and Care Instructions did: "Cell holds: fits 6 seater tables" with the
   * remaining seven rejected.
   *
   * form.js `setPills` already solved this for the main form with `clickEmptySpace`,
   * which computes a point inside the widget that no chip covers. Same widget, same
   * fix — reuse it rather than keeping a second, weaker copy here.
   */
  const revealInput = async () => {
    const input = td.locator('.rti--input').first();
    if (await input.isVisible().catch(() => false)) return input;
    for (let attempt = 0; attempt < 2; attempt++) {
      await container.scrollIntoViewIfNeeded().catch(() => {});
      await clickEmptySpace(page, container);
      const ok = await input
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (ok) return input;
    }
    return null;
  };

  // WHY the input is re-checked before EVERY value rather than once per pass: the
  // matrix widget drops its input after each commit, so a burst typed into one
  // locator lands only its first value and the rest throw into the void. The pass
  // loop then had to supply one value per pass, and a seven-value Key Features
  // cell can never finish in four passes. Reveal per value, and the passes are
  // left to do what they are actually for — retrying truncated stumps and
  // alternating the commit key.
  //
  // The widget's own helper text says Enter OR comma commits, so alternate: if Enter
  // is being swallowed on this render, comma usually is not.
  // A wall-clock budget. Four passes over ten values, each burning reveal timeouts,
  // is ~17 minutes of grinding with nothing logged — which is indistinguishable from
  // a hang, and is exactly how a stalled cell looked from outside. Give up loudly.
  const deadline = Date.now() + 60000;
  for (let pass = 0; pass < 4 && Date.now() < deadline; pass++) {
    const todo = await outstanding();
    if (!todo.length) return;

    for (const value of todo) {
      if (Date.now() > deadline) break;
      // A previous pass can leave a TRUNCATED pill behind: typing character by
      // character gave the widget time to re-render mid-word, committing only the
      // prefix. "Lightweight Breathable Muslin Cotton" landed as "Lightweight
      // Breathable Mu" and then never matched, so the retries could not converge
      // and the cell failed with the value apparently both present and missing.
      // Clear the stump BEFORE reaching for the input — removing a pill re-renders
      // the widget and would invalidate an input fetched first.
      await removePartialPill(page, td, value);

      const input = await revealInput();
      // Give up on this pass rather than this cell: the next pass re-reads what
      // actually committed and retries only what is genuinely missing.
      if (!input) break;

      try {
        // fill() sets the whole string in one operation. type() spread 36 characters
        // over ~430ms, which is the window the re-render truncated.
        await input.fill(value);
        await input.press(pass % 2 === 0 ? 'Enter' : ',');
        await settle(page, 350);
      } catch {
        // The input was torn out mid-write. Whatever committed still counts.
        break;
      }
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
/**
 * Which axes this vertical lets you vary on, read off the Variant tab.
 *
 * Each axis renders an "Enter New <Axis>" box or a dropdown beside its label, so
 * the placeholders are the reliable tell. Blanket additionally gates this whole
 * tab behind "Fix errors first", so an empty draft shows nothing — which is why
 * this is reported at run time rather than by the discovery route.
 */
export async function readVariantAxes(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('input[placeholder^="Enter New"]')]
      .map((el) => (el.placeholder || '').replace(/^Enter New\s*/i, '').trim())
      .filter(Boolean),
  );
}

export async function addVariant(page, axis, value) {
  await scrollSection(page, 0);
  const rowLabel = page.locator('text=' + axis).first();
  await rowLabel.scrollIntoViewIfNeeded().catch(() => {});

  const container = page.locator('div').filter({ hasText: new RegExp(`^${axis}$`) }).last();
  const box = container.locator('xpath=..');

  const dropdown = box.locator('button[class*=DropdownButton], [class*=Dropdown]').first();
  const textBox = box.locator(`input[placeholder*="Enter New"]`).first();

  if (await textBox.count()) {
    // A free-text axis can be COMPOSITE. Blanket's Brand Color builds one axis
    // value out of several colours: type the first, press "+" to commit it and
    // reveal the next box, type the next, then Create — the result reads
    // "White & Brown". Filling a single box and pressing Create, which is all this
    // did before, can only ever produce a one-colour variant, so every multi-colour
    // print silently came out wrong or refused to create at all.
    //
    // Verified by hand on draft BM_W_BL_TD_SET/25985: White, "+", Brown, Create.
    const parts = Array.isArray(value) ? value.map(String) : String(value).split(' & ');
    for (let i = 0; i < parts.length; i++) {
      const boxes = box.locator('input[placeholder*="Enter New"]');
      await boxes.nth(i).fill(parts[i].trim());
      await settle(page, 300);
      if (i < parts.length - 1) {
        // The "+" sits between the filled box and Create. Take the button directly
        // after this input rather than the first button in the row, which is Create
        // once at least one value is present.
        await box.locator('button:not(:has-text("Create"))').nth(i).click();
        await settle(page, 600);
      }
    }
  } else if (await dropdown.count()) {
    await dropdown.click();
    await settle(page, 600);
    const opt = page.locator(`${OPTION}:visible`).filter({ hasText: new RegExp(`^\\s*${value}\\s*$`, 'i') }).first();
    await opt.click();
  } else {
    // Name the axes this vertical actually offers. Verticals do not share them —
    // Table Cover has Color / Pack of / Seating Capacity, Hanging Organizers has
    // only Number of Holders — and `describeFields` never sees this tab, so a bare
    // "not found" left the real list discoverable only by another run.
    throw new Error(
      `Could not find the "${axis}" variant input. ` +
        `This vertical offers: ${(await readVariantAxes(page)).join(' / ') || '(none visible)'}`,
    );
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
