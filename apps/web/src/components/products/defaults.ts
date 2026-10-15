import type { ProductFormValue } from "./product-form";

export const blankProduct = (inventory: boolean): ProductFormValue => ({
  name: "", type: "goods", sku: "", barcode: "", categoryId: "", brand: "", unit: "pcs", hsnCode: "", description: "", costPrice: "", sellingPrice: "", mrp: "",
  taxRate: 18, pricesIncludeTax: false, trackInventory: inventory, trackSerials: false, reorderLevel: "", warrantyMonths: "", openingStock: "", openingSerials: "", parentProductId: "", variantAttributes: "",
});
