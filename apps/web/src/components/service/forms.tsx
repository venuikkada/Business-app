"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, formatINR, formatIndianPhone } from "@cba/core";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { AsyncCombobox } from "../combobox";
import { Button, Card, Field, Input, Select, Textarea } from "../ui";
import { useToast } from "../client";

type Member = { userId: string; fullName: string };

export function TicketForm({ technicians, amcs }: { technicians: Member[]; amcs: Array<{ id: string; title: string; partyId: string; number: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [key] = useState(newIdempotencyKey);
  const [party, setParty] = useState<{ id: string; name: string } | null>(null);
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ equipment: "", serialNumber: "", issue: "", priority: "normal", assignedTo: "", scheduledAt: "", serviceCharge: "", amcContractId: "", underWarranty: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const partyAmcs = amcs.filter((a) => a.partyId === party?.id);
  return (
    <Card className="max-w-3xl p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" required className="sm:col-span-2">
          <AsyncCombobox ariaLabel="Customer" autoFocus placeholder="Search customer" value={party?.name} endpoint={(q) => `parties?type=customer&pageSize=8&q=${encodeURIComponent(q)}`} map={(r) => ({ id: r.id as string, label: r.name as string, sub: formatIndianPhone(r.phone as string) || undefined, raw: r })} onPick={(it) => setParty({ id: it.id, name: it.label })} />
        </Field>
        <Field label="Product (optional)">
          <AsyncCombobox ariaLabel="Product" placeholder="Search product" value={product?.name} endpoint={(q) => `products?pageSize=8&q=${encodeURIComponent(q)}`} map={(r) => ({ id: r.id as string, label: r.name as string, raw: r })} onPick={(it) => setProduct({ id: it.id, name: it.label })} />
        </Field>
        <Field label="Equipment / location"><Input value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} placeholder="8CH DVR at reception" /></Field>
        <Field label="Serial number" hint="Warranty is checked automatically"><Input value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} /></Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select>
        </Field>
        <Field label="Problem reported" required className="sm:col-span-2"><Textarea value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} /></Field>
        <Field label="Assign technician">
          <Select value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}><option value="">Unassigned</option>{technicians.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>
        </Field>
        <Field label="Visit scheduled"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
        <Field label="Service charge (₹)"><Input inputMode="decimal" value={f.serviceCharge} onChange={(e) => setF({ ...f, serviceCharge: e.target.value })} /></Field>
        {partyAmcs.length > 0 && (
          <Field label="Covered by AMC">
            <Select value={f.amcContractId} onChange={(e) => setF({ ...f, amcContractId: e.target.value })}><option value="">No</option>{partyAmcs.map((a) => <option key={a.id} value={a.id}>{a.number} — {a.title}</option>)}</Select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={f.underWarranty} onChange={(e) => setF({ ...f, underWarranty: e.target.checked })} /> Under warranty (no charge)</label>
      </div>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="mt-4 flex justify-end">
        <Button
          disabled={busy || !party || f.issue.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const t = await api<{ id: string }>("POST", "service/tickets", {
                partyId: party!.id, productId: product?.id ?? null, equipment: f.equipment || null, serialNumber: f.serialNumber || null, issue: f.issue, priority: f.priority,
                assignedTo: f.assignedTo || null, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null, serviceCharge: f.serviceCharge || "0",
                amcContractId: f.amcContractId || null, underWarranty: f.underWarranty,
              }, { idempotencyKey: key });
              toast("success", "Ticket created");
              router.push(`/service/${t.id}`);
            } catch (e) {
              setErr(e instanceof ApiError ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Create ticket"}
        </Button>
      </div>
    </Card>
  );
}

const NEXT: Record<string, Array<[string, string]>> = {
  open: [["in_progress", "Start work"], ["on_hold", "Put on hold"], ["completed", "Complete"], ["cancelled", "Cancel"]],
  assigned: [["in_progress", "Start work"], ["on_hold", "Put on hold"], ["completed", "Complete"], ["cancelled", "Cancel"]],
  in_progress: [["completed", "Complete"], ["on_hold", "Put on hold"], ["cancelled", "Cancel"]],
  on_hold: [["in_progress", "Resume"], ["completed", "Complete"], ["cancelled", "Cancel"]],
};

export function TicketControls({ id, status, assignedTo, technicians, canManage, canInvoice, invoiced }: { id: string; status: string; assignedTo: string | null; technicians: Member[]; canManage: boolean; canInvoice: boolean; invoiced: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [part, setPart] = useState<{ id: string; name: string; price: string } | null>(null);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const done = status === "completed" || status === "cancelled";
  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      await api("PATCH", `service/tickets/${id}`, body);
      toast("success", msg);
      setNote("");
      router.refresh();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {!done && (
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Update</h3>
          {canManage && (
            <Field label="Technician">
              <Select value={assignedTo ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null }, "Assigned")} disabled={busy}>
                <option value="">Unassigned</option>
                {technicians.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Work note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button size="sm" variant="secondary" disabled={busy || !note.trim()} onClick={() => patch({ note }, "Note added")}>Add note</Button>
          <Field label="Resolution (when completing)"><Textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            {(NEXT[status] ?? []).map(([s, l]) => (
              <Button key={s} size="sm" variant={s === "completed" ? "success" : s === "cancelled" ? "danger" : "secondary"} disabled={busy} onClick={() => patch({ status: s, resolution: resolution || undefined, note: note || undefined }, `Ticket ${l.toLowerCase()}`)}>{l}</Button>
            ))}
          </div>
        </Card>
      )}
      {!done && (
        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Add spare part</h3>
          <AsyncCombobox ariaLabel="Spare part" placeholder="Search product" value={part?.name} endpoint={(q) => `products?type=goods&pageSize=8&q=${encodeURIComponent(q)}`} map={(r) => ({ id: r.id as string, label: r.name as string, sub: `${formatINR(r.sellingPrice as string)} · stock ${Number(r.stock)}`, raw: r })} onPick={(it) => setPart({ id: it.id, name: it.label, price: it.raw.sellingPrice as string })} />
          <div className="flex gap-2">
            <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" className="w-24" />
            <Button size="sm" variant="secondary" disabled={!part || busy} onClick={async () => {
              setBusy(true);
              try {
                await api("POST", `service/tickets/${id}/parts`, { productId: part!.id, quantity: qty, unitPrice: part!.price }, { idempotencyKey: newIdempotencyKey() });
                setPart(null);
                router.refresh();
              } catch (e) {
                toast("error", e instanceof ApiError ? e.message : "Failed");
              } finally {
                setBusy(false);
              }
            }}>Add</Button>
          </div>
          <p className="text-xs text-muted">Parts are deducted from stock when the ticket is completed.</p>
        </Card>
      )}
      {status === "completed" && canInvoice && !invoiced && (
        <Button className="w-full" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const inv = await api<{ id: string }>("POST", `service/tickets/${id}/invoice`, { finalize: false }, { idempotencyKey: newIdempotencyKey() });
            router.push(`/documents/invoice/${inv.id}/edit`);
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Failed");
            setBusy(false);
          }
        }}>Create invoice for this job</Button>
      )}
    </div>
  );
}

export function AmcForm({ today }: { today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [key] = useState(newIdempotencyKey);
  const [party, setParty] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ title: "", startDate: today, endDate: addDays(addDays(today, 365), -1), amount: "", visitsIncluded: "4", coveredItems: "", reminderDaysBefore: "30", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card className="max-w-3xl p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" required className="sm:col-span-2">
          <AsyncCombobox ariaLabel="Customer" autoFocus placeholder="Search customer" value={party?.name} endpoint={(q) => `parties?type=customer&pageSize=8&q=${encodeURIComponent(q)}`} map={(r) => ({ id: r.id as string, label: r.name as string, raw: r })} onPick={(it) => setParty({ id: it.id, name: it.label })} />
        </Field>
        <Field label="Contract title" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="CCTV AMC — 16 cameras + NVR" /></Field>
        <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="End date"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Contract value (₹)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Preventive visits included"><Input inputMode="numeric" value={f.visitsIncluded} onChange={(e) => setF({ ...f, visitsIncluded: e.target.value })} /></Field>
        <Field label="Remind before expiry (days)"><Input inputMode="numeric" value={f.reminderDaysBefore} onChange={(e) => setF({ ...f, reminderDaysBefore: e.target.value })} /></Field>
        <Field label="Covered equipment" className="sm:col-span-2"><Textarea rows={2} value={f.coveredItems} onChange={(e) => setF({ ...f, coveredItems: e.target.value })} /></Field>
      </div>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="mt-4 flex justify-end">
        <Button disabled={busy || !party || f.title.trim().length < 2} onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const a = await api<{ id: string }>("POST", "amc", { partyId: party!.id, ...f, amount: f.amount || "0", visitsIncluded: Number(f.visitsIncluded || 0), reminderDaysBefore: Number(f.reminderDaysBefore || 30), coveredItems: f.coveredItems || null, notes: f.notes || null }, { idempotencyKey: key });
            toast("success", "AMC created");
            router.push(`/amc/${a.id}`);
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : "Failed");
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Saving…" : "Create contract"}</Button>
      </div>
    </Card>
  );
}
