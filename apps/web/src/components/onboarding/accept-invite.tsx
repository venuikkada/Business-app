"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui";
import { describeError } from "@/components/client";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        size="lg"
        disabled={busy || !token}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await api("POST", "invitations/accept", { token });
            router.push("/dashboard");
            router.refresh();
          } catch (e) {
            setErr(describeError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : "Accept invitation"}
      </Button>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
