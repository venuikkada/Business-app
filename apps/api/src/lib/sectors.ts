export const SECTORS = [
  { key: "retail", label: "Retail shop / store", step: 2 },
  { key: "restaurant", label: "Restaurant / cafe", step: 3 },
  { key: "hotel", label: "Hotel / lodge", step: 4 },
  { key: "services", label: "Corporate / services", step: 5 },
  { key: "electronics", label: "Electronics & mobiles", step: null },
  { key: "garment", label: "Garment / boutique", step: null },
  { key: "pharmacy", label: "Pharmacy / medical store", step: null },
  { key: "wholesale", label: "Wholesale / distribution", step: null },
  { key: "salon", label: "Salon / clinic / gym", step: null },
  { key: "manufacturing", label: "Manufacturing", step: null },
] as const;

export type SectorKey = (typeof SECTORS)[number]["key"];
export const SECTOR_KEYS = SECTORS.map((s) => s.key) as [SectorKey, ...SectorKey[]];

/** Default prefixes for document numbers: PREFIX/26-27/0001 (max 16 characters). */
export const DOC_PREFIXES: Record<string, string> = {
  invoice: "INV",
  quotation: "QT",
  sales_order: "SO",
  delivery_challan: "DC",
  credit_note: "CN",
  debit_note: "DN",
  purchase_order: "PO",
  goods_receipt: "GRN",
  supplier_bill: "PB",
  payment_in: "RCT",
  payment_out: "PAY",
  expense: "EXP",
  stock_transfer: "TRF",
  stock_adjustment: "ADJ",
  payslip: "PSL",
};
export const DOC_TYPES = Object.keys(DOC_PREFIXES);

export const DEFAULT_UNITS: [string, string, number][] = [
  ["NOS", "Numbers", 0], ["PCS", "Pieces", 0], ["BOX", "Box", 0], ["SET", "Set", 0], ["DOZ", "Dozen", 0],
  ["KGS", "Kilogram", 3], ["GMS", "Gram", 0], ["LTR", "Litre", 3], ["MLT", "Millilitre", 0], ["MTR", "Metre", 2],
  ["PAC", "Pack", 0], ["HRS", "Hours", 2],
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent", "Electricity", "Salaries & wages", "Transport & fuel", "Tea & snacks", "Repairs & maintenance",
  "Internet & phone", "Office supplies", "Marketing", "Bank charges", "Other",
];
