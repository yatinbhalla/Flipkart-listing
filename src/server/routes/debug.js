import express from 'express';
import { getSession } from '../../browser/session.js';

const router = express.Router();

/**
 * GET /api/debug/page — report what the live Playwright page currently shows.
 *
 * Reuses the cached browser context, so it inspects the exact DOM a failing run
 * was looking at rather than a fresh load in a different browser. Selector bugs in
 * this app are almost always "the element I described is not the element on screen",
 * and guessing from screenshots is slower than asking the page.
 */
/** GET /api/debug/click?text=Show&all=1 — click element(s) whose text matches. */
router.get('/click', async (req, res) => {
  try {
    const { page } = await getSession(() => {});
    const label = String(req.query.text || '');
    const all = req.query.all === '1';
    const n = await page.evaluate(
      ({ label, all }) => {
        const hits = [...document.querySelectorAll('a,button,span,div')].filter((e) => {
          if (e.children.length) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === label;
        });
        const targets = all ? hits : hits.slice(0, 1);
        targets.forEach((t) => t.click());
        return targets.length;
      },
      { label, all },
    );
    await page.waitForTimeout(2500);
    res.json({ clicked: n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/variantrow?row=1 — what control type each matrix cell actually has.
 *
 * Half the columns that look like text boxes are dropdowns, and some render their
 * input only after a click. Knowing per-column which is which beats guessing.
 */
router.get('/variantrow', async (req, res) => {
  try {
    const { page } = await getSession(() => {});
    const rowIdx = Number(req.query.row || 1);
    const out = await page.evaluate((rowIdx) => {
      const table = document.querySelector('table');
      if (!table) return { error: 'no table on page' };
      const headers = [...table.querySelectorAll('th')].map((th) =>
        (th.innerText || '').replace(/\*/g, '').trim(),
      );
      const row = document.querySelectorAll('table tbody tr')[rowIdx];
      if (!row) return { error: `no row ${rowIdx}` };
      return {
        rows: document.querySelectorAll('table tbody tr').length,
        cells: [...row.children].map((td, i) => {
          const input = td.querySelector('input:not([type=hidden])');
          const area = td.querySelector('textarea');
          const drop = td.querySelector('button[class*=DropdownButton]');
          const rti = td.querySelector('.rti--container');
          const kind = rti ? 'pills' : drop ? 'dropdown' : area ? 'textarea' : input ? 'input' : 'none';
          return `${i}: ${headers[i] || '?'} -> ${kind}${input ? ` (val="${String(input.value).slice(0, 14)}")` : ''}`;
        }),
      };
    }, rowIdx);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/html?sel=<css>&max=<chars> — dump matching elements' markup.
 *
 * For working out real class names instead of guessing them, which is how the image
 * slot selectors ended up wrong.
 */
router.get('/html', async (req, res) => {
  try {
    const { page } = await getSession(() => {});
    if (req.query.goto) {
      await page.goto(String(req.query.goto), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(Number(req.query.wait || 8000));
    }
    const out = await page.evaluate(
      ({ sel, max }) =>
        [...document.querySelectorAll(sel)].slice(0, 6).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            id: el.id || null,
            cls: String(el.className || '').slice(0, 80),
            visible: r.width > 0 && r.height > 0,
            html: el.outerHTML.slice(0, max),
          };
        }),
      { sel: String(req.query.sel || 'body'), max: Number(req.query.max || 1200) },
    );
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/hittest — find a button by text and report what is actually at its
 * click point. `elementFromPoint` is the only reliable way to identify an
 * interceptor; guessing which overlay is on top wastes runs.
 */
router.get('/hittest', async (req, res) => {
  try {
    const { page } = await getSession(() => {});
    const label = String(req.query.text || 'Continue');
    const info = await page.evaluate((label) => {
      const describe = (el) => {
        if (!el) return null;
        const chain = [];
        for (let n = el; n && n !== document.body && chain.length < 6; n = n.parentElement) {
          const s = getComputedStyle(n);
          chain.push(`${n.tagName}.${String(n.className || '').slice(0, 35)} pos=${s.position} z=${s.zIndex}`);
        }
        return chain;
      };
      const buttons = [...document.querySelectorAll('button')].filter((b) =>
        (b.innerText || '').trim().toLowerCase().includes(label.toLowerCase()),
      );
      return buttons.slice(0, 4).map((b) => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const at = document.elementFromPoint(cx, cy);
        return {
          text: (b.innerText || '').trim(),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
          disabled: b.disabled,
          elementAtPoint: at ? `${at.tagName}.${String(at.className || '').slice(0, 40)}` : null,
          isSelf: at === b || b.contains(at),
          interceptorChain: at && !(at === b || b.contains(at)) ? describe(at) : null,
        };
      });
    }, label);
    res.json({ url: page.url(), buttons: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/debug/frames — what iframes exist, and what overlay/close controls each has. */
router.get('/frames', async (_req, res) => {
  try {
    const { page } = await getSession(() => {});
    const out = [];
    for (const frame of page.frames()) {
      const info = await frame
        .evaluate(() => {
          const vis = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 8 && r.height > 8;
          };
          return {
            text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            closers: [...document.querySelectorAll('button,span,div,a,svg,img')]
              .filter((e) => vis(e) && !e.children.length)
              .filter((e) => /^[×✕✖xX]$/.test((e.innerText || '').trim()) || /close/i.test(e.className + ' ' + (e.getAttribute('aria-label') || '')))
              .map((e) => `${e.tagName} "${(e.innerText || '').trim().slice(0, 12)}" cls=${String(e.className).slice(0, 40)} aria=${e.getAttribute('aria-label') || ''}`)
              .slice(0, 10),
          };
        })
        .catch((e) => ({ error: e.message }));
      out.push({ url: frame.url().slice(0, 90), name: frame.name(), ...info });
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/debug/shot — screenshot the live page to data/debug-shot.png. */
router.get('/shot', async (req, res) => {
  try {
    const { page } = await getSession(() => {});
    if (req.query.goto) {
      await page.goto(String(req.query.goto), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(Number(req.query.wait || 8000));
    }
    const file = 'data/debug-shot.png';
    await page.screenshot({ path: file, fullPage: false });
    res.json({
      file,
      url: page.url(),
      title: await page.title(),
      bodyChars: await page.evaluate(() => (document.body?.innerText || '').length),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/page', async (req, res) => {
  try {
    const { page } = await getSession(() => {});
    // ?goto=<url> loads a page first — needed after a server restart drops the
    // cached context and the fresh browser lands on the dashboard.
    if (req.query.goto) {
      await page.goto(String(req.query.goto), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(Number(req.query.wait || 6000));
    }
    const info = await page.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const text = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);

      return {
        url: location.href,
        heading: document.querySelector('h1,h2,h3')?.innerText?.trim() || null,
        buttons: [...document.querySelectorAll('button')]
          .filter(visible)
          .map((b) => `${text(b)} [${(b.className || '').toString().slice(0, 40)}]`)
          .slice(0, 25),
        inputs: [...document.querySelectorAll('input')]
          .filter(visible)
          .map((i) => `type=${i.type} ph="${i.placeholder || ''}" cls=${(i.className || '').slice(0, 30)}`)
          .slice(0, 15),
        // Anything whose whole text is a plausible vertical card label.
        cards: [...document.querySelectorAll('div,span,p,a')]
          .filter((e) => visible(e) && e.children.length === 0)
          .map(text)
          .filter((t) => t && t.length < 40)
          .slice(0, 60),
      };
    });
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
