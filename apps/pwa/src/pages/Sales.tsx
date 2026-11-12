import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { calculateDocument } from "@cba/core";
import { ArrowLeft, Ban, Download, FileText, IndianRupee, MessageCircle, Plus, ReceiptText, RefreshCw, Search, Share2, Trash2 } from "lucide-react";
import { post } from "../lib/api";
import { date, inr } from "../lib/format";
import { canSharePdf, downloadPdf, sharePdf, useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { useErrorText } from "../i18n";
import { Banner, Empty, Input, Loading, Modal, Num, PageHead, Select, StatusBadge } from "../components/ui";

type DocType = "invoice" | "quotation";
const LABEL = { invoice: "Invoice", quotation: "Quotation" } as const;
const GST = [0, 5, 12, 18, 28, 40, 3, 0.25];
const MODES = [["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank transfer"], ["card", "Card"], ["cheque", "Cheque"]];

/* ---------------- list ---------------- */
export function SalesList({ docType }: { docType: DocType }) {
  const nav = useNavigate();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const q = new URLSearchParams({ docType, ...(search ? { search } : {}), ...(status ? { status } : {}) });
  const { data, error } = useLoad<any[]>(`/sales?${q}`);
  const total = (data ?? []).filter((d) => d.status !== "cancelled").reduce((a, d) => a + Number(d.grandTotal), 0);
  return (
    <div>
      <PageHead title={`${LABEL[docType]}s`} sub={data ? `${data.length} shown · ${inr(total)}` : undefined}>
        {can("sales.create") && <Link className="btn primary" to={`/${docType}s/new`}><Plus className="ic" />New {LABEL[docType].toLowerCase()}</Link>}
      </PageHead>
      <div className="toolbar">
        <div className="search"><Search className="ic" /><input placeholder="Search number or customer" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option>
          {docType === "invoice" ? <><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></> : <><option value="sent">Open</option><option value="converted">Invoiced</option></>}
        </select>
      </div>
      <Banner>{error}</Banner>
      <div className="card flush">
        {!data ? <Loading /> : data.length === 0 ? (
          <Empty icon={docType === "invoice" ? <ReceiptText /> : <FileText />} title={`No ${LABEL[docType].toLowerCase()}s found`} text={docType === "invoice" ? "Bills you create appear here with payment status." : "Send a price quote, then convert it to an invoice in one tap."} />
        ) : (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th className="num">Amount</th>{docType === "invoice" && <th className="num">Balance</th>}<th>Status</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="click" onClick={() => nav(`/sales/${d.id}`)}>
                  <td><b>{d.number}</b></td><td>{d.customer?.name}</td><td>{date(d.docDate)}</td><td className="num"><b>{inr(d.grandTotal)}</b></td>
                  {docType === "invoice" && <td className="num">{Number(d.balanceDue) > 0 ? inr(d.balanceDue) : "—"}</td>}
                  <td><StatusBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

/* ---------------- editor ---------------- */
interface Line { variantId: number | null; description: string; hsn: string | null; unit: string; qty: number; rate: number; discountPct: number; gstRate: number }
const blank = (): Line => ({ variantId: null, description: "", hsn: null, unit: "NOS", qty: 1, rate: 0, discountPct: 0, gstRate: 0 });

function ItemPicker({ items, value, onPick, onText }: { items: any[]; value: string; onPick: (i: any) => void; onText: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = value.trim().toLowerCase();
    return items.filter((i) => i.isActive && (!s || i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s) || i.barcode === value.trim())).slice(0, 8);
  }, [items, value]);
  return (
    <div className="picker">
      <input placeholder="Type item name, code or scan barcode" value={value} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && matches.length === 1) { e.preventDefault(); onPick(matches[0]); setOpen(false); } }} />
      {open && matches.length > 0 && (
        <ul>{matches.map((i) => (
          <li key={i.id} onMouseDown={() => { onPick(i); setOpen(false); }}>
            <span><b>{i.name}</b> <span className="muted small">{i.sku}{i.trackStock ? ` · ${Number(i.qty)} ${i.unit} in stock` : ""}</span></span><span className="num">{inr(i.salePrice)}</span>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

export function DocEditor({ docType }: { docType: DocType }) {
  const nav = useNavigate();
  const errText = useErrorText();
  const { current } = useSession();
  const { data: items } = useLoad<any[]>("/items?limit=500");
  const { data: parties, reload: reloadParties } = useLoad<any[]>("/parties?type=customer&limit=500");
  const [partyId, setPartyId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [incl, setIncl] = useState(true);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [paid, setPaid] = useState(0);
  const [mode, setMode] = useState("cash");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCust, setNewCust] = useState(false);
  const registered = !!current!.tenant.gstin;
  const party = parties?.find((p) => p.id === partyId);
  const inter = !!party?.stateCode && party.stateCode !== current!.tenant.stateCode;
  const good = lines.filter((l) => l.description.trim() && l.qty > 0);

  const calc = useMemo(() => {
    if (!good.length) return null;
    try {
      return calculateDocument({
        lines: good.map((l) => ({ quantity: l.qty, unitPrice: l.rate, discountType: "percent", discountValue: l.discountPct, taxRate: registered ? l.gstRate : 0 })),
        pricesIncludeTax: incl, isInterState: inter, documentDiscountType: "amount", documentDiscountValue: discount, roundOff: true,
      });
    } catch { return null; }
  }, [good, incl, inter, discount, registered]);

  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, it: any) => {
    const next = lines.map((l, j) => (j === i ? { ...l, variantId: it.variantId, description: it.name, hsn: it.hsn, unit: it.unit, rate: Number(it.salePrice), gstRate: it.gstRate } : l));
    setLines(i === lines.length - 1 ? [...next, blank()] : next);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!good.length) return setError("Add at least one item.");
    setBusy(true);
    setError("");
    try {
      const d = await post("/sales", {
        docType, partyId: partyId || null, customerName: name || null, customerMobile: mobile || null, priceIncludesTax: incl, discount, notes: notes || null,
        lines: good.map((l) => ({ ...l, hsn: l.hsn || null })), payment: docType === "invoice" && paid > 0 ? { amount: paid, mode } : null,
      });
      nav(`/sales/${d.id}`, { replace: true });
    } catch (e2) { setError(errText(e2)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="stack">
      <PageHead title={`New ${LABEL[docType].toLowerCase()}`} sub={registered ? (inter ? "Other state customer → IGST" : "Same state → CGST + SGST") : "No GSTIN in Settings → bill without GST"}>
        <button type="button" className="btn" onClick={() => nav(-1)}><ArrowLeft className="ic" />Back</button>
      </PageHead>
      <Banner>{error}</Banner>
      <div className="card stack">
        <h2>Customer</h2>
        <div className="grid3">
          <Select label="Saved customer" value={partyId} onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Walk-in / cash customer</option>
            {parties?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.mobile ? ` · ${p.mobile}` : ""}</option>)}
          </Select>
          {partyId === "" ? <>
            <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cash customer" />
            <Input label="Mobile (optional)" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </> : <div className="field"><span>Details</span><div className="muted small" style={{ paddingTop: 8 }}>{[party?.gstin && `GSTIN ${party.gstin}`, party?.billingAddress].filter(Boolean).join(" · ") || "No GSTIN (B2C)"}</div></div>}
        </div>
        <button type="button" className="linkbtn small" onClick={() => setNewCust(true)}>+ Add a new customer</button>
      </div>

      <div className="card stack">
        <div className="spread"><h2 style={{ margin: 0 }}>Items</h2>
          <label className="check small"><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /> Prices include GST</label></div>
        <div className="lines head-on">
          {lines.map((l, i) => (
            <div className="line" key={i}>
              <label className="field desc"><span>Item</span><ItemPicker items={items ?? []} value={l.description} onPick={(it) => pick(i, it)} onText={(s) => set(i, { description: s, variantId: null })} /></label>
              <Num label="Qty" step="0.001" value={l.qty} onChange={(v) => set(i, { qty: v })} />
              <Num label="Rate ₹" value={l.rate} onChange={(v) => set(i, { rate: v })} />
              <Num label="Disc %" value={l.discountPct} onChange={(v) => set(i, { discountPct: Math.min(100, v) })} />
              <label className="field"><span>GST %</span><select value={l.gstRate} disabled={!registered} onChange={(e) => set(i, { gstRate: Number(e.target.value) })}>{GST.map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
              <div className="field"><span>Amount</span><div className="num" style={{ padding: "10px 0", fontWeight: 650 }}>{inr(l.qty * l.rate * (1 - l.discountPct / 100))}</div></div>
              <button type="button" className="iconbtn x" style={{ width: 34, height: 34, border: 0, background: "none", color: "var(--muted)" }} aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blank()])}><Trash2 className="ic" /></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn small" onClick={() => setLines([...lines, blank()])}><Plus className="ic" />Add line</button>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <label className="field"><span>Notes (printed on the {LABEL[docType].toLowerCase()})</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Warranty, delivery, bank details…" /></label>
          {docType === "invoice" && <>
            <h2 style={{ marginBottom: 0 }}>Payment received now</h2>
            <div className="grid2">
              <Num label="Amount ₹" value={paid} onChange={setPaid} />
              <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </div>
            <div className="row">
              <button type="button" className="btn small" onClick={() => setPaid(Number(calc?.grandTotal ?? 0))}>Full amount</button>
              <button type="button" className="btn small" onClick={() => setPaid(0)}>Credit (pay later)</button>
            </div>
          </>}
        </div>
        <div className="card">
          <div className="totals">
            <div><span className="muted">Subtotal</span><span>{inr(calc?.grossTotal ?? 0)}</span></div>
            <Num label="Extra discount ₹" value={discount} onChange={setDiscount} />
            {calc && Number(calc.discountTotal) > 0 && <div><span className="muted">Discount</span><span>− {inr(calc.discountTotal)}</span></div>}
            {calc && Number(calc.taxTotal) > 0 && <div><span className="muted">Taxable value</span><span>{inr(calc.taxableTotal)}</span></div>}
            {calc && Number(calc.cgstTotal) > 0 && <><div><span className="muted">CGST</span><span>{inr(calc.cgstTotal)}</span></div><div><span className="muted">SGST</span><span>{inr(calc.sgstTotal)}</span></div></>}
            {calc && Number(calc.igstTotal) > 0 && <div><span className="muted">IGST</span><span>{inr(calc.igstTotal)}</span></div>}
            {calc && Number(calc.roundOff) !== 0 && <div><span className="muted">Round off</span><span>{calc.roundOff}</span></div>}
            <div className="grand"><span>Total</span><span>{inr(calc?.grandTotal ?? 0)}</span></div>
            {docType === "invoice" && calc && <div><span className="muted">Balance after payment</span><span>{inr(Math.max(0, Number(calc.grandTotal) - paid))}</span></div>}
          </div>
          <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy || !calc}>{busy ? "Saving…" : `Save ${LABEL[docType].toLowerCase()}`}</button>
        </div>
      </div>
      {newCust && <QuickCustomer onClose={() => setNewCust(false)} onDone={async (p) => { await reloadParties(); setPartyId(p.id); setNewCust(false); }} />}
    </form>
  );
}

function QuickCustomer({ onClose, onDone }: { onClose: () => void; onDone: (p: any) => void }) {
  const errText = useErrorText();
  const [f, setF] = useState({ name: "", mobile: "", gstin: "", billingAddress: "" });
  const [error, setError] = useState("");
  const save = async () => {
    try { onDone(await post("/parties", { ...f, partyType: "customer" })); } catch (e) { setError(errText(e)); }
  };
  return (
    <Modal title="New customer" onClose={onClose}>
      <div className="stack">
        <Banner>{error}</Banner>
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        <Input label="Mobile" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
        <Input label="GSTIN (for B2B bills)" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        <Input label="Address" value={f.billingAddress} onChange={(e) => setF({ ...f, billingAddress: e.target.value })} />
        <button type="button" className="btn primary block" onClick={save} disabled={!f.name.trim()}>Save customer</button>
      </div>
    </Modal>
  );
}

/* ---------------- view ---------------- */
export function DocView() {
  const { id } = useParams();
  const nav = useNavigate();
  const errText = useErrorText();
  const { current, can } = useSession();
  const { data: d, error, setData } = useLoad<any>(`/sales/${id}`);
  const [pay, setPay] = useState(false);
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState("cash");
  const [msg, setMsg] = useState("");
  if (!d) return error ? <Banner>{error}</Banner> : <Loading />;
  const isInv = d.docType === "invoice";
  const run = async (fn: () => Promise<any>) => { setMsg(""); try { const out = await fn(); if (out?.id) setData(out); return out; } catch (e) { setMsg(errText(e)); } };
  const taxed = Number(d.cgst) + Number(d.sgst) + Number(d.igst) > 0;
  const tn = current!.tenant;
  // Full bill as a WhatsApp message: every item, quantity, rate, GST and the totals.
  const text = [
    `*${tn.name}*`,
    [tn.addressLine1, tn.city].filter(Boolean).join(", "),
    tn.gstin ? `GSTIN: ${tn.gstin}` : null,
    "",
    `*${isInv ? (taxed ? "TAX INVOICE" : "INVOICE") : "QUOTATION"}*  ${d.number}`,
    `Date: ${date(d.docDate)}`,
    d.validUntil ? `Valid until: ${date(d.validUntil)}` : null,
    `Customer: ${d.customer?.name ?? ""}`,
    d.customer?.gstin ? `Customer GSTIN: ${d.customer.gstin}` : null,
    "",
    "*Items*",
    ...d.lines.flatMap((l: any, i: number) => [
      `${i + 1}. ${l.description}${l.hsn ? ` (HSN ${l.hsn})` : null}`,
      `     ${Number(l.qty)} ${l.unit} x ${inr(l.rate)}${Number(l.discountPct) ? `, less ${Number(l.discountPct)}%` : null}${Number(l.gstRate) ? `, GST ${Number(l.gstRate)}%` : null} = *${inr(l.total)}*`,
    ]),
    "",
    Number(d.discountTotal) > 0 ? `Discount: - ${inr(d.discountTotal)}` : null,
    taxed ? `Taxable value: ${inr(d.taxableTotal)}` : null,
    Number(d.cgst) > 0 ? `CGST: ${inr(d.cgst)}` : null,
    Number(d.sgst) > 0 ? `SGST: ${inr(d.sgst)}` : null,
    Number(d.igst) > 0 ? `IGST: ${inr(d.igst)}` : null,
    `*Total: ${inr(d.grandTotal)}*`,
    isInv ? `Paid: ${inr(d.amountPaid)}` : null,
    isInv ? (Number(d.balanceDue) > 0 ? `*Balance due: ${inr(d.balanceDue)}*` : "Fully paid ✅") : null,
    d.notes ? `\nNote: ${d.notes}` : null,
    "",
    tn.phone ? `Thank you! For any help call ${tn.phone}.` : "Thank you for your business!",
  ].filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n");
  const waNumber = d.customer?.mobile ? d.customer.mobile.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1") : "";
  const wa = `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;
  return (
    <div className="stack">
      <PageHead title={`${LABEL[d.docType as DocType]} ${d.number}`} sub={`${date(d.docDate)} · ${d.customer?.name}`}>
        <button className="btn" onClick={() => nav(isInv ? "/invoices" : "/quotations")}><ArrowLeft className="ic" />Back</button>
        <button className="btn" onClick={() => run(() => downloadPdf(`/sales/${d.id}/pdf`, d.number))}><Download className="ic" />PDF</button>
        <a className="btn wa" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="ic" />WhatsApp bill</a>
        {canSharePdf() && <button className="btn" onClick={() => run(() => sharePdf(`/sales/${d.id}/pdf`, d.number, text))}><Share2 className="ic" />Share PDF</button>}
        {isInv && d.status !== "cancelled" && Number(d.balanceDue) > 0 && can("payments.create") && <button className="btn success" onClick={() => { setAmount(Number(d.balanceDue)); setPay(true); }}><IndianRupee className="ic" />Receive payment</button>}
        {!isInv && d.status === "sent" && can("sales.create") && <button className="btn primary" onClick={async () => { const inv = await run(() => post(`/sales/${d.id}/convert`)); if (inv?.id) nav(`/sales/${inv.id}`); }}><RefreshCw className="ic" />Convert to invoice</button>}
        {d.status !== "cancelled" && d.status !== "converted" && can("sales.cancel") && <button className="btn danger" onClick={() => { const r = prompt("Reason for cancelling?"); if (r && r.trim().length >= 3) run(() => post(`/sales/${d.id}/cancel`, { reason: r })); }}><Ban className="ic" />Cancel</button>}
      </PageHead>
      <Banner>{msg}</Banner>
      <div className="paper stack">
        <div className="paper-band" />
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <div><b style={{ fontSize: "1.15rem" }}>{current!.tenant.name}</b><div className="muted small">{[current!.tenant.addressLine1, current!.tenant.city].filter(Boolean).join(", ")}</div>{current!.tenant.gstin && <div className="muted small">GSTIN {current!.tenant.gstin}</div>}</div>
          <div style={{ textAlign: "right" }}><div className="doc-title">{isInv ? "INVOICE" : "QUOTATION"}</div><div><b>{d.number}</b></div><StatusBadge status={d.status} /></div>
        </div>
        <div className="grid2">
          <div><div className="muted small">BILL TO</div><b>{d.customer?.name}</b><div className="muted small">{[d.customer?.mobile, d.customer?.gstin && `GSTIN ${d.customer.gstin}`, d.customer?.address].filter(Boolean).join(" · ")}</div></div>
          <div style={{ textAlign: "right" }} className="small"><div><span className="muted">Date:</span> {date(d.docDate)}</div>{d.validUntil && <div><span className="muted">Valid until:</span> {date(d.validUntil)}</div>}<div><span className="muted">Supply:</span> {d.supplyType}</div></div>
        </div>
        <div className="scroll-x"><table className="table">
          <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr></thead>
          <tbody>{d.lines.map((l: any, i: number) => (
            <tr key={i}><td>{i + 1}</td><td>{l.description}{l.hsn && <div className="muted small">HSN {l.hsn}</div>}</td><td className="num">{Number(l.qty)} {l.unit}</td><td className="num">{inr(l.rate)}</td><td className="num">{Number(l.gstRate)}%</td><td className="num"><b>{inr(l.total)}</b></td></tr>
          ))}</tbody>
        </table></div>
        <div className="totals">
          <div><span className="muted">Taxable value</span><span>{inr(d.taxableTotal)}</span></div>
          {Number(d.cgst) > 0 && <><div><span className="muted">CGST</span><span>{inr(d.cgst)}</span></div><div><span className="muted">SGST</span><span>{inr(d.sgst)}</span></div></>}
          {Number(d.igst) > 0 && <div><span className="muted">IGST</span><span>{inr(d.igst)}</span></div>}
          {Number(d.roundOff) !== 0 && <div><span className="muted">Round off</span><span>{d.roundOff}</span></div>}
          <div className="grand"><span>Total</span><span>{inr(d.grandTotal)}</span></div>
          {isInv && <><div><span className="muted">Paid</span><span>{inr(d.amountPaid)}</span></div><div><b>Balance due</b><b>{inr(d.balanceDue)}</b></div></>}
        </div>
        {d.notes && <div className="small"><span className="muted">Notes: </span>{d.notes}</div>}
      </div>
      {isInv && d.payments.length > 0 && (
        <div className="card flush"><table className="table">
          <thead><tr><th>Receipt</th><th>Date</th><th>Mode</th><th className="num">Amount</th></tr></thead>
          <tbody>{d.payments.map((p: any) => <tr key={p.id}><td>{p.number} {p.status === "void" && <span className="badge gray">Void</span>}</td><td>{date(p.date)}</td><td style={{ textTransform: "uppercase" }}>{p.mode}{p.reference ? ` · ${p.reference}` : ""}</td><td className="num">{inr(p.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
      {pay && (
        <Modal title="Receive payment" onClose={() => setPay(false)}>
          <div className="stack">
            <Num label={`Amount ₹ (balance ${inr(d.balanceDue)})`} value={amount} onChange={setAmount} />
            <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <button className="btn success block" onClick={async () => { const out = await run(() => post(`/sales/${d.id}/payments`, { amount, mode })); if (out) setPay(false); }}>Save payment</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
