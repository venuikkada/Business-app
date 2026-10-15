import { tenantOrError } from "@/lib/session";
import { ProductForm } from "@/components/products/product-form";
import { blankProduct } from "@/components/products/defaults";
import { productFormContext } from "@/components/products/load";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Add product" };

export default async function NewProduct() {
  const res = await tenantOrError(async (t) => {
    t.require("products.create");
    return productFormContext(t);
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title="Add product" back={{ href: "/products", label: "Products" }} />
      <ProductForm initial={blankProduct(res.data.hasInventory)} {...res.data} />
    </>
  );
}
