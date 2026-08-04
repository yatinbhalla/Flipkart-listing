import express from 'express';
import { broadcast } from '../index.js';
import { getSession } from '../../browser/session.js';
import * as F from '../../browser/form.js';
import * as L from '../../browser/listing.js';

const router = express.Router();

/**
 * POST /api/discover — open a fresh listing for a vertical and report its schema.
 *
 * "Recording" a path does not need a click recorder: the form already declares its
 * own fields. This walks the four attribute tabs and reports every field with its
 * mandatory flag and real control type, plus the option list for each mandatory
 * dropdown. That is everything needed to write a path config for a new vertical —
 * and knowing the control types up front prevents the recurring class of bug where
 * a dropdown is driven as a text box.
 *
 * Leaves a draft behind, which is harmless and can be deleted afterwards.
 *
 * Body: { vertical, brand, options?: boolean }
 */
router.post('/', async (req, res) => {
  const { vertical, brand, options = true } = req.body || {};
  if (!vertical || !brand) {
    return res.status(400).json({ error: 'vertical and brand are required' });
  }

  const log = (text) => broadcast({ type: 'info', text });
  try {
    const { page } = await getSession(log);
    await L.selectVertical(page, vertical, log);
    await L.selectBrand(page, brand, log);

    const tabs = {};
    for (const [key, tabName] of Object.entries(F.TABS)) {
      if (key === 'images' || key === 'variants') continue;
      await F.openTab(page, tabName);
      log(`Reading fields on "${tabName}"…`);
      const fields = await F.describeFields(page);

      if (options) {
        for (const field of fields) {
          if (field.type !== 'dropdown' || !field.mandatory) continue;
          field.options = await F.readOptions(page, field.label).catch(() => []);
        }
      }
      tabs[tabName] = fields;
    }

    const mandatory = Object.entries(tabs).flatMap(([tab, fields]) =>
      fields.filter((f) => f.mandatory).map((f) => ({ tab, ...f })),
    );

    broadcast({ type: 'success', text: `Discovered ${mandatory.length} mandatory fields for ${vertical}.` });
    res.json({ vertical, brand, tabs, mandatoryCount: mandatory.length, mandatory });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
