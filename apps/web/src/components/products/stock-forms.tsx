"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Button, Field, Input, Select, Textarea } from "../ui";
import { Modal, useToast } from "../client";

export function AdjustStockButton({ productId, productName, branches, trackSerials, canApprove }: { productId: string; productName: string; branches: Array<{ id: string; name: string }>; trackSerials: boolean; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ direction: "add", qty: "", reason: "count_correction", note: "", branchId: branches[0]?.id ?? "", unitCost: "", serials: "", allowNegative: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(approvalId?: string) {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "stock/adjust", {
        productId, branchId: f.branchId || null, quantityDelta: f.direction === "add" ? f.qty : `-${f.qty}`, reason: f.reason, note: f.note || null,
        unitCost: f.unitCost || null, serialNumbers: f.serials.split(/[\s,;]+/).filter(Boolean), allowNegative: f.allowNegative, approvalId: approvalId ?? null,
      }, { idempotencyKey: newIdempotencyKey() });
      toast("success", "Stock updated");
      setOpen(false);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") {
        toast("info", e.message);
        setOpen(false);
      } else setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Adjust stock</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Adjust stock — ${productName}`} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !(Number(f.qty) > 0)} onClick={() => submit()}>{busy ? "Saving…" : "Save"}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Change">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="add">Add stock (inward)</option>
              <option value="remove">Remove stock (outward)</option>
            </Select>
          </Field>
          <Field label="Quantity"><Input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} autoFocus /></Field>
          <Field label="Reason">
            <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
              <option value="count_correction">Physical count correction</option>
              <option value="opening">Opening stock</option>
              <option value="damage">Damaged</option>
              <option value="expired">Expired</option>
              <option value="theft">Lost / theft</option>
              <option value="internal_use">Internal use</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          {branches.length > 1 && (
            <Field label="Branch">
              <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          {f.direction === "add" && <Field label="Unit cost (₹)" hint="Blank = current average cost"><Input inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>}
          {trackSerials && <Field label="Serial numbers" className="sm:col-span-2"><Textarea rows={2} value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} /></Field>}
          <Field label="Note" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          {canApprove && f.direction === "remove" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-brand-600" checked={f.allowNegative} onChange={(e) => setF({ ...f, allowNegative: e.target.checked })} /> Allow stock to go below zero (audited)</label>
          )}
        </div>
        {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
      </Modal>
    </>
  );
}

export function TransferForm({ products, branches }: { products: Array<{ id: string; name: string }>; branches: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ productId: "", fromBranchId: branches[0]?.id ?? "", toBranchId: branches[1]?.id ?? "", quantity: "", note: "", serials: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("POST", "stock/transfer", { ...f, note: f.note || null, serialNumbers: f.serials.split(/[\s,;]+/).filter(Boolean) }, { idempotencyKey: newIdempotencyKey() });
          toast("success", "Stock transferred");
          setF({ ...f, quantity: "", note: "", serials: "" });
          router.refresh();
        } catch (err) {
          toast("error", err instanceof ApiError ? err.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Product" className="sm:col-span-2">
        <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} required>
          <option value="">Select product</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="From"><Select value={f.fromBranchId} onChange={(e) => setF({ ...f, fromBranchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <Field label="To"><Select value={f.toBranchId} onChange={(e) => setF({ ...f, toBranchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <Field label="Quantity"><Input inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></Field>
      <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <Field label="Serial numbers (for serial-tracked items)" className="sm:col-span-2"><Input value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Button type="submit" disabled={busy || !f.productId || f.fromBranchId === f.toBranchId}>{busy ? "Transferring…" : "Transfer"}</Button></div>
    </form>
  );
}
