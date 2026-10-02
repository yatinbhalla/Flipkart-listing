# Content set — Hand Towel, cotton, 34x52 cm, assorted prints, pack of 4

Reusable by the listing app. **No brand names anywhere** (no seller brand, no marketplace name)
— Flipkart QC rejects brand mentions inside description/keyword fields.

- SKU pattern: `HT_PRNT_MIX/{X}`
- Vertical: `Bath Linen Set` (Home Furnishing / Bathing Accessories / Bath Linen Set)
- Source images: `F:\Flipkart\HT_PRNT_MIX\{1..4} (8).png` plus the shared `img5.png`

The pack is **assorted**: four towels, each a different multicolour floral print on the same
white cotton ground. The copy has to say so plainly — a customer who expects four identical
towels and receives four different ones is a return and a rating.

---

## Description (Additional Description > Description, max 5000 chars)

```
Four cotton hand towels in one pack, each carrying a different multicolour floral print on a
white ground. Every towel measures 34 x 52 cm and finishes in a knotted fringe along both
short edges, with woven textured bands running across the body of the cloth.

What is in the pack?
Four hand towels in assorted prints. The prints are picked from the range shown in the photos,
so the four you receive are different from one another and the exact combination varies from
pack to pack.

Where does a towel this size get used?
At the wash basin for drying hands, beside the kitchen sink, on a guest bathroom rail, over a
kitchen counter, in a gym bag, or folded into a lunch box carrier. At 34 x 52 cm it is the
size that sits on a towel ring without trailing, and small enough that four of them wash and
dry together in a single load.

How does it feel and dry?
The cloth is light cotton rather than a thick pile towel, so it stays soft against skin, folds
down small and dries quickly on a line. Cotton takes up water readily and gets softer with
each wash.

How do you wash it?
Machine wash in cold water with like colours. Do not bleach. Tumble dry on low or line dry in
shade. Warm iron if needed. Wash the first time on its own, as printed cotton can release a
little surplus colour on the first wash.

Specifications
Size: 34 x 52 cm (approximately 13 x 20 inches) per towel
Material: Cotton
Colour: White with multicolour print
Pattern: Floral, Printed
Type: Hand Towel
Pack contents: 4 hand towels, assorted prints
Edge finish: Knotted fringe on both short edges
Country of origin: India

Care instructions
Machine wash cold with like colours. Do not bleach. Dry in shade. Warm iron if required.
```

## Search Keywords (multi-value — one chip per line, Enter after each)

```
hand towel
hand towel set of 4
cotton hand towel
hand towel pack of 4
printed hand towel
face towel
small towel
kitchen towel
napkin towel
hand towel for bathroom
multicolour hand towel
floral print hand towel
fringe hand towel
34x52 cm hand towel
guest towel
```

## Key Features (multi-value)

```
Pack of 4 hand towels
Assorted multicolour floral prints
Soft cotton fabric
34 x 52 cm per towel
Knotted fringe on both edges
Lightweight and quick drying
Machine washable
Suits bathroom, kitchen and travel use
```

## Care Instructions (multi-value)

```
Machine wash in cold water
Wash with like colours
Do not bleach
Dry in shade
Warm iron if required
```

## Other Additional-Description values

| Field | Value |
|---|---|
| Items Included | `4 Hand Towels` |
| Brand Color | `White` / `Multicolor` |
| Pattern | `Floral`, `Printed` |
| Pack of | `4` |
| Character | `Not Applicable` — the prints are generic florals, no licensed or cartoon figure |
| Gift Pack | `No` |
| Reversible | `No` — the print sits on one face |
| Width / Length | `34` / `52` (cm) per towel — carried as `13.5` / `20.5` inch so the spec table rounds back to exactly 34 x 52 cm |
| GSM, Thread Count, Ply | **left blank** — not measured yet. A wrong fabric spec is worse than a missing optional one (same rule as Thickness on the PVC covers) |
| Warranty Summary, Warranty Service Type, Covered in Warranty, Not Covered in Warranty | `Not Applicable` |
| Domestic Warranty, International Warranty | **left blank** — warranty UNIT dropdowns offering only `Year` / `Months`, neither of which means "none" |
| EAN/UPC | **left blank** — no GTIN on these products |
| Video URL | **left blank** — a URL field with no video to point at |

