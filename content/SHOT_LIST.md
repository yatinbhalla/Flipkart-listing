# Shot list — getting a different front image per listing without editing one

Every new listing needs a front image that is not a repeat. The cheapest and most
reliable way to get those is not software: it is one photo session per product,
shot in several settings, reused forever.

Why not automate it — the short version. A cut-out-and-composite pipeline was built
as a throwaway preview on 2026-10-30 and tested on real source photos with ISNet and
U²-Net. On a room-scene source (a table cover on a centre table in a living room) the
matte selected **the floor** and discarded both the sofa and the tablecloth. A
salient-object model has no way to know which object in a furnished room is the
product. `tools/listing-images.cjs` reached the same conclusion from the other
direction in an earlier attempt: *"A ragged cut-out looks worse on a listing than an
honest photograph, so the photographs stay."*

So: photograph it properly once, and the problem is solved permanently.

## How many, and how

**Target 10 usable frames per product.** At 10 frames a product you can run 10
listings before anything repeats, and the set never expires.

Five settings × two variations each gets you there in one session:

- **Per setting**: one straight-on at eye level, one at a three-quarter angle.
- **Across the session**: vary the light (window light, then a softer corner), and
  vary what else is in frame (bare, then one prop such as a plant or a cup).
- Shoot in **daylight near a window**, not under a ceiling bulb. Switch the phone's
  HDR on and lock focus on the fabric.
- **Minimum 1100×1100 px** — the app upscales below that, which softens the weave.
  Any modern phone clears this comfortably; just do not crop in hard afterwards.
- **No text, no watermark, no border** on the front image. Flipkart QC rejects
  graphics on the primary image.
- Keep every frame. A set of ten taken once costs an afternoon and serves every
  listing of that product from then on.

## The settings, per product family

These are the settings the app's own copy already claims for each product, from
`vocabulary()` in `src/ai/compose.js`. Shooting these keeps the photograph and the
description telling the same story.

### Table cover — 30 paths
Dining table · centre table · study desk · office table · side table

Drape it properly and let the corners hang; a cover photographed flat reads as a
bedsheet. Include one frame with the table partly laid — a cup, a bowl — so the
scale is obvious.

### Wall hanging organizer — 48 paths
Bedroom · hostel room · study corner · kitchen wall · bathroom door · rented flat

Hang it on an actual wall or door for every frame, loaded with the sort of things it
is meant to hold. Flat on the floor shows nothing a buyer needs. This is the biggest
family in the catalogue, so it is worth the most shooting time.

### Hooded baby towel — 12 paths
Bathroom · nursery · changing table · travel bag · grandparents' house

**No people in these photographs.** A towel folded on a changing table or draped
over a cot rail shows the product; it also avoids every problem that comes with
using a child's photograph in a listing. Photograph the hood open so the embroidery
reads.

### Baby dohar — 7 paths
Cot · stroller · car seat · floor mat · travel bag

Show it in use on the object, not held up. One frame folded to show the layers, one
spread to show the full print.

### Aasan / prayer mat — 3 paths
Mandir · pooja room · prayer corner · meditation spot · living room floor

Photograph it laid out on the floor where it would actually be used. One frame
showing the fringed edge closely.

### Hand towel — 1 path
Wash basin · kitchen counter · guest bathroom · gym bag · travel bag

For the assorted four-pack, at least one frame must show all four towels together
with their **different prints visible**, or buyers expect four identical ones and
return them.

## Reusing what you shoot

Front images are picked per run in the app, so a folder per product is enough:

```
<product>/
  01-dining-table-straight.jpg
  02-dining-table-angle.jpg
  03-centre-table-straight.jpg
  ...
```

Pick the next unused frames for each batch. The app already refuses a batch whose
images duplicate each other or the path's stored slots, so an accidental repeat is
caught before it reaches a listing.
