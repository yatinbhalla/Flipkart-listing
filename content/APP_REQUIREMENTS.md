# Flipkart listing app — behaviour requirements (from Yatin, 2026-07-30)

## SKU
- 40x60 (4 seater): pattern `TC_BT/X`, X = random 5-digit number. Manual listing used `TC_BT/1.1`.
- 60x90 (6 seater): pattern `TC_60*90_BT/X`, X = random 5-digit number. Manual used `TC_60*90_BT/1.1`.
- **Model Number mirrors the SKU exactly.** Model Name is separate — it stays the long
  keyword-rich descriptive string, not the code.
- Flipkart accepts `*` in the SKU — `TC_60*90_BT/1.1` saved with no validation error.

## Images
- 5 image slots: Front View, Close Up Shot, Edge View, Flip Side, Package View.
- **Images 2–5 stay the same across listings** — they are reusable/common assets.
- **The user supplies only the 1st image (Front View)**, and that is what kicks off a listing.
- Slots must be filled one at a time; slot N+1 can only be uploaded after slot N finishes.
- **Minimum 1100x1100 px, and Flipkart does NOT enforce it.** The Package View
  (`5.png`) was 1080x1080 and the widget accepted it silently — that only surfaces as
  a QC rejection later. The app now measures every upload and upscales anything
  undersized to 1200x1200 (Lanczos3), so this cannot slip through again.

## Variants
- Variant axes offered by the Table Cover vertical: **Color**, **Pack of**, **Seating Capacity**.
- **Seating Capacity variants need NO additional image** (e.g. 4 Seater 40x60 -> 6 Seater 60x90).
- **Color and Pack of variants DO need their own image.**
- Therefore: if a listing path defines 2 or more variants on Color or Pack of, the app must
  **prompt the user for the 1st (Front View) image of each of those variants**.
  Images 2–5 are still reused.
- Each variant gets its **own full field set** in the matrix table at the bottom of the Variant
  tab — own SKU, MRP, selling price, package dimensions, Width/Length, Description, keywords,
  key features. The app must generate size-appropriate copy per variant, not reuse the parent's.
- Verified variant added manually: 6 Seater, 60x90 inch, SKU `TC_BT/1.2`, MRP 899, selling 499.
  Package dims and weight were copied from the 40x60 (28x25x2 cm, 0.2 kg) because no separate
  values were supplied — **a 60x90 cover almost certainly needs larger/heavier package values**.

## Content fields
- Description / Search Keywords / Key Features must be SEO + GEO optimised and must contain
  **no brand name at all** — not the seller's own brand either.
- Reusable copy for the 40x60 PVC table cover lives in `TC_BT_40X60.md`.

## Field values that stay blank
- Thickness: leave **empty** (a value inconsistent with pack weight is worse than none).
- Packer Details must carry the **full address**, not just the business name (Legal Metrology).

## Optional attributes (added 2026-09-24)
Every optional Additional Description attribute is now filled on all three verticals,
with the exception of four classes that are blank ON PURPOSE. The complete per-vertical
attribute list lives in `content/<VERTICAL>_SCHEMA.json`, captured by `POST /api/discover`.

- **Not-applicable attributes carry the words `Not Applicable`** (warranty text fields,
  Character on the table covers, Thread Count on PVC). These render on the customer-facing
  spec table, so they are visible — that is the intended trade for a complete listing.
- **Counts that are genuinely zero carry `0`** (Number of Hooks, Number of Pouches).
- **Domestic Warranty / International Warranty stay blank.** They are warranty UNIT
  dropdowns whose only options are `Year` and `Months`. There is no "none" option, so
  selecting either would assert a warranty period that does not exist.
- **EAN/UPC stays blank.** These products have no GTIN; a placeholder barcode can collide
  with a real product's and is a likely QC rejection.
- **Video URL stays blank.** It is a URL field and there is no video — `Not Applicable` is
  not a URL.
- **Measured specs are left blank until the seller supplies them**, on the same reasoning
  as Thickness: a wrong number is worse than none. Outstanding:
  Depth (wall hanging, baby muslin), GSM / Tog Rating / Thread Count (baby muslin),
  Thread Count (cotton net table covers only — PVC is `Not Applicable`).
