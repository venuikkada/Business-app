import { parties } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { CsvImport } from "@/components/forms/csv-import";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Import customers" };

export default async function ImportParties() {
  const res = await tenantOrError(async (t) => {
    t.require("parties.create");
    t.require("data.create");
    return true;
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const template = `${parties.PARTY_CSV_HEADERS.join(",")}\nRavi Traders,customer,9876543210,ravi@example.com,,Ravi Kumar,"12 MG Road",Pune,27,411001,0,\nVision Distributors,supplier,9876500000,,,,,Mumbai,27,,-5000,Opening payable\n`;
  return (
    <>
      <PageHeader title="Import customers & suppliers" back={{ href: "/parties", label: "Customers & suppliers" }} />
      <CsvImport
        entity="parties"
        template={template}
        doneHref="/parties"
        columns={[["name", "Required"], ["type", "customer / supplier / both"], ["phone", "10-digit mobile"], ["email", ""], ["gstin", ""], ["contact_person", ""], ["address", ""], ["city", ""], ["state_code", "2-digit GST state code"], ["pincode", ""], ["opening_balance", "Positive = they owe you; negative = you owe them"], ["notes", ""]]}
      />
    </>
  );
}
