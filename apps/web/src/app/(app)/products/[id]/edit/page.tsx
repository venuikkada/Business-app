import { products } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { ProductForm, type ProductFormValue } from "@/components/products/product-form";
import { productFormContext } from "@/components/products/load";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Edit product" };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => {
    t.require("products.edit");
    return { p: await products.getProduct(t, id), ctx: await productFormContext(t, id) };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { p, ctx } = res.data;
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const v: ProductFormValue = {
    name: s(p.name), type: p.type as "goods" | "service", sku: s(p.sku), barcode: s(p.barcode), categoryId: s(p.categoryId), brand: s(p.brand), unit: s(p.unit), hsnCode: s(p.hsnCode),
    description: s(p.description), costPrice: s(p.costPrice), sellingPrice: s(p.sellingPrice), mrp: s(p.mrp), taxRate: Number(p.taxRate), pricesIncludeTax: !!p.pricesIncludeTax,
    trackInventory: !!p.trackInventory, trackSerials: !!p.trackSerials, reorderLevel: String(Number(p.reorderLevel)), warrantyMonths: s(p.warrantyMonths), openingStock: "", openingSerials: "",
    parentProductId: s(p.parentProductId), variantAttributes: p.variantAttributes ? Object.entries(p.variantAttributes as Record<string, string>).map(([k, x]) => `${k}: ${x}`).join(", ") : "",
  };
  return (
    <>
      <PageHeader title={`Edit ${p.name as string}`} back={{ href: `/products/${id}`, label: "Back" }} />
      <ProductForm id={id} initial={v} {...ctx} />
    </>
  );
}
