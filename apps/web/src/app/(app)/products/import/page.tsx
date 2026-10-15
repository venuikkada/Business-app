import { products } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { CsvImport } from "@/components/forms/csv-import";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Import products" };

export default async function ImportProducts() {
  const res = await tenantOrError(async (t) => {
    t.require("products.create");
    t.require("data.create");
    return true;
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const template = `${products.PRODUCT_CSV_HEADERS.join(",")}\n2MP Dome Camera,goods,CAM-D2,8901234567890,CCTV,DemoBrand,pcs,85258900,1150,1850,2200,18,no,yes,10,25,12\nInstallation charges,service,SRV-INST,,Services,,job,998719,0,500,,18,no,no,0,,\n`;
  return (
    <>
      <PageHeader title="Import products" back={{ href: "/products", label: "Products" }} subtitle="Categories are created automatically. Opening stock is added to your main branch." />
      <CsvImport
        entity="products"
        template={template}
        doneHref="/products"
        columns={products.PRODUCT_CSV_HEADERS.map((h) => [h, h === "name" ? "Required" : ""] as [string, string])}
      />
    </>
  );
}
