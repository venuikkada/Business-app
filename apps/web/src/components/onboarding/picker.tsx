"use client";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Badge, Card } from "@/components/ui";
import { useToast, describeError } from "@/components/client";

export function BusinessPicker({ items, deleted }: { items: Array<{ id: string; name: string; roleName: string; planName: string | null; status: string; city?: string | null }>; deleted: Array<{ id: string; name: string; purgeAfter: string }> }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="space-y-3">
      {items.map((b) => (
        <button
          key={b.id}
          onClick={async () => {
            await api("POST", `businesses/${b.id}/select`);
            router.push("/dashboard");
            router.refresh();
          }}
          className="block w-full text-left"
        >
          <Card className="flex items-center justify-between p-4 hover:border-brand-300">
            <div>
              <div className="font-medium">{b.name}</div>
              <div className="text-xs text-muted">{[b.city, b.roleName].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="flex gap-2">
              {b.status === "suspended" && <Badge color="red">Suspended</Badge>}
              {b.planName && <Badge color="orange">{b.planName}</Badge>}
            </div>
          </Card>
        </button>
      ))}
      {deleted.map((b) => (
        <Card key={b.id} className="flex items-center justify-between border-dashed p-4">
          <div>
            <div className="font-medium text-muted line-through">{b.name}</div>
            <div className="text-xs text-muted">Scheduled for permanent deletion on {new Date(b.purgeAfter).toLocaleDateString("en-IN")}</div>
          </div>
          <button
            className="text-sm font-medium text-brand-700 hover:underline"
            onClick={async () => {
              try {
                await api("POST", `businesses/${b.id}/restore`);
                toast("success", "Business restored");
                router.refresh();
              } catch (e) {
                toast("error", describeError(e));
              }
            }}
          >
            Restore
          </button>
        </Card>
      ))}
    </div>
  );
}
