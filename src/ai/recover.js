/**
 * AI-assisted recovery, in the spirit of the Meesho lister's navigator.
 *
 * Fires ONLY as a fallback, after the deterministic path has failed. Flipkart's
 * form is styled-components all the way down, so class names churn and widgets
 * behave differently per vertical; when a step that normally works cannot find its
 * control, asking a model to look at the page beats failing the whole listing.
 *
 * Never throws. Returns null on any problem so the caller reports its own, clearer
 * error instead of an AI one.
 */

import { callGeminiJSON } from './client.js';

const ATTR = 'data-fk-ai';
const MAX_ELEMENTS = 70;

/**
 * Ask Gemini which element on screen matches an intent, then click it.
 *
 * @param {object}   args
 * @param {import('playwright').Page} args.page
 * @param {string}   args.intent   what the executor was trying to do, in words
 * @param {string}   [args.near]   a label to anchor on, when the intent is field-specific
 * @param {string}   [args.scope]  CSS selector to search WITHIN — strongly preferred
 * @param {Function} args.log
 * @returns {Promise<boolean>} whether it clicked something
 */
export async function recoverClick({ page, intent, near, scope, log }) {
  try {
    const snapshot = await page.evaluate(
      ({ ATTR, MAX, scope }) => {
        document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));

        // Search inside the field being filled, not the whole page. Offered every
        // element on screen, a model asked to find "Search Keywords" picks the
        // Seller Hub HEADER SEARCH BOX — it matches on the word "search" and has no
        // way to know that box has nothing to do with the form.
        const root = (scope && document.querySelector(scope)) || document;

        const candidates = [
          'button',
          'input:not([type=hidden])',
          'textarea',
          '[role=button]',
          '[role=option]',
          '[role=tab]',
          '.rti--container',
          '[class*=DropdownButton]',
          '[class*=close]',
        ].join(', ');

        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const visible = [...root.querySelectorAll(candidates)].filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return false;
          if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
          const cs = getComputedStyle(el);
          return cs.visibility !== 'hidden' && cs.display !== 'none';
        });

        // Prefer the deepest match when a parent and child both qualify.
        const leaves = visible.filter((el) => !visible.some((o) => o !== el && el.contains(o)));

        return {
          url: location.href,
          list: leaves.slice(0, MAX).map((el, i) => {
            el.setAttribute(ATTR, String(i));
            return {
              index: i,
              tag: el.tagName.toLowerCase(),
              text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70),
              aria: el.getAttribute('aria-labelledby') || el.getAttribute('aria-label') || '',
              name: el.getAttribute('name') || '',
              cls: String(el.className || '').slice(0, 40),
            };
          }),
        };
      },
      { ATTR, MAX: MAX_ELEMENTS, scope },
    );

    if (!snapshot.list.length) return false;

    const lines = snapshot.list
      .map((e) => {
        const bits = [`[${e.index}]`, e.tag.toUpperCase()];
        if (e.text) bits.push(`text="${e.text}"`);
        if (e.aria) bits.push(`aria="${e.aria}"`);
        if (e.name) bits.push(`name="${e.name}"`);
        if (e.cls) bits.push(`class="${e.cls}"`);
        return bits.join(' ');
      })
      .join('\n');

    log(`🤖 Asking Gemini to recover: ${intent}`);
    const result = await callGeminiJSON(
      `A browser automation script is stuck on the Flipkart Seller Hub listing form.

WHAT IT IS TRYING TO DO
  ${intent}
  ${near ? `The field is labelled: "${near}"` : ''}

ELEMENTS ON SCREEN (numbered)
${lines}

Pick the ONE element to click to make progress. Respond with JSON only:
{ "index": N, "reason": "one short sentence" }
Return { "index": -1, "reason": "..." } if nothing listed would help.
The list above is already scoped to the field in question — do NOT assume a global
page search box or navigation control is relevant. Prefer the element whose aria or
name attribute matches the field being filled.`,
      { temperature: 0.2, log: () => {} },
    );

    const index = Number(result?.index);
    if (!Number.isInteger(index) || index < 0 || index >= snapshot.list.length) {
      log(`🤖 Gemini declined: ${result?.reason || 'no match'}`);
      await clearMarkers(page);
      return false;
    }

    log(`🤖 Gemini chose [${index}] — ${result.reason || ''}`);
    const target = page.locator(`[${ATTR}="${index}"]`).first();
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await target.click({ timeout: 8000 }).catch(() => {});
    await clearMarkers(page);
    return true;
  } catch (err) {
    log(`🤖 AI recovery failed: ${err.message}`);
    await clearMarkers(page).catch(() => {});
    return false;
  }
}

async function clearMarkers(page) {
  await page
    .evaluate((ATTR) => {
      document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
    }, ATTR)
    .catch(() => {});
}
