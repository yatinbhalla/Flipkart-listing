# Meesho listing — behaviour requirements (from Yatin, 2026-09-28)

Entry point: **Catalog Uploads → Add Single Catalog**, then Select Category →
Add Product Details. One seller account only (Yatin's).
Field schemas: `content/MEESHO_*_SCHEMA.json`.

## Scope — 49 of the 59 paths

- **`_SET` paths are skipped entirely** (10 of them: 9 Wall Hanging sets, 1 muslin
  4-print set). They are bundles, not size variants, and are not listed on Meesho.
- **Multi-variant paths list their first variant only** — no variation listings on
  Meesho. Four paths are affected, all Table Covers (`TC_BT`, `TC_MWCT_BGCK`,
  `TC_MW_BRLF`, `TC_MW_PF`), each listing the 4 Seater 40x60 variant.

## Categories

| Vertical | Meesho category |
|---|---|
| Table Cover | Home & Kitchen > Home Furnishings > Kitchen Linens > Table Cloths |
| Blanket | Home & Living > Baby Care > Baby Blanket > Baby Blanket |
| Hanging Organizers | Home & Kitchen > Home Decor > Decorative Accessories > Wall Decor & Hangings |

## Field values

- **SKU** goes in **both** `supplier_product_id` ("Style code/Product ID") and the
  **SKU ID** column of the price row.
- **Shipping packet**: Length 12, Breadth 10, Height 0.5, unit **inch**.
- **Product Name** and **Description** are AI generated; the description carries the
  search keywords inline. Meesho caps the description at 1400 characters.
- **Brand is left untouched.**
- **GST**: 18% for the PVC table covers, 5% for everything else.
- **Wrong / Defective Return Discount: ₹1** on every listing.
- **MRP** is the same as Flipkart. The selling price is NOT — it is set per price
  group by the seller.
- **Importer details are never filled.** Selecting India under Country Of Origin
  disables all three importer fields and fills them with "Not Required" (verified
  live), so Country Of Origin must be set BEFORE importer details are considered —
  and they are never typed into at all.

## Form mechanics that break naive automation

- **Price is gated behind Size.** Nothing priceable exists until a size is chosen.
  Picking Free Size takes the form from 30 fields to 36 and adds the row: Meesho
  Price*, Wrong/Defective Return Discount(₹), MRP*, Inventory*, SKU ID (optional).
- **Size options are DRAWN checkboxes.** There is no `input[type=checkbox]` on the
  page, and clicking the option's text does not tick it — both fail silently and
  Apply then closes having selected nothing. Click the box just left of the label.
- **Every "Select" field is a readonly MUI input.** `fill()` can never work on one;
  it must be clicked open and the option clicked. This applies to GST, HSN Code,
  Colour, Material, Country Of Origin and the rest.
- **Images cap at 4**: the front image chosen at the category step plus three more
  via "Add Images", after which the control disappears. The seller's choice is the
  run's Front View plus saved slots **img2, img3 and img5** — img4 does not fit.
- Abandoning the form leaves **no draft** behind, unlike Flipkart.

## Still to be supplied

- The Meesho selling price for each of the 13 price groups.
