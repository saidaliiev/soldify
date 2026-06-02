/**
 * ISO 18245 MCC → category_slug mapping.
 *
 * Phase 3 D-10 tier 2 — when a transaction's MCC is present and falls inside a
 * known range, we map directly to a category slug with confidence 0.85 and
 * skip the Haiku call. ~40 ranges covering top consumer categories.
 *
 * Slug list MUST match the categories table seeded in Phase 1
 * (SEED_DEFAULT_CATEGORIES in apps/mobile/src/lib/db/schema.sql.ts):
 *   groceries, transport, eating-out, coffee, rent, utilities, mobile,
 *   entertainment, health, clothing, gifts, transfers, salary, refunds,
 *   savings, kids, pets, misc.
 *
 * Where the Phase 1 seed lacks a precise slug (e.g. 'fuel', 'travel'),
 * we map to the nearest existing slug — 'transport' for fuel, 'eating-out'
 * for hotels (D-13 fallback expectation). Document any such drift below.
 */

export type MccRange = { range: [number, number]; slug: string };

export const MCC_TO_CATEGORY: ReadonlyArray<MccRange> = [
  // Groceries
  { range: [5411, 5411], slug: 'groceries' },          // Grocery Stores / Supermarkets
  { range: [5412, 5412], slug: 'groceries' },          // Convenience stores
  { range: [5422, 5422], slug: 'groceries' },          // Freezer / Locker meat
  { range: [5441, 5441], slug: 'groceries' },          // Candy / Nut / Confectionery
  { range: [5451, 5451], slug: 'groceries' },          // Dairy Products
  { range: [5462, 5462], slug: 'groceries' },          // Bakeries
  { range: [5499, 5499], slug: 'groceries' },          // Misc Food Stores

  // Eating out + Coffee
  { range: [5811, 5811], slug: 'eating-out' },         // Caterers
  { range: [5812, 5812], slug: 'eating-out' },         // Eating Places, Restaurants
  { range: [5813, 5813], slug: 'eating-out' },         // Drinking Places (Bars/Pubs)
  { range: [5814, 5814], slug: 'eating-out' },         // Fast Food
  { range: [5499, 5499], slug: 'groceries' },          // (duplicate guard — first wins)
  // NOTE: coffee shops are 5814 (fast food) or 5499 — no dedicated MCC.
  //       Haiku tier 3 will disambiguate coffee shops via merchant_name.

  // Transport (fuel + transit + parking + rideshare-as-taxi)
  { range: [4111, 4111], slug: 'transport' },          // Local/Suburban Commuter Passenger Transport
  { range: [4112, 4112], slug: 'transport' },          // Passenger Railways
  { range: [4121, 4121], slug: 'transport' },          // Taxicabs / Limousines (also rideshare)
  { range: [4131, 4131], slug: 'transport' },          // Bus Lines
  { range: [4784, 4784], slug: 'transport' },          // Tolls & Bridge Fees
  { range: [4789, 4789], slug: 'transport' },          // Transportation Services not classified
  { range: [5172, 5172], slug: 'transport' },          // Petroleum & Petroleum Products
  { range: [5541, 5542], slug: 'transport' },          // Service Stations / Automated Fuel Dispensers
  { range: [7523, 7523], slug: 'transport' },          // Parking Lots, Garages

  // Travel (entertainment fallback — Phase 1 seed lacks 'travel' slug; TODO Phase 4 add slug)
  { range: [3000, 3299], slug: 'entertainment' },      // Airlines (TODO Phase 4: 'travel' slug)
  { range: [3501, 3999], slug: 'entertainment' },      // Lodging — Hotels (TODO Phase 4: 'travel' slug)
  { range: [4511, 4511], slug: 'entertainment' },      // Airlines, Air Carriers
  { range: [4722, 4722], slug: 'entertainment' },      // Travel Agencies
  { range: [7011, 7011], slug: 'entertainment' },      // Lodging (Hotels, Motels)

  // Entertainment + Streaming
  { range: [5815, 5818], slug: 'entertainment' },      // Digital Goods / Streaming media
  { range: [7832, 7832], slug: 'entertainment' },      // Motion Picture Theaters
  { range: [7841, 7841], slug: 'entertainment' },      // Video Rental
  { range: [7922, 7922], slug: 'entertainment' },      // Theatrical Producers / Ticket Agencies
  { range: [7929, 7929], slug: 'entertainment' },      // Bands, Orchestras, Misc Entertainers
  { range: [7991, 7991], slug: 'entertainment' },      // Tourist Attractions / Exhibits
  { range: [7993, 7993], slug: 'entertainment' },      // Video Amusement Game Supplies
  { range: [7994, 7994], slug: 'entertainment' },      // Video Game Arcades / Establishments
  { range: [7997, 7997], slug: 'entertainment' },      // Country Clubs / Memberships
  { range: [7999, 7999], slug: 'entertainment' },      // Recreation Services not classified

  // Utilities / Mobile / Internet
  { range: [4814, 4814], slug: 'mobile' },             // Telecom services (mobile carriers)
  { range: [4815, 4815], slug: 'mobile' },             // Visual / SMS gateway
  { range: [4816, 4816], slug: 'mobile' },             // Computer Network / Information Services
  { range: [4899, 4899], slug: 'utilities' },          // Cable / Satellite / Other Pay TV
  { range: [4900, 4900], slug: 'utilities' },          // Utilities (electric, gas, water)

  // Clothing
  { range: [5611, 5611], slug: 'clothing' },           // Men's Clothing
  { range: [5621, 5621], slug: 'clothing' },           // Women's Ready-To-Wear
  { range: [5631, 5631], slug: 'clothing' },           // Women's Accessory
  { range: [5641, 5641], slug: 'clothing' },           // Children's & Infants' Wear
  { range: [5651, 5651], slug: 'clothing' },           // Family Clothing
  { range: [5655, 5655], slug: 'clothing' },           // Sports Apparel
  { range: [5661, 5661], slug: 'clothing' },           // Shoe Stores
  { range: [5691, 5691], slug: 'clothing' },           // Men's & Women's Clothing
  { range: [5697, 5699], slug: 'clothing' },           // Tailors, Misc Apparel

  // Health
  { range: [5912, 5912], slug: 'health' },             // Drug Stores / Pharmacies
  { range: [5975, 5976], slug: 'health' },             // Hearing aids / Orthopedic goods
  { range: [8011, 8011], slug: 'health' },             // Doctors
  { range: [8021, 8021], slug: 'health' },             // Dentists, Orthodontists
  { range: [8031, 8031], slug: 'health' },             // Osteopaths
  { range: [8041, 8043], slug: 'health' },             // Chiropractors, Optometrists, Opticians
  { range: [8049, 8049], slug: 'health' },             // Podiatrists, Chiropodists
  { range: [8050, 8050], slug: 'health' },             // Nursing / Personal Care
  { range: [8062, 8062], slug: 'health' },             // Hospitals
  { range: [8071, 8071], slug: 'health' },             // Medical / Dental Labs
  { range: [8099, 8099], slug: 'health' },             // Health Services not classified

  // Pets
  { range: [742, 742], slug: 'pets' },                 // Veterinary Services (MCC 0742; numeric 742)
  { range: [5995, 5995], slug: 'pets' },               // Pet Shops, Pet Foods, Supplies

  // Gifts (florists, gift shops, jewelry as gift fallback)
  { range: [5193, 5193], slug: 'gifts' },              // Florists Supplies, Nursery
  { range: [5947, 5947], slug: 'gifts' },              // Gift, Card, Novelty, Souvenir
  { range: [5992, 5992], slug: 'gifts' },              // Florists

  // Kids
  { range: [8211, 8211], slug: 'kids' },               // Elementary / Secondary Schools
  { range: [8351, 8351], slug: 'kids' },               // Child Care Services
  { range: [8398, 8398], slug: 'kids' },               // Charitable Org (close enough; TODO Phase 4)

  // Transfers (P2P, ATM, financial)
  { range: [4829, 4829], slug: 'transfers' },          // Wire Transfer / Money Orders
  { range: [6010, 6011], slug: 'transfers' },          // Manual cash / ATM cash disbursements
  { range: [6012, 6012], slug: 'transfers' },          // Financial Institutions (merchandise/services)
  { range: [6051, 6051], slug: 'transfers' },          // Non-Financial Institutions (currency etc.)

  // Misc fallback
  { range: [5999, 5999], slug: 'misc' },               // Miscellaneous Retail
];

/**
 * Returns the slug matching the given MCC (4-digit string), or null when:
 *   - mcc is null
 *   - mcc doesn't match any known range
 *
 * First-match-wins: ranges are scanned in declaration order, so put the most
 * specific entries first.
 */
export function mccToCategorySlug(mcc: string | null): string | null {
  if (mcc == null) return null;
  if (!/^\d{4}$/.test(mcc)) return null;
  const n = Number(mcc);
  for (const entry of MCC_TO_CATEGORY) {
    if (n >= entry.range[0] && n <= entry.range[1]) {
      return entry.slug;
    }
  }
  return null;
}
