export const metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-sm leading-7 text-stone-700">
      <h1 className="mb-2 text-3xl font-semibold text-ink">Privacy policy</h1>
      <p className="mb-6 rounded-lg bg-amber-50 p-3 text-amber-900">Template for the operator of this service. Review it with a lawyer for compliance with the Digital Personal Data Protection Act, 2023 and the IT Act before going live, and fill in the operator details.</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">What we collect</h2>
      <p>Account data (name, email, mobile number), the business data you enter (customers, products, invoices, payments, expenses) and technical logs (IP address, device, sign-in times) needed for security.</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">Why</h2>
      <p>Only to provide the service you signed up for: billing, inventory, reports, reminders and support. We do not sell personal data and do not use your customers&apos; data for advertising.</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">Your business&apos;s customers</h2>
      <p>You are responsible for having a lawful basis (such as consent or a business relationship) for the customer data you store and for messages you send. The app only prepares WhatsApp messages that you send yourself; it does not send bulk messages.</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">Access by our staff</h2>
      <p>Support staff cannot view your business records unless the business owner approves a time-limited, read-only access request. Every access is logged in your audit log.</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">Retention and deletion</h2>
      <p>You can export all your data at any time. Deleting a business removes it from use immediately and permanently after 30 days; backup copies expire on their normal schedule. You can delete your personal account from Profile &amp; security.</p>
      <h2 className="mt-6 text-lg font-semibold text-ink">Contact</h2>
      <p>Grievance officer: [name, email, address — to be filled in by the operator].</p>
    </main>
  );
}
