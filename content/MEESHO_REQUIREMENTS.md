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

## Field mapping

Meesho's vocabulary is not the seller's. Every value below was checked against the
option list read off the live form; a value that is not on the list is rejected
silently, so none of these are guesses. Each in-scope path carries the resolved
values in a `meesho` block in its own config (kept local with the rest of
`data/paths`).

| Meesho field | Table Cloths | Baby Blanket | Wall Decor & Hangings |
|---|---|---|---|
| `generic_name` | Table Cloths | Baby Blanket | Wall Decor & Hangings |
| `supplier_gst_percent` | 18 PVC / 5 net | 5 | 5 |
| `material` | PVC or **Fabric** | — | Fabric |
| `pattern` | Printed / Solid / Checked / Embroidery | — | — |
| `type` | — | Dohar | Scenery |
| `fabric` | — | Cotton | — |
| `ideal_for` | — | Baby | All Purpose |
| `included_components` | — | — | cotton |
| `multipack` | 1 | — | 1 / 2 / 4 (the pack size) |
| `product_unit` / `weight_unit` | Inch / g | — | Inch / g |
| `hsn_code` | 392410 PVC / 630492 net | 611190 | 630492 |
| `color` | as the path already states | White | remapped, see below |

Two vocabulary gaps the seller settled:

- Meesho offers no "Cotton" and no "Net" material for table cloths, so the 14 net
  covers list as **Fabric**. The four PVC covers list as PVC.
- Meesho's pattern list has no "Floral". Printed is the catch-all; TC_BT is Solid,
  TC_NBR is Embroidery, and TC_MWCT_BGCK is Checked after its chequered lace.

Colours needed no work on two categories: every table cover colour (White, Red,
Multicolor, Brown, Beige, Black, Blue) and the blankets' White are already in
Meesho's lists. The organisers are the exception — theirs are descriptive
("Black Panda Print", "Charcoal Grey") and Meesho's palette is plain, so the
seller chose each mapping:

| Path colour | Meesho | | Path colour | Meesho |
|---|---|---|---|---|
| Charcoal Grey | Gray | | Black Panda Print | Gray |
| Royal Blue | Blue | | Black Multicolour Floral | Multicolor |
| Turquoise Blue | Green | | Black Blue Floral | Multicolor |
| Mauve | Pink | | Cream Multicolour Print | Multicolor |
| Pink Furry Check | Multi | | | |

Two consequences worth knowing: Royal Blue and Turquoise Blue no longer share a
colour, but four distinct prints all land on Multicolor, so those nine listings
are colour-identical on Meesho.

All three HSN codes the paths already use are offered by their Meesho category, so
they carry over unchanged.

**Wall Decor & Hangings does not describe these products.** `type` is mandatory and
offers only Festive Toran, God related, Horses, Peacock style, Religious and
Scenery — none of which is a three-pocket storage organiser. The seller chose to
stay in the category and list them as **Scenery**. The alternative categories
(Home Utility > Home Storage & Organization > Organisers, and Home & Living > Home
Utility > Organisers) were not explored.

## The submission flow, and what the form does to you

Verified end to end on 2026-09-28 by listing TC_NBR (SKU TC_NBR/99634).

Submitting is not one click: **Submit Catalog -> tick the "I understand that all
products..." declaration -> Update Changes -> Proceed**, after which the panel
returns to the catalog list. The declaration is another drawn checkbox, so it is
clicked by its box, not its text.

Fields are addressed by **id**, which is what the recordings in the standalone
Meesho app use and is far steadier than label hunting:
`#supplier_gst_percent`, `#hsn_code`, `#product_weight_in_gms`,
`#supplier_product_id`, `#product_name`, `#meesho_price`, `#wdrp_discount`,
`#product_mrp`, `#inventory`, `#supplier_sku_id`, `#color`, `#generic_name`,
`#material`, `#multipack`, `#pattern`, `#product_length`, `#product_breadth`,
`#product_height`, `#product_unit`, `#size`, `#weight`, `#weight_unit`,
`#country_of_origin`, the manufacturer/packer fields, and `#comment`.

Traps that cost a run each:

- **The return discount is rewritten by Meesho.** Once a price exists it writes its
  own suggested value into `#wdrp_discount`, so a "1" typed beforehand became
  "141" and the form refused to submit: "Enter discount here, not price". Fill it
  LAST, clear it explicitly, type it, and read it back — it is the only field on
  the form that changes underneath you, so it is also re-checked immediately
  before submit.
- **Long dropdowns carry a search box** (`input.MuiInputBase-inputAdornedStart`) —
  HSN, product length and product breadth need it.
- **Short option values need a scoped match.** Looking for text "1" anywhere on the
  page finds a dozen things that are not options; the match has to be inside the
  open listbox.
- **Extra images go through the file input `#addMoreImagesInput`**, all three at
  once, and they are added AFTER the size is chosen.

Values that are not what they look like:

- `product_length` / `product_breadth` / `product_height` are the PRODUCT, not the
  shipping packet: a 40x60 inch cover is L 60, B 40, H 0, unit Inch. (The 12x10x0.5
  packet has no home on this form.)
- `#size` wants the product size as one string, "40x60 Inch". The Free Size
  checkbox is a different column entirely.
- `#weight` is 0.1 with `#weight_unit` kg — the same 100 g, said Meesho's way.
- The address fields take the town only ("Hansi"), not the full postal line.

## Field ids differ per category

The same attribute is not the same element in every category, so one set of
selectors cannot drive all three. Proven by listing one product in each.

| Attribute | Table Cloths / Wall Decor | Baby Blanket |
|---|---|---|
| Net Quantity | `#multipack` | `#pack_of` |
| Length / Breadth | `#product_length` / `#product_breadth` | `#length_size` / `#width_size` |

`#length_size` and `#width_size` do not exist until the size row is created, so a
field inventory taken earlier in the form will not list them. "Field absent"
therefore never means "field not required" — Baby Blanket reported *Mandatory
field, Please provide Length Size* for a field that was not on the page when the
form first loaded.

Baby Blanket also has no material, pattern, product unit, weight or weight unit at
all, and its Product Details "Size" carries no asterisk — optional, unlike the
Table Cloths one which wants "40x60 Inch".

## Reading the errors

The submit banner counts errors without naming them, which costs a run per unknown.
The offending fields carry MUI error styling, so after a failed submit the helper
text under `.Mui-error, [aria-invalid="true"], .MuiFormHelperText-root` names them
outright. Worth doing before guessing.

## What has to be read back

A successful `fill()` is not evidence the value stuck. The price row is rewritten
by Meesho as its own figures settle, and three fields were observed to silently
lose or mangle their value: the return discount, the row SKU id, and the
inventory. All three are typed, read back, retried, and re-checked immediately
before submit — the description length is checked there too.

The description is capped at 1400 characters and the stored copy was written for
Flipkart's 5000, so some paths overflow on their own: the wall hanging's ran to
1652 and had to be trimmed to a sentence boundary before Meesho would accept it.

"Update Changes" appears for some categories and not others — the muslin went
straight from the declaration to Proceed. Both are treated as optional.

## Prices

Set per price group by the seller and stored per path. MRP matches Flipkart; the
selling price does not, and runs 26-52% below it.
