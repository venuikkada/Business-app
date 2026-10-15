"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Button, Field, Input, Select } from "../ui";
import { Modal, useToast } from "../client";

type Acc = { id: string; name: string };

export function CashbookActions({ accounts, today }: { accounts: Acc[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<null | "account" | "transfer" | "entry">(null);
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState({ name: "", type: "bank", openingBalance: "", accountNumberLast4: "" });
  const [tr, setTr] = useState({ fromAccountId: accounts[0]?.id ?? "", toAccountId: accounts[1]?.id ?? "", amount: "", txnDate: today, notes: "" });
  const [en, setEn] = useState({ accountId: accounts[0]?.id ?? "", direction: "in", amount: "", txnDate: today, category: "Owner capital", notes: "" });
  async function go(path: string, body: unknown) {
    setBusy(true);
    try {
      await api("POST", path, body, { idempotencyKey: newIdempotencyKey() });
      toast("success", "Saved");
      setMode(null);
      router.refresh();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setMode("entry")}>Add money in/out</Button>
      <Button variant="secondary" onClick={() => setMode("transfer")} disabled={accounts.length < 2}>Transfer</Button>
      <Button onClick={() => setMode("account")}>New account</Button>
      <Modal open={mode === "account"} onClose={() => setMode(null)} title="New cash / bank account" footer={<Button disabled={busy || !a.name} onClick={() => go("accounts", { ...a, openingBalance: a.openingBalance || "0", accountNumberLast4: a.accountNumberLast4 || null })}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="HDFC Current A/c" /></Field>
          <Field label="Type"><Select value={a.type} onChange={(e) => setA({ ...a, type: e.target.value })}><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI wallet</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
          <Field label="Opening balance (₹)"><Input inputMode="decimal" value={a.openingBalance} onChange={(e) => setA({ ...a, openingBalance: e.target.value })} /></Field>
          <Field label="Last 4 digits" hint="Never store full account numbers here"><Input inputMode="numeric" maxLength={4} value={a.accountNumberLast4} onChange={(e) => setA({ ...a, accountNumberLast4: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={mode === "transfer"} onClose={() => setMode(null)} title="Transfer between accounts" footer={<Button disabled={busy || !(Number(tr.amount) > 0)} onClick={() => go("accounts/transfer", { ...tr, notes: tr.notes || null })}>Transfer</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><Select value={tr.fromAccountId} onChange={(e) => setTr({ ...tr, fromAccountId: e.target.value })}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="To"><Select value={tr.toAccountId} onChange={(e) => setTr({ ...tr, toAccountId: e.target.value })}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Amount (₹)"><Input inputMode="decimal" value={tr.amount} onChange={(e) => setTr({ ...tr, amount: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={tr.txnDate} onChange={(e) => setTr({ ...tr, txnDate: e.target.value })} /></Field>
          <Field label="Note" className="sm:col-span-2"><Input value={tr.notes} onChange={(e) => setTr({ ...tr, notes: e.target.value })} placeholder="Cash deposited in bank" /></Field>
        </div>
      </Modal>
      <Modal open={mode === "entry"} onClose={() => setMode(null)} title="Other money in / out" footer={<Button disabled={busy || !(Number(en.amount) > 0)} onClick={() => go("accounts/entry", { ...en, notes: en.notes || null })}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account"><Select value={en.accountId} onChange={(e) => setEn({ ...en, accountId: e.target.value })}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Direction"><Select value={en.direction} onChange={(e) => setEn({ ...en, direction: e.target.value, category: e.target.value === "in" ? "Owner capital" : "Owner withdrawal" })}><option value="in">Money in</option><option value="out">Money out</option></Select></Field>
          <Field label="Amount (₹)"><Input inputMode="decimal" value={en.amount} onChange={(e) => setEn({ ...en, amount: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={en.txnDate} onChange={(e) => setEn({ ...en, txnDate: e.target.value })} /></Field>
          <Field label="Category" hint="e.g. Owner capital, Loan received, Interest income, Owner withdrawal"><Input value={en.category} onChange={(e) => setEn({ ...en, category: e.target.value })} /></Field>
          <Field label="Note"><Input value={en.notes} onChange={(e) => setEn({ ...en, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
