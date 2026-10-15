export const metadata = { title: "Terms of service" };

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-sm leading-7 text-stone-700">
      <h1 className="mb-2 text-3xl font-semibold text-ink">Terms of service</h1>
      <p className="mb-6 rounded-lg bg-amber-50 p-3 text-amber-900">Template for the operator of this service. Have it reviewed by a lawyer and add the operator&apos;s legal name and jurisdiction before going live.</p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>The service helps you prepare GST-compliant documents and records. You remain responsible for the correctness of the data you enter and for your tax filings. The app does not file GST returns or generate e-invoices on the GST portal.</li>
        <li>Reports such as gross and net profit are estimates based on the transactions you record and the weighted average cost method.</li>
        <li>Paid plans renew until cancelled. Cancelling keeps features until the end of the paid period. Your data is never deleted because a plan ends; limits of the Free plan apply instead.</li>
        <li>Do not use the service to send unsolicited bulk messages or to store data you have no right to process.</li>
        <li>We may suspend accounts involved in fraud or abuse. You can export your data at any time.</li>
      </ol>
    </main>
  );
}
