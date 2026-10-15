"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@cba/core";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Button, Card, Field, Input, Select, Textarea } from "../ui";
import { Modal, useToast } from "../client";

export function ExpenseForm({ categories: initialCats, accounts, today }: { categories: Array<{ id: string; name: string }>; accounts: Array<{ id: string; name: string }>; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [key] = useState(newIdempotencyKey);
  const [cats, setCats] = useState(initialCats);
  const [f, setF] = useState({ categoryId: initialCats[0]?.id ?? "", amount: "", taxAmount: "", expenseDate: today, method: "cash", accountId: "", reference: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);

  async function submit(confirmDuplicate = false) {
    setBusy(true);
    setErr(null);
    try {
      let attachmentId: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("purpose", "expense_receipt");
        attachmentId = (await api<{ id: string }>("POST", "files", fd)).id;
      }
      await api("POST", "expenses", { ...f, taxAmount: f.taxAmount || "0", accountId: f.accountId || null, reference: f.reference || null, notes: f.notes || null, attachmentId, confirmDuplicate }, { idempotencyKey: confirmDuplicate ? newIdempotencyKey() : key });
      toast("success", "Expense saved");
      router.push("/expenses");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "POSSIBLE_DUPLICATE") setDup(e.message);
      else setErr(e instanceof ApiError ? e.message : "Network problem");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-2xl p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          <div className="flex gap-2">
            <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Button type="button" variant="secondary" onClick={async () => {
              const name = prompt("New expense category");
              if (!name?.trim()) return;
              try {
                const c = await api<{ id: string; name: string }>("POST", "expense-categories", { name: name.trim() });
                setCats([...cats, c]);
                setF({ ...f, categoryId: c.id });
              } catch (e) {
                toast("error", e instanceof ApiError ? e.message : "Failed");
              }
            }}>+</Button>
          </div>
        </Field>
        <Field label="Date" required><Input type="date" value={f.expenseDate} max={today} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></Field>
        <Field label="Total paid (₹)" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="GST included in total (₹)" hint="For input tax summary, if you have a GST bill"><Input inputMode="decimal" value={f.taxAmount} onChange={(e) => setF({ ...f, taxAmount: e.target.value })} /></Field>
        <Field label="Paid by">
          <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
          </Select>
        </Field>
        <Field label="From account">
          <Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Default</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Bill / reference no."><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Receipt photo / PDF" hint="JPG, PNG, WEBP or PDF up to 5 MB">
          <input type="file" accept="image/*,application/pdf" capture="environment" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="mt-4 flex justify-end"><Button disabled={busy || !(Number(f.amount) > 0) || !f.categoryId} onClick={() => submit(false)}>{busy ? "Saving…" : "Save expense"}</Button></div>
      <Modal open={!!dup} onClose={() => setDup(null)} title="Possible duplicate" footer={<><Button variant="ghost" onClick={() => setDup(null)}>Don&apos;t save</Button><Button onClick={() => { setDup(null); submit(true); }}>Save anyway</Button></>}>
        <p className="text-sm">{dup}</p>
      </Modal>
    </Card>
  );
}
