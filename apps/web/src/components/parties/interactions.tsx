"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateIN, formatDateTimeIN } from "@cba/core";
import { api, ApiError } from "@/lib/api-client";
import { Badge, Button, Field, Input, Select, Textarea } from "../ui";
import { useToast } from "../client";

export function Interactions({ partyId, items, canEdit, today }: { partyId: string; items: Array<Record<string, string | null>>; canEdit: boolean; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ kind: "call", notes: "", followUpOn: "" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <ol className="space-y-3">
        {items.length === 0 && <li className="text-sm text-muted">No interactions logged yet.</li>}
        {items.map((i) => (
          <li key={i.id!} className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span><Badge>{i.kind}</Badge> {formatDateTimeIN(i.createdAt)} · {i.createdByName}</span>
              {i.followUpOn && (
                i.completedAt ? <Badge color="green">Follow-up done</Badge> : (
                  <span className="flex items-center gap-2">
                    <Badge color={i.followUpOn < today ? "red" : "amber"}>Follow up {formatDateIN(i.followUpOn)}</Badge>
                    {canEdit && (
                      <button className="text-brand-700 hover:underline" onClick={async () => { await api("POST", `interactions/${i.id}/complete`); router.refresh(); }}>Mark done</button>
                    )}
                  </span>
                )
              )}
            </div>
            <p className="mt-2 whitespace-pre-line text-sm">{i.notes}</p>
          </li>
        ))}
      </ol>
      {canEdit && (
        <form
          className="h-fit space-y-3 rounded-xl border border-line bg-white p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("POST", `parties/${partyId}/interactions`, { kind: f.kind, notes: f.notes, followUpOn: f.followUpOn || null });
              setF({ kind: "call", notes: "", followUpOn: "" });
              toast("success", "Logged");
              router.refresh();
            } catch (err) {
              toast("error", err instanceof ApiError ? err.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="text-sm font-semibold">Log interaction</h3>
          <Field label="Type">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {["call", "visit", "whatsapp", "email", "meeting", "note"].map((k) => <option key={k} value={k}>{k[0]!.toUpperCase() + k.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} required /></Field>
          <Field label="Follow-up date (optional)"><Input type="date" value={f.followUpOn} min={today} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} /></Field>
          <Button type="submit" disabled={busy || !f.notes.trim()} className="w-full">{busy ? "Saving…" : "Save"}</Button>
        </form>
      )}
    </div>
  );
}
