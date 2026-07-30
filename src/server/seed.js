/**
 * The Table Cover path, transcribed from the listing that was built by hand on
 * 2026-07-30 and accepted by Flipkart (QC In Progress, 2 variants).
 *
 * Every value here was verified against the live form, so this doubles as the
 * reference for what a working path config looks like.
 */

// Placeholder on purpose — real manufacturer/packer addresses are business data and
// stay in data/paths/<id>/config.json, which is gitignored. Fill this in locally, or
// edit the seeded path's config.json after first boot.
const MANUFACTURER = '<Business name, street, area, city, state, PIN>';

export const seedPath = {
  id: 'pvc-table-cover',
  name: 'PVC Table Cover (transparent black, lace border)',
  vertical: 'Table Cover',
  brand: '<Your brand>',
  productType: 'transparent PVC table cover with a golden lace border',
  skuPattern: 'TC_BT/{X}',
  copyNotes: 'Waterproof, wipe-clean, protects against spills, stains, scratches and heat marks.',

  // Product-level values — identical across every variant.
  shared: {
    listingStatus: 'Active',
    minoq: '1',
    fullfilmentBy: 'Seller',
    procurementType: 'express',
    // NOTE: with procurement type = express, Flipkart reads this as HOURS, not days.
    procurementSla: '2',
    stock: '1000',
    shippingProvider: 'Flipkart',
    hsn: '392410',
    taxCode: 'GST_18',
    countryOfOrigin: 'India',
    manufacturerDetails: MANUFACTURER,
    // Legal Metrology asks for the packer's full address, not just a business name.
    packerDetails: MANUFACTURER,

    type: 'Table Cover',
    material: ['PVC'],
    pattern: ['Solid'],
    colorText: ['Black'],
    colorRefiner: ['Black'],
    brandColor: ['Black'],
    itemsIncluded: ['1 Table Cover'],
    reversible: 'No',
    giftPack: 'No',
    wrinkleFree: 'Yes',
    // Deliberately blank: 3 mm contradicts a 200 g pack weight, and a wrong spec is
    // worse than a missing optional one.
    thickness: '',
    careInstructions: [
      'Wipe with a soft damp cloth',
      'Do not machine wash',
      'Do not bleach',
      'Do not iron',
      'Dry in shade',
    ],
  },

  variants: [
    {
      key: '40x60',
      label: '4 Seater — 40x60 inch',
      // The first variant is the parent listing; axis is unused for it.
      axis: null,
      axisValue: null,
      skuPattern: 'TC_BT/{X}',
      seatingCapacity: '4 Seater',
      packOf: '1',
      mrp: '599',
      sellingPrice: '379',
      sizeInches: { width: '40', length: '60' },
      package: { length: '28', breadth: '25', height: '2', weightKg: '0.2' },
      weightGrams: '200',
    },
    {
      key: '60x90',
      label: '6 Seater — 60x90 inch',
      // Seating Capacity variants reuse the parent's images — no extra Front View.
      axis: 'Seating Capacity',
      axisValue: '6 Seater',
      skuPattern: 'TC_60*90_BT/{X}',
      seatingCapacity: '6 Seater',
      packOf: '1',
      mrp: '899',
      sellingPrice: '499',
      sizeInches: { width: '60', length: '90' },
      package: { length: '28', breadth: '25', height: '4', weightKg: '0.3' },
      // Live listing carries 200 g here; likely wants raising alongside the 0.3 kg pack.
      weightGrams: '200',
    },
  ],
};