## Images

The listed set is the seller's own rendered images, kept at `F:\Flipkart\HT_PRNT_MIX`
alongside every other path's photos. They replaced the set built from the raw phone
photos on 2026-10-02.

| Slot | File | What it is |
|---|---|---|
| 1 Front View | `1 (8).png` | Four towels stacked on a basin counter. No text or badge — Flipkart QC rejects graphics and promotional text on the primary image, and this one is clean. Picked per run from the Front View picker. |
| 2 Close Up | `2 (8).png` → `img2` | Spec card: 34 x 52 cm dimensions, frill-edge and fabric-texture insets, four feature chips. |
| 3 Edge View | `3 (8).png` → `img3` | Pack-of-4 lifestyle shot with the four prints stacked and one on a rail, plus four claim chips. |
| 4 Flip Side | `4 (8).png` → `img4` | In-use shot at a basin. |
| 5 Package View | `img5.png` | The shared package shot every other path carries. Byte-identical to the one already on the path. |

All five are 1254x1254 (slot 5 is 1200x1200), comfortably over Flipkart's 1100 px
minimum, and PNG, which is one of the two formats the upload widget accepts. The Front
View is not byte-identical to any reused slot, so the run's duplicate-image guard will
not trip.

Meesho takes four images and reads slots 2, 3 and 5, so it gets the spec card, the
pack-of-4 shot and the package shot.

**Two things to check before these go live**, both about whether the pictures match the
goods:

- **The fringe does not match.** The rendered towels carry thick tasselled pom-pom
  fringing; the real towels have a fine knotted thread fringe. That is the detail a buyer
  photographs when they open a "not as pictured" return.
- **Image 3 claims "Highly Absorbent" and "Lightweight & Quick Dry".** Neither has been
  measured, and GSM is still blank on the path for exactly that reason.

The raw phone photos stay in `data/paths/hand-towel-print-mix/source/`, and
`tools/listing-images.cjs` still builds a set from them. Neither is used for this listing
any more; they are kept as provenance and because the tool records why the towels could
not be cut out of their background.

## Open questions for the seller

Prices, weight and both categories are settled and in the config. All three field maps
were discovered live on 2026-10-01 and saved to `content/BATH_LINEN_SET_SCHEMA.json`,
`content/SHOPSY_BATH_LINEN_SET_SCHEMA.json` and
`content/MEESHO_HAND_FACE_TOWELS_SCHEMA.json`. What is left:

1. **The HSN does not match across marketplaces.** Flipkart and Shopsy carry `611120` as
   supplied — their HSN is a free-text field. Meesho's Hand & Face Towels category offers
   only `630492`, `630260` and `520811`, so the `meesho` block uses **`630260`**. One
   product should not be filed under two codes: decide which is right and make both
   match. `611120` is a knitted babies'-garments code; towels normally sit under 6302.
2. **GSM** is left blank on a field that exists on this vertical — fill it if the mill
   states one. It is also what the "Highly Absorbent" and "Quick Dry" claims on image 3
   would need to stand on.
3. **Meesho product dimensions go in as `20.5 x 13.5 Inch`**, not centimetres, because
   `createListing` hardcodes `product_unit` to Inch. The category does offer `cm`; using
   it needs a code change, not a config one.

## What the verticals turned out to need

Bath Linen Set is a **set** vertical: it carries separate Bath / Hand / Face towel
dimension fields, of which only the Hand pair is filled, and a mandatory **Bath Robe
Size** that is answered `NA`. It has no Type, Reversible, Character or Thread Count
attribute, so those came off the path.

Shopsy is the same form field for field, with one rename (`Items Included` becomes
`Sales Package`) and one option missing from Procurement type (`domestic procurement`,
which no path uses). The vertical is **not** prefixed with "Shopsy".

Meesho's Bathroom Linen has no pattern, fabric, size, weight or weight-unit field at all,
and makes `type` and `ideal_for` mandatory where the other categories do not.
