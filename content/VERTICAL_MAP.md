# Which vertical for which product

The verticals each product goes into on Flipkart, Shopsy and Meesho. Look a product up
here before searching the portals.

For a product that is not listed yet:

```
node tools/find-vertical.mjs <words describing it>
```

That searches the full saved catalogues in `content/verticals/` (every vertical on all
three storefronts, with Flipkart's own synonyms). Add the answer to the table below.
To refresh the catalogues, which only needs doing when a portal adds or renames
verticals, run `node tools/dump-verticals.mjs`. It takes about a minute and needs both
browser profiles signed in.

Catalogues saved 2026-10-12: Flipkart 3,954 verticals, Shopsy 1,600, Meesho 3,786.

## Product → vertical

| Product | Flipkart | Shopsy | Meesho |
|---|---|---|---|
| **Baby clothing set** (cap, jacket, bib, pyjamas) | Clothing / Co-ords and Combo Sets / Kids Apparel Combo `#7482` | Shopsy / Combo Sets / Shopsy Kids Apparel Combo `#5638` | Kids & Toys > Kids Clothing > Boys Clothing Sets > Clothing Set `#10284` (yellow). Girls Clothing Sets > Clothing Set `#10285` (pink) |
| Baby hooded towel | Baby Care / Bath Care, Diapering & Potty / Bath Towels `#430` | Shopsy / Bathing Accessories / Shopsy Bath Towel | Home & Living > Baby Care > Baby Towels > Baby Towels `#11029` |
| Hand / face towel | Health & Beauty / Bath and Spa / Bath Towels `#407` | Shopsy / Bathing Accessories / Shopsy Bath Towel | Home & Kitchen > Home Furnishings > Bathroom Linen > Hand & Face Towels |
| Bath linen set | Home Furnishing / Bathing Accessories / Bath Linen Set `#448` | Shopsy / Bathing Accessories / Shopsy Bath Linen Set | (not mapped yet) |
| Baby muslin dohar / blanket | Baby Care / Baby Bedding & Gear / Blanket `#256` | Shopsy / Baby Bedding & Gear / Shopsy Blanket `#5380` | Home & Living > Baby Care > Baby Blanket > Baby Blanket `#11025` |
| Table cover (net, PVC) | Home & Kitchen Accessories / Kitchen & Table Linen / Table Cover `#2791` | Shopsy / Baby Bedding & Gear / Shopsy Table Cover `#5409` | Home & Kitchen > Home Furnishings > Kitchen Linens > Table Cloths |
| Wall hanging organizer | Household Care & Supplies / Home Organizers & Storage / Hanging Organizers `#2392` | Shopsy / Home Organizers & Storage / Shopsy Hanging Organizer | Home & Kitchen > Home Decor > Decorative Accessories > Wall Decor & Hangings |
| Aasan / prayer mat | Home Furnishing / Floor Coverings / Mat `#1802` | Shopsy / Baby Bedding & Gear / Shopsy Mat `#5366` | Home & Kitchen > Home Furnishings > Carpets & Rugs > Pooja Mats |
| Kitchen apron (quilted, floral print) | Home & Kitchen Accessories / Kitchen & Table Linen / Apron `#2785` | Shopsy / Kitchen & Table Linen / Shopsy Apron `#5375` | Home & Kitchen > Home Furnishings > Kitchen Linens > Aprons `#13342` |
| Prayer kit | Home Decor / Festival Supplies / Prayer Kit `#1746` | Shopsy / Festival Supplies / Shopsy Prayer Kit | (not mapped yet) |

`#n` is the portal's own vertical or category id, from the saved catalogues.

## How to read the catalogues

- **Shopsy shows the same vertical under a different branch.** Every Shopsy vertical is
  its Flipkart one with `shopsy_` on the internal name (`kids_apparel_combo` →
  `shopsy_kids_apparel_combo`), but the branch above it is often named differently.
  Flipkart's Kids Apparel Combo sits under *Co-ords and Combo Sets*, while Shopsy's sits
  under *Combo Sets*, separate from Shopsy's own *Co-ords and Combo Sets* branch, which
  holds only Co-ords and Twinning Set. So the obvious branch can miss the right vertical.
  Each entry in `FLIPKART_VERTICALS.json` carries its Shopsy twin in a `shopsy` field,
  and each Shopsy entry carries its Flipkart twin in a `flipkart` field. 1,583 of
  Shopsy's 1,600 verticals have a twin.
- **The portals' typeaheads are not a reliable way to find a vertical.** Flipkart's
  search returns nothing useful for "baby clothing set" or "new born set", and Shopsy's
  returns clotheslines. Only the saved tree and the synonyms in it give the right answer.
- **A Flipkart leaf name can exist in several branches.** Table Cover exists under Baby
  Care, Home Furnishing and Home & Kitchen Accessories, and Blanket and Bath Towels are
  the same. Store the full path in a config (`verticalPath`), not just the leaf.
- **Meesho has no unisex or infant leaf for clothing sets.** It splits kids' clothing by
  Boys/Girls. The only Infants branch (*Kids - Boys Western Wear > Infants*) holds just
  Bodysuit, Onesies & Rompers and Swimwear.

## Baby clothing set: why these verticals

Form schemas, read 2026-10-13:

- `KIDS_APPAREL_COMBO_SCHEMA.json`: Flipkart, 29 mandatory fields.
- `SHOPSY_KIDS_APPAREL_COMBO_SCHEMA.json`: Shopsy, 25 mandatory fields.
- `MEESHO_BOYS_CLOTHING_SET_SCHEMA.json` and `MEESHO_GIRLS_CLOTHING_SET_SCHEMA.json`:
  Meesho, including the per-size fields.

Learned from the live listings of 2026-10-14:

- **Colour variants use the Brand Color axis on both storefronts.** A pink parent with a
  Yellow variant lists cleanly on Flipkart and on Shopsy.
- **The size column is a locked label in the variant matrix, like the axis column.** It is
  Brand Size on Flipkart and Size on Shopsy. It inherits the parent's value and has no
  control, so a `variantColumns` entry for it stalls the run. Leave it out.
- **The two matrices differ in size.** Flipkart's has 34 columns. Shopsy's has 54, because
  the attributes Shopsy moves to Additional Description become per-variant columns there.
- **Flipkart pre-fills Key Features with 5 suggestions of its own.** The stored key
  features then do not fit, and the run reports the overflow rather than failing.

The product is a 5-piece newborn set (`F:\Flipkart\BS_5ST_YL`): cap, front-button
jacket, bib, plain pyjama and footed pyjama, in a yellow sports-ball and tiger print.

- **Flipkart: Kids Apparel Combo.** Its synonyms are "Kids Western Set", "Kids apparel
  combo" and "kids cloth set". Rejected:
  - Twinning Sets: matching outfits for two people.
  - Co-ords: women's western sets.
  - Kids Nightwear: sleepwear.
  - Kids Ethnic Set: kurta-pyjama.
  - Baby Care Combo: care products, not clothes.
  - Bibs and Kids Cap: single items.
- **Shopsy: Shopsy Kids Apparel Combo.** This is the direct twin of the Flipkart
  vertical. It is a better fit than Shopsy Twinning Set, the closest match found before,
  which is for matching sets.
- **Meesho: Boys Clothing Sets > Clothing Set for the yellow set (BS_5ST_YL), with girls'
  keywords in its description. Girls Clothing Sets > Clothing Set for the pink set
  (BS_5ST_PK).** This is the seller's decision of 2026-10-13. On Flipkart and Shopsy both
  colours are listed with Ideal For covering boys and girls. Rejected:
  - Onesies & Rompers and Bodysuit: single garments.
  - Nightsuits and Pyjamas: sleepwear.
  - Active Clothing set: sportswear.
