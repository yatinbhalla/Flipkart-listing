import React, { useEffect, useState } from 'react';
// One definition, shared with the run route — a client-side copy of either of these
// silently drifted once already and cost a run.
import { MAX_BATCH, variantNeedsImage } from '../../server/constants.js';
import { shopsyBlocker } from '../../server/partners.js';
import { PRICE_JITTER_BELOW, PRICE_JITTER_ABOVE } from '../../server/price.js';

/**
 * Deliberately permissive. A MIME-only accept list hides files the app can actually
 * use: Windows reports no MIME for some camera and chat-app images, and .jfif/.heic
 * are missing from it entirely, so the picker greys out a perfectly good photo. The
 * server sniffs the real format and converts to PNG, so let anything image-shaped
 * through and let it decide.
 */
const IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.jpe,.jfif,.png,.webp,.avif,.tif,.tiff,.heic,.heif,.bmp';

export default function RunPanel({ path, running, progress, onStarted }) {
  const [uploaded, setFronts] = useState([]);      // [{ path, name, width, height, upscaled }]
  const [variantImages, setVariantImages] = useState({});
  const [preview, setPreview] = useState(null);
  const [sendToQc, setSendToQc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState([]);
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeat, setRepeat] = useState(2);
  // Which storefront this run lists on. Flipkart and Shopsy are separate
  // catalogues, so the same path is run once for each.
  // An ordered list, not one choice: a set of images is usually listed on more than
  // one storefront, and the order is the order they were picked in.
  const [partner, setPartner] = useState(['flipkart']);
  const [stopping, setStopping] = useState(false);

  // Front images are either uploaded (as they always were) or generated from one of
  // the path's own photos. Everything downstream takes a list of file paths, so the
  // two modes meet at `fronts` and nothing else has to know which was used.
  const [mode, setMode] = useState('upload');
  // Keyed by variant, because a variation path lists several products at once and
  // every one of them needs its own front images — its own colour, its own pack.
  // This was a flat list, which is why generating on a variation path produced four
  // batches of the first colour and nothing for the rest.
  const [generated, setGenerated] = useState({});   // { [variantKey]: [image] }
  const [genCount, setGenCount] = useState(5);
  // Which saved slots the model is shown. Slot 3 first because on these paths it is
  // the close product photograph, while slot 2 is usually the marketing infographic
  // — handing that over is what made generated images look drawn from the words.
  const [refSlots, setRefSlots] = useState(['img3']);
  // Ticked images, keyed by file path rather than position: the grid grows at the
  // front when more are generated, and an index-keyed tick would follow the slot
  // instead of the picture.
  const [approved, setApproved] = useState({});     // { [variantKey]: { [file]: true } }
  const [genFor, setGenFor] = useState('');         // which variant is generating now
  const [genBusy, setGenBusy] = useState(false);

  // Clear it when the run ends, or the next run opens with the Stop button already
  // greyed out and reading "Stopping…".
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  // Meesho lists every variant as its own product, and every product needs its own
  // front — even a Seating Capacity variant that shares the parent's on Flipkart.
  const imageVariants = partner.includes('meesho')
    ? path.variants.slice(1)
    : path.variants.filter(variantNeedsImage);
  // A per-listing photo can't vary across a batch, so those paths list one at a time.
  const batchAllowed = imageVariants.length === 0;

  // Variants of one product type read almost the same by name, so each image picker
  // is labelled with its SKU code too (AP_BLMF from AP_BLMF/{X}) — the code is what
  // the seller matches photos by.
  const skuCode = (v) => (v.skuPattern || path.skuPattern || '').replace(/\/?\{X\}$/, '');
  const copyReady = path.variants.every((v) => v.copy);

  // Everything that needs its own front images: the main listing, plus every variant
  // that does not reuse the parent's photo.
  const parentRow = path.variants[0];
  const genTargets = [parentRow, ...imageVariants];

  // Switching path or mode must not carry another path's pictures across.
  useEffect(() => {
    setGenerated({});
    setApproved({});
  }, [path.id, mode]);

  // Seed each grid with what has already been made for that SKU. Generated images
  // are kept per SKU code precisely so a later batch can reuse them instead of
  // paying to draw the same product again; putting them in the same grid means they
  // carry the same tick box and no second concept is needed.
  useEffect(() => {
    if (mode !== 'generate') return undefined;
    let cancelled = false;
    (async () => {
      for (const target of genTargets) {
        const sku = skuCode(target);
        if (!sku) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`/api/images/library/${encodeURIComponent(sku)}`).catch(() => null);
        if (!res?.ok || cancelled) continue;
        // eslint-disable-next-line no-await-in-loop
        const data = await res.json().catch(() => ({}));
        // Only if nothing is there yet — a batch generated in the meantime wins.
        setGenerated((g) => (g[target.key] ? g : { ...g, [target.key]: data.images || [] }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.id, mode, partner.join('|')]);

  const tick = (key, files, on) =>
    setApproved((a) => ({
      ...a,
      [key]: { ...(a[key] || {}), ...Object.fromEntries(files.map((f) => [f, on])) },
    }));

  async function generate(target) {
    setGenBusy(true);
    setGenFor(target.key);
    setError('');
    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathId: path.id,
          variantKey: target.key,
          count: genCount,
          referenceSlots: refSlots,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate images.');
      const made = data.images || [];
      // Newest first, and added to what is already there rather than replacing it:
      // pressing Generate twice should give more to choose from, not start over.
      setGenerated((g) => ({ ...g, [target.key]: [...made, ...(g[target.key] || [])] }));
      // Pre-tick the ones that passed; the seller unticks rather than ticks fifty.
      // Saved images stay unticked — they are offered, not chosen.
      tick(target.key, made.filter((im) => im.ok && im.file).map((im) => im.file), true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenFor('');
      setGenBusy(false);
    }
  }

  /** Every target in turn, so one press fills a whole variation path. */
  async function generateAll() {
    for (const target of genTargets) {
      // eslint-disable-next-line no-await-in-loop
      await generate(target);
    }
  }

  async function regenerate(target, position) {
    setGenBusy(true);
    setGenFor(target.key);
    try {
      const list = generated[target.key] || [];
      const res = await fetch('/api/images/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathId: path.id,
          variantKey: target.key,
          index: position,
          referenceSlots: refSlots,
          others: list.filter((_, n) => n !== position).map((im) => im.file).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not regenerate.');
      const old = list[position];
      setGenerated((g) => ({
        ...g,
        [target.key]: (g[target.key] || []).map((im, n) => (n === position ? data.image : im)),
      }));
      if (old?.file) tick(target.key, [old.file], false);
      if (data.image.file) tick(target.key, [data.image.file], Boolean(data.image.ok));
    } catch (err) {
      setError(err.message);
    } finally {
      setGenFor('');
      setGenBusy(false);
    }
  }

  // The ticked images for one target, in the same shape the upload route returns, so
  // the run call below cannot tell which mode produced them.
  const approvedOf = (key) =>
    (generated[key] || [])
      .filter((im) => im.file && approved[key]?.[im.file])
      .map((im) => ({ path: im.file, name: im.name, width: im.width, height: im.height }));

  // The two lists the rest of this component works from. Both modes produce
  // `{ path, name }`, which is what /api/run wants, so nothing below here changes.
  const fronts = mode === 'generate' ? approvedOf(parentRow.key) : uploaded;
  const frontsFor = (key) => (mode === 'generate' ? approvedOf(key) : variantImages[key] || []);

  // Flipkart, unlike Meesho, accepts any number of listings carrying the same photo,
  // so a selection can be repeated to produce several listings per image.
  const cycles = repeatOn ? Math.min(Math.max(Number(repeat) || 1, 1), 99) : 1;
  const totalListings = fronts.length * cycles;

  // The same answer the run route gives, asked before the button rather than after:
  // a path whose vertical Shopsy has no rules for gets as far as uploading its
  // images before failing, so saying so here saves a part-built draft.
  const shopsyRefusal = path ? shopsyBlocker(path) : null;

  // Every variant must ship the same number of photos, or the product page shows a
  // different count per pack size. Counted here so it is visible before the run
  // rather than surfacing as a server error after pressing the button.
  const photoCounts = imageVariants.length
    ? path.variants.map((v) => ({
        key: v.key,
        label: v.label || v.key,
        parent: v === path.variants[0],
        n: 1 + (path._variantImages?.[v.key]?.reused ?? path._sharedImageSlots.length),
        own: path._variantImages?.[v.key]?.own ?? 0,
      }))
    : [];
  const countsMatch = new Set(photoCounts.map((c) => c.n)).size <= 1;

  // A variant path batches in step: listing i takes the i-th photo from the parent
  // and from every variant, so all selections must be the same length.
  const variantCounts = imageVariants.map((v) => frontsFor(v.key).length);
  const evenSelections =
    imageVariants.length === 0 || variantCounts.every((n) => n === fronts.length);

  const ready =
    fronts.length > 0 &&
    copyReady &&
    path._sharedImagesReady &&
    countsMatch &&
    evenSelections &&
    imageVariants.every((v) => frontsFor(v.key).length > 0);

  async function upload(files, onDone) {
    setBusy(true);
    setError('');
    setNotes([]);
    try {
      const body = new FormData();
      for (const file of files) body.append('image', file);
      const res = await fetch('/api/uploads/front', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.rejected?.length) {
        setNotes(data.rejected.map((r) => `${r.name} skipped — ${r.error}`));
      }
      const upscaled = data.images.filter((i) => i.upscaled);
      if (upscaled.length) {
        setNotes((prev) => [...prev, `${upscaled.length} image(s) upscaled to clear the 1100px minimum.`]);
      }
      const converted = data.images.filter((i) => i.convertedFrom);
      if (converted.length) {
        const kinds = [...new Set(converted.map((i) => i.convertedFrom))].join(', ');
        setNotes((prev) => [
          ...prev,
          `${converted.length} image(s) converted from ${kinds} to PNG — Flipkart's uploader only takes JPG and PNG.`,
        ]);
      }
      onDone(data.images);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickFronts(fileList) {
    const files = [...fileList].slice(0, MAX_BATCH);
    if (fileList.length > MAX_BATCH) {
      setError(`Only the first ${MAX_BATCH} images were taken — that's the per-run limit.`);
    }
    await upload(files, setFronts);
  }

  async function runPreview() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/run/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathId: path.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data.variants);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      // Meesho on its own goes to its own endpoint; combined with anything else the
      // main run orchestrates the order, so there is one run, one Stop button and
      // one progress bar rather than the client stitching two runs together.
      if (partner.length === 1 && partner[0] === 'meesho') {
        const res = await fetch('/api/meesho/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pathId: path.id,
            frontImages: fronts.map((f) => f.path),
            repeat: cycles,
            variantImages: Object.fromEntries(
              imageVariants.map((v) => [v.key, frontsFor(v.key).map((i) => i.path)]),
            ),
            submit: sendToQc,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        onStarted();
        return;
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathId: path.id,
          frontImages: fronts.map((f) => f.path),
          repeat: cycles,
          variantImages: Object.fromEntries(
            imageVariants.map((v) => [v.key, frontsFor(v.key).map((i) => i.path)]),
          ),
          sendToQc,
          partners: partner,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onStarted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold">Front View images</h3>
        <p className="mb-3 text-xs text-slate-500">
          {batchAllowed
            ? `Select up to ${MAX_BATCH}. They are listed one after another in a single browser session, each with its own SKU.`
            : `Each of the ${path.variants.length} variants needs its own Front View. Pick the same number of photos for every variant — ` +
              `N photos each produces N listings, every one carrying all ${path.variants.length} variants.`}
        </p>

        <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
          {[
            ['upload', 'Upload images'],
            ['generate', 'Generate images'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={busy || running || genBusy}
              onClick={() => setMode(key)}
              className={`flex-1 rounded px-2 py-1 ${
                mode === key ? 'bg-white font-medium shadow-sm' : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'generate' && (
          <div className="mb-3">
            <p className="mb-2 text-xs text-slate-500">
              Each image is made by re-photographing this path's own saved photos in a new
              setting, so the product itself stays exactly as it really is. Check every one
              before running — you are responsible for what the listing shows.
              {genTargets.length > 1 &&
                ' Every variant is generated separately, from its own photos, and needs the ' +
                  'same number of picked images as the main listing.'}
            </p>

            {/* Which slots go to the model. This is the whole ballgame: slot 2 on most
                paths is the marketing infographic, and sending that is why generated
                images used to look drawn from the words. Pick the real photographs. */}
            <div className="mb-2 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="mb-1 text-xs font-medium text-slate-600">
                Photos to work from{' '}
                <span className="font-normal text-slate-400">
                  — pick the real product shots, not the infographic
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  ['img2', 'Close Up Shot'],
                  ['img3', 'Edge View'],
                  ['img4', 'Flip Side'],
                  ['img5', 'Package View'],
                ].map(([slot, label]) => {
                  const have = (path._sharedImageSlots || []).find((s) => s.slot === slot);
                  return (
                    <label
                      key={slot}
                      className={`flex items-center gap-1.5 text-xs ${have ? '' : 'opacity-40'}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!have || genBusy || running}
                        checked={refSlots.includes(slot)}
                        onChange={(e) =>
                          setRefSlots((cur) =>
                            e.target.checked
                              ? [...cur, slot].slice(0, 3)
                              : cur.filter((s) => s !== slot),
                          )
                        }
                      />
                      {have && (
                        <img
                          src={`/api/paths/${path.id}/images/${slot}?w=40&v=${have.v}`}
                          alt=""
                          className="h-7 w-7 rounded object-cover"
                        />
                      )}
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Up to 3. More views give the model more to copy; each adds about 1,000 tokens
                (roughly $0.008) per image.
                {genTargets.length > 1 &&
                  ' A variant with its own photo in a slot is generated from that one instead ' +
                    'of the main listing\u2019s.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-600">How many</label>
              <input
                type="number"
                min="1"
                max={MAX_BATCH}
                value={genCount}
                disabled={genBusy || running}
                onChange={(e) => setGenCount(Math.min(Math.max(Number(e.target.value) || 1, 1), MAX_BATCH))}
                className="w-16 rounded border border-slate-300 px-2 py-1 text-xs"
              />
              {genTargets.length > 1 ? (
                <>
                  <span className="text-xs text-slate-500">
                    each, for all {genTargets.length} variants
                  </span>
                  <button
                    type="button"
                    onClick={generateAll}
                    disabled={genBusy || running}
                    className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {genBusy ? 'Generating…' : `Generate for all ${genTargets.length}`}
                  </button>
                </>
              ) : null}
            </div>

            {/* One block per listing that needs its own photographs. A variation path
                is several products sharing a page, and each of them has its own
                colour, its own pack and its own SKU — so each gets its own batch,
                generated from its own reference photos. */}
            {genTargets.map((target) => {
              const made = generated[target.key] || [];
              const picked = approvedOf(target.key).length;
              const isParent = target === parentRow;
              const short = !isParent && fronts.length > 0 && picked !== fronts.length;
              return (
                <div key={target.key} className="mt-3 rounded-lg border border-slate-200 p-2">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {skuCode(target) && (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">
                        {skuCode(target)}
                      </code>
                    )}
                    <span className="text-sm font-medium">
                      {target.label || path.name}
                      {isParent && genTargets.length > 1 && (
                        <span className="font-normal text-slate-400"> (main listing)</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => generate(target)}
                      disabled={genBusy || running}
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                    >
                      {genFor === target.key
                        ? 'Generating…'
                        : made.length
                          ? `Generate ${genCount} more`
                          : `Generate ${genCount}`}
                    </button>
                    {made.length > 0 && (
                      <span
                        className={
                          short ? 'text-xs font-semibold text-rose-600' : 'text-xs text-slate-500'
                        }
                      >
                        {picked} of {made.length} picked
                      </span>
                    )}
                    {!isParent && (
                      <span className="text-[11px] text-slate-400">
                        {path._variantImages?.[target.key]?.own > 0
                          ? `from its own ${path._variantImages[target.key].own} photo${
                              path._variantImages[target.key].own > 1 ? 's' : ''
                            }`
                          : "from the main listing's photos \u2014 check the colour"}
                      </span>
                    )}
                  </div>

                  {made.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      Nothing made for this SKU yet. Generated images are kept under it, so the
                      next batch can reuse them.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {made.map((im, i) => (
                        <div
                          key={im.file || `${im.name || 'err'}-${i}`}
                          className="rounded border border-slate-200 p-1"
                        >
                          {im.name ? (
                            <img
                              src={`/api/images/file/${
                                im.sku ? `${encodeURIComponent(im.sku)}/` : ''
                              }${encodeURIComponent(im.name)}?w=256`}
                              alt={`${skuCode(target) || 'generated'} ${i + 1}`}
                              className="aspect-square w-full rounded object-cover"
                            />
                          ) : (
                            <div className="flex aspect-square w-full items-center justify-center rounded bg-rose-50 p-1 text-[10px] text-rose-700">
                              {im.error || 'failed'}
                            </div>
                          )}
                          {im.saved && (
                            <div className="mt-1 text-[10px] text-slate-400">
                              made earlier{im.madeAt ? ` · ${new Date(im.madeAt).toLocaleDateString()}` : ''}
                            </div>
                          )}
                          {(im.flags || []).map((f, n) => (
                            <div
                              key={n}
                              className={`mt-1 text-[10px] leading-tight ${
                                f.level === 'error' ? 'text-rose-700' : 'text-amber-700'
                              }`}
                            >
                              {f.text}
                            </div>
                          ))}
                          <div className="mt-1 flex items-center justify-between">
                            <label className="flex items-center gap-1 text-[11px]">
                              <input
                                type="checkbox"
                                checked={Boolean(approved[target.key]?.[im.file])}
                                disabled={!im.file || genBusy}
                                onChange={(e) => tick(target.key, [im.file], e.target.checked)}
                              />
                              use
                            </label>
                            <button
                              type="button"
                              onClick={() => regenerate(target, i)}
                              disabled={genBusy || running}
                              className="text-[11px] text-slate-500 underline disabled:opacity-40"
                            >
                              regenerate
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!batchAllowed && mode === 'upload' && (
          <div className="mb-1 text-sm font-medium">
            {skuCode(path.variants[0]) && (
              <code className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">
                {skuCode(path.variants[0])}
              </code>
            )}
            {path.variants[0].label || 'Parent'}{' '}
            <span className="font-normal text-slate-400">(main listing)</span>
          </div>
        )}

        {/* Multi-select everywhere. A variant path batches like any other — N photos
            per variant produce N listings, each carrying the full variant set — so
            the parent picker and the per-variant pickers all take a selection, and
            the counts simply have to match. */}
        {mode === 'upload' && (
          <input
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            disabled={busy || running}
            onChange={(e) => e.target.files.length && pickFronts(e.target.files)}
            className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
          />
        )}

        {fronts.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-emerald-700">
              {fronts.length} image{fronts.length > 1 ? 's' : ''} ready
              {` → ${totalListings} listing${totalListings > 1 ? 's' : ''}`}
              {cycles > 1 && ` (${fronts.length} × ${cycles})`}
            </div>
            <div className="max-h-32 overflow-y-auto text-[11px] text-slate-500">
              {fronts.map((f, i) => (
                <div key={f.path} className="flex justify-between gap-2">
                  <span className="truncate">
                    {i + 1}. {f.name}
                  </span>
                  <span className="shrink-0">
                    {f.width}×{f.height}
                    {f.upscaled && ' ↑'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {imageVariants.length > 0 && mode === 'upload' && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            {imageVariants.map((variant) => (
              <div key={variant.key} className="flex items-center gap-3">
                <div className="w-64 shrink-0">
                  {skuCode(variant) && (
                    <code className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">
                      {skuCode(variant)}
                    </code>
                  )}
                  <span className="text-sm font-medium">{variant.label}</span>
                </div>
                <input
                  type="file"
                  multiple
                  accept={IMAGE_ACCEPT}
                  disabled={busy || running}
                  onChange={(e) =>
                    e.target.files.length &&
                    upload([...e.target.files].slice(0, MAX_BATCH), (imgs) =>
                      setVariantImages((prev) => ({ ...prev, [variant.key]: imgs })),
                    )
                  }
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
                />
                {(variantImages[variant.key] || []).length > 0 && (
                  <span
                    className={
                      (variantImages[variant.key] || []).length === fronts.length
                        ? 'text-xs text-emerald-600'
                        : 'text-xs font-semibold text-rose-600'
                    }
                  >
                    ✓ {(variantImages[variant.key] || []).length} image
                    {(variantImages[variant.key] || []).length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {photoCounts.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-1 text-xs font-medium text-slate-600">
              Photos per variant{' '}
              <span className="font-normal text-slate-400">(1 Front View + reused slots 2–5)</span>
            </div>
            {photoCounts.map((c) => (
              <div key={c.key} className="flex justify-between gap-2 text-[11px] text-slate-500">
                <span className="truncate">
                  {c.label}
                  {c.parent && ' (main)'}
                  {c.own > 0 && (
                    <span className="text-slate-400"> · {c.own} own</span>
                  )}
                </span>
                <span className={countsMatch ? 'shrink-0' : 'shrink-0 font-semibold text-rose-600'}>
                  {c.n} images
                </span>
              </div>
            ))}
            {!countsMatch && (
              <p className="mt-2 text-xs text-rose-600">
                Variants would get different numbers of photos. Flipkart shows each pack size its
                own gallery, so the counts must match before this can run.
              </p>
            )}
            {!evenSelections && fronts.length > 0 && (
              <p className="mt-2 text-xs text-rose-600">
                Pick {fronts.length} photo{fronts.length > 1 ? 's' : ''} for every variant —
                listing 1 takes the 1st from each, listing 2 the 2nd, and so on. Right now:{' '}
                {imageVariants
                  .map((v) => `${v.label || v.key} ${frontsFor(v.key).length}`)
                  .join(', ')}.
              </p>
            )}
          </div>
        )}

        {/* Repeat the whole selection. Flipkart accepts multiple listings with the
            same photo, so N images × R cycles produces N×R listings, each with its
            own SKU. */}
        {fronts.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={repeatOn}
                onChange={(e) => setRepeatOn(e.target.checked)}
                disabled={busy || running}
              />
              <span className="font-medium">Repeat this set</span>
            </label>

            {repeatOn && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Repeat</span>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={repeat}
                  disabled={busy || running}
                  onChange={(e) => setRepeat(e.target.value)}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-xs"
                />
                <span className="text-slate-500">
                  time{cycles > 1 ? 's' : ''} → {fronts.length} × {cycles} ={' '}
                  <span className="font-semibold text-slate-700">{totalListings} listings</span>
                </span>
                {totalListings > 20 && (
                  <span className="text-amber-700">
                    ≈{Math.round((totalListings * 4) / 60)}h at ~4 min each — it runs unattended,
                    but the browser must stay open.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {notes.map((n) => (
          <p key={n} className="mt-2 text-xs text-slate-500">
            {n}
          </p>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Next SKUs</h3>
            <p className="text-xs text-slate-500">
              Allocated rule-based from the path's pattern. Nothing is sent to Flipkart.
            </p>
          </div>
          <button
            onClick={runPreview}
            disabled={busy || running || !copyReady}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Preview
          </button>
        </div>

        {preview && (
          <div className="mt-3 space-y-1">
            {preview.map((v) => (
              <div key={v.key} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="font-medium">{v.label}</span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5">{v.sku}</code>
                <span className="text-slate-500">
                  MRP ₹{v.mrp} · selling ₹{v.sellingPrice}
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-slate-400">
              A fresh SKU is allocated per listing, so a batch of {fronts.length || 'N'} gets{' '}
              {fronts.length || 'N'} distinct sets. The selling price shown is one draw, not the
              figure on the path: on Flipkart and Shopsy every listing prices itself between ₹
              {PRICE_JITTER_BELOW} under and ₹{PRICE_JITTER_ABOVE} over, so a batch does not go
              out at one repeated price. On Meesho the figure is your settlement rather than the
              customer's price, so it only ever draws upward — never below what you set. MRP is
              left alone everywhere.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">Storefront</h3>
        <p className="mt-1 text-xs text-slate-500">
          Each storefront is a separate catalogue. Pick more than one and the same images
          are listed on each in turn, in the order picked — every listing still gets its
          own SKU.
        </p>
        <div className="mt-2 flex gap-2">
          {[
            ['flipkart', 'Flipkart'],
            ['shopsy', 'Shopsy'],
            ['meesho', 'Meesho'],
          ].map(([id, label]) => {
            const at = partner.indexOf(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setPartner((chosen) =>
                    chosen.includes(id)
                      // Never leave none selected — the last one stays put.
                      ? chosen.length > 1
                        ? chosen.filter((p) => p !== id)
                        : chosen
                      : [...chosen, id],
                  )
                }
                disabled={running || busy}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  at >= 0
                    ? 'border-fk-blue bg-fk-blue/10 font-semibold text-fk-ink'
                    : 'border-slate-300 text-slate-600'
                }`}
              >
                {/* The number is the order they will be listed in. */}
                {partner.length > 1 && at >= 0 ? `${at + 1}. ` : ''}
                {label}
              </button>
            );
          })}
        </div>
        {partner.includes('meesho') && (
          <p className="mt-2 text-xs text-slate-500">
            Every front image becomes its own Meesho catalogue with its own SKU, the same as
            a Flipkart run. Meesho takes four images per product, so each listing is the front
            image plus the path's saved slots 2, 3 and 5 — slot 4 does not fit. A multi-variant
            path becomes one catalogue holding every variant as its own product (up to 9),
            so each variant needs its own front image here, sizes included.
          </p>
        )}
        {partner.includes('meesho') && !path.meesho && (
          <p className="mt-2 text-xs text-amber-700">
            This path has no Meesho configuration — category, GST, HSN and price are all
            needed before it can be listed there.
          </p>
        )}
        {partner.includes('shopsy') && shopsyRefusal && (
          <p className="mt-2 text-xs text-amber-700">{shopsyRefusal}</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendToQc}
            onChange={(e) => setSendToQc(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Submit to QC automatically</span>
            <span className="block text-xs text-slate-500">
              Off by default: each listing stops as a validated draft so you can check it in the
              browser first. Sending to QC cannot be undone.
            </span>
          </span>
        </label>

        {!copyReady && (
          <p className="mt-3 text-xs text-amber-700">Generate the saved copy before running.</p>
        )}
        {!path._sharedImagesReady && (
          <p className="mt-3 text-xs text-amber-700">Upload the four reused images before running.</p>
        )}
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        {running && progress?.total > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>
                listing {Math.min(progress.completed + 1, progress.total)} of {progress.total}
              </span>
              <span>
                {progress.ok} ok{progress.failed > 0 && ` · ${progress.failed} failed`}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-fk-blue transition-all"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={start}
          disabled={!ready || busy || running}
          className="mt-4 w-full rounded-lg bg-fk-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {running
            ? 'Run in progress…'
            : `${sendToQc ? 'List and send to QC' : 'Create draft'}${
                totalListings > 1 ? ` — ${totalListings} listings` : ''
              }${partner.length > 1 ? ` on ${partner.length} storefronts` : ''}`}
        </button>

        {/* Only while something is running. Closing the browser used to be the only
            way out of a batch started with the wrong image, which loses the signed-in
            session along with it. */}
        {running && (
          <>
            <button
              onClick={async () => {
                setStopping(true);
                try {
                  const res = await fetch('/api/run/stop', { method: 'POST' });
                  if (!res.ok) setError((await res.json()).error);
                } catch (err) {
                  setError(err.message);
                }
              }}
              disabled={stopping}
              className="mt-2 w-full rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-40"
            >
              {stopping ? 'Stopping after this step…' : 'Stop the run'}
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Stops at the next step rather than mid-keystroke, so it takes a few seconds.
              Listings already finished are kept; the one in progress is left as a
              part-built draft to delete.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
