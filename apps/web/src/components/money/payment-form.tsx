"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { D, formatDateIN, formatINR, DOC_TYPE_META, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type DocType } from "@cba/core";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { AsyncCombobox } from "../combobox";
import { useToast } from "../client";
import { Button, Card, CardHeader, Field, Input, Select, Table, Td, Th, Textarea } from "../ui";

interface Open { id: string; docType: string; number: string; issueDate: string; dueDate: string | null; grandTotal: string; balanceDue: string }

export function PaymentForm({ direction, today, party: initialParty, documentId, accounts }: { direction: "in" | "out"; today: string; party: { id: string; name: string } | null; documentId?: string; accounts: Array<{ id: string; name: string; type: string; isDefault: boolean }> }) {
  const router = useRouter();
  const toast = useToast();
  const [key] = useState(newIdempotencyKey);
  const [party, setParty] = useState(initialParty);
  const [open, setOpen] = useState<Open[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [f, setF] = useState({ amount: "", method: "cash", accountId: "", paidOn: today, reference: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!party) return;
    api<Open[]>("GET", `parties/${party.id}/unpaid?direction=${direction}`).then((rows) => {
      setOpen(rows);
      if (documentId) {
        const d = rows.find((r) => r.id === documentId);
        if (d) {
          setAlloc({ [d.id]: d.balanceDue });
          setF((x) => ({ ...x, amount: x.amount || d.balanceDue }));
        }
      }
    });
  }, [party, direction, documentId]);

  const allocated = Object.values(alloc).reduce((a, v) => a.add(v || 0), new D(0));
  const unallocated = new D(f.amount || 0).sub(allocated);
  const autoAllocate = () => {
    let left = new D(f.amount || 0);
    const next: Record<string, string> = {};
    for (const o of open) {
      if (left.lte(0)) break;
      const a = D.min(left, new D(o.balanceDue));
      next[o.id] = a.toFixed(2);
      left = left.sub(a);
    }
    setAlloc(next);
  };
  const methodAccount = (m: string) => accounts.find((a) => a.isDefault && a.type === (m === "cash" ? "cash" : "bank"))?.id ?? "";

  async function submit() {
    setErr(null);
    if (!party) return setErr("Select a customer/supplier");
    if (unallocated.lt(0)) return setErr("Allocated more than the payment amount");
    setBusy(true);
    try {
      const p = await api<{ id: string }>("POST", "payments", {
        direction, partyId: party.id, amount: f.amount, method: f.method, accountId: f.accountId || null, paidOn: f.paidOn, reference: f.reference || null, notes: f.notes || null,
        allocations: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([documentId, amount]) => ({ documentId, amount })),
      }, { idempotencyKey: key });
      toast("success", direction === "in" ? "Payment received" : "Payment recorded");
      router.push(`/payments/${p.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") toast("info", e.message);
      setErr(e instanceof ApiError ? e.message : "Network problem");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label={direction === "in" ? "Received from" : "Paid to"} required className="sm:col-span-2">
            <AsyncCombobox
              ariaLabel="Party"
              value={party?.name}
              autoFocus={!party}
              placeholder="Search customer or supplier"
              endpoint={(q) => `parties?pageSize=8&q=${encodeURIComponent(q)}`}
              map={(r) => ({ id: r.id as string, label: r.name as string, sub: `Balance ${formatINR(r.balance as string)}`, raw: r })}
              onPick={(it) => { setParty({ id: it.id, name: it.label }); setAlloc({}); }}
            />
          </Field>
          <Field label="Amount (₹)" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" required><Input type="date" value={f.paidOn} max={today} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
          <Field label="Mode">
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value, accountId: methodAccount(e.target.value) })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
          <Field label="Into / from account" hint="Blank = default cash or bank account">
            <Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
              <option value="">Default</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Reference" hint="UPI ref / cheque no. / UTR"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Notes"><Textarea rows={1} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </Card>
        {party && (
          <Card>
            <CardHeader title="Adjust against" subtitle="Settle specific bills. Anything left over is kept as an advance." action={open.length ? <Button size="sm" variant="secondary" onClick={autoAllocate} disabled={!Number(f.amount)}>Oldest first</Button> : undefined} />
            {open.length ? (
              <Table>
                <thead><tr><Th>Document</Th><Th>Due</Th><Th align="right">Balance</Th><Th align="right">Adjust ₹</Th></tr></thead>
                <tbody>
                  {open.map((o) => (
                    <tr key={o.id}>
                      <Td>{DOC_TYPE_META[o.docType as DocType].label} {o.number}<div className="text-xs text-muted">{formatDateIN(o.issueDate)}</div></Td>
                      <Td className={o.dueDate && o.dueDate < today ? "text-red-700" : ""}>{formatDateIN(o.dueDate)}</Td>
                      <Td align="right">{formatINR(o.balanceDue)}</Td>
                      <Td align="right">
                        <input className="w-28 rounded-lg border border-line px-2 py-1 text-right" inputMode="decimal" value={alloc[o.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [o.id]: e.target.value })} aria-label={`Adjust against ${o.number}`} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="p-5 text-sm text-muted">No unpaid {direction === "in" ? "invoices" : "bills"}. This will be recorded as an advance.</p>
            )}
          </Card>
        )}
      </div>
      <Card className="h-fit p-5">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted">Amount</span><span className="tabular">{formatINR(f.amount || 0)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Adjusted</span><span className="tabular">{formatINR(allocated.toFixed(2))}</span></div>
          <div className="flex justify-between font-medium"><span>{unallocated.lt(0) ? "Over-allocated" : "Advance / unadjusted"}</span><span className={unallocated.lt(0) ? "text-red-700" : ""}>{formatINR(unallocated.toFixed(2))}</span></div>
        </div>
        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Button size="lg" className="mt-4 w-full" disabled={busy || !party || !(Number(f.amount) > 0)} onClick={submit}>{busy ? "Saving…" : direction === "in" ? "Save receipt" : "Save payment"}</Button>
      </Card>
    </div>
  );
}
