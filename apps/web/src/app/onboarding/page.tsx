import { requireAuth } from "@/lib/session";
import { ToastProvider } from "@/components/client";
import { BusinessOnboarding } from "@/components/onboarding/business-form";

export const metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const a = await requireAuth();
  return (
    <ToastProvider>
      <main className="mx-auto max-w-xl px-4 py-10 sm:py-16">
        <p className="text-sm font-medium text-brand-700">Welcome, {a.user.fullName.split(" ")[0]}</p>
        <h1 className="mb-6 mt-1 text-2xl font-semibold">Let&apos;s set up your business</h1>
        <BusinessOnboarding />
      </main>
    </ToastProvider>
  );
}
