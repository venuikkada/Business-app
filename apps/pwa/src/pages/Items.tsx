import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, Package, Plus, Search } from "lucide-react";
import { del, patch, post } from "../lib/api";
import { inr } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { useErrorText } from "../i18n";
import { Banner, Empty, Input, Loading, Modal, Num, PageHead, Select } from "../components/ui";

const GST = [0, 5, 12, 18, 28, 40, 3, 0.25];
const REASONS: Record<string, [string, string][]> = {
  in: [["purchase", "Purchase / received"], ["opening", "Opening stock"], ["other", "Other"]],
  out: [["damaged", "Damaged"], ["expired", "Expired"], ["lost", "Lost"], ["theft", "Theft"], ["sample", "Free sample"], ["own_use", "Own use"], ["other", "Other"]],
  set: [["count_correction", "Physical count"]],
};

/** Items list. In "stock" mode it shows quantities with Stock in / out / count buttons. */
export function Items({ mode }: { mode: "items" | "stock" }) {
  const { can, current } = useSession();
  const [search, setSearch] = useState("");
  const [low, setLow] = useState(false);
  const [branchId, setBranchId] = useState("");
  const q = new URLSearchParams({ ...(search ? { search } : {}), ...(low ? { low: "1" } : {}), ...(mode === "stock" ? { stockOnly: "1" } : {}), ...(branchId ? { branchId } : {}) });
  const { data, error, reload } = useLoad<any[]>(`/items?${q}`);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [entry, setEntry] = useState<{ item: any; mode: "in" | "out" | "set" } | null>(null);
  const stock = mode === "stock";
  const value = (data ?? []).reduce((a, i) => a + Number(i.stockValue ?? 0), 0);

  return (
    <div>
      <PageHead title={stock ? "Stock" : "Items"} sub={data ? `${data.length} items${stock && can("financials.view") ? ` · stock value ${inr(value)}` : ""}` : undefined}>
        {can("items.create") && <button className="btn primary" onClick={() => setEdit("new")}><Plus className="ic" />Add item</button>}
      </PageHead>
      <div className="toolbar">
        <div className="search"><Search className="ic" /><input placeholder="Search name, code or barcode" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {stock && current!.branches.length > 1 && (
          <select style={{ width: "auto" }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
            <option value="">All branches</option>{current!.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {stock && <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>}
      </div>
      <Banner>{error}</Banner>
      <div className="card flush">
        {!data ? <Loading /> : data.length === 0 ? (
          <Empty icon={stock ? <Boxes /> : <Package />} title="No items yet" text="Add the products or services you sell. Stock is counted automatically when you bill.">
            {can("items.create") && <button className="btn primary small" onClick={() => setEdit("new")}>Add your first item</button>}
          </Empty>
        ) : (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Item</th><th className="num">Price</th>{!stock && <th className="num">GST</th>}<th className="num">In stock</th>{stock && <th />}</tr></thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id} className={!stock && can("items.edit") ? "click" : ""} onClick={() => !stock && can("items.edit") && setEdit(i)}>
                  <td><b>{i.name}</b> {!i.isActive && <span className="badge gray">Inactive</span>}<div className="muted small">{i.sku}{i.hsn ? ` · HSN ${i.hsn}` : ""}{i.category ? ` · ${i.category}` : ""}</div></td>
                  <td className="num">{inr(i.salePrice)}</td>
                  {!stock && <td className="num">{i.gstRate}%</td>}
                  <td className="num">{i.trackStock ? <span className={`badge ${i.isLow ? "bad" : Number(i.qty) > 0 ? "ok" : "gray"}`}>{Number(i.qty)} {i.unit}</span> : <span className="muted small">Service</span>}</td>
                  {stock && <td className="num">{can("stock.adjust") && <span className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="btn small" onClick={() => setEntry({ item: i, mode: "in" })}><ArrowDownToLine className="ic" />In</button>
                    <button className="btn small" onClick={() => setEntry({ item: i, mode: "out" })}><ArrowUpFromLine className="ic" />Out</button>
                    <button className="btn small" onClick={() => setEntry({ item: i, mode: "set" })}><ClipboardCheck className="ic" />Count</button>
                  </span>}</td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {edit && <ItemForm item={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {entry && <StockEntry {...entry} branchId={branchId} onClose={() => setEntry(null)} onDone={() => { setEntry(null); reload(); }} />}
    </div>
  );
}

function ItemForm({ item, onClose, onDone }: { item: any | null; onClose: () => void; onDone: () => void }) {
  const errText = useErrorText();
  const { can } = useSession();
  const { data: units } = useLoad<{ code: string; name: string }[]>("/units");
  const [f, setF] = useState({
    name: item?.name ?? "", itemType: item?.itemType ?? "goods", unit: item?.unit ?? "NOS", category: item?.category ?? "", hsn: item?.hsn ?? "", gstRate: item?.gstRate ?? 18,
    priceIncludesTax: item?.priceIncludesTax ?? true, salePrice: Number(item?.salePrice ?? 0), purchasePrice: Number(item?.purchasePrice ?? 0), sku: item?.sku ?? "",
    barcode: item?.barcode ?? "", lowStockQty: item?.lowStockQty != null ? Number(item.lowStockQty) : 0, openingStock: 0, isActive: item?.isActive ?? true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true); setError("");
    try {
      const body: any = { ...f, category: f.category || null, hsn: f.hsn || null, barcode: f.barcode || null, sku: f.sku || null, lowStockQty: f.lowStockQty || null };
      if (item) { delete body.openingStock; delete body.itemType; await patch(`/items/${item.id}`, body); } else await post("/items", body);
      onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? "Edit item" : "Add item"} onClose={onClose}>
      <div className="stack">
        <Banner>{error}</Banner>
        {!item && <div className="tabs" style={{ marginBottom: 0 }}><button type="button" className={f.itemType === "goods" ? "on" : ""} onClick={() => set({ itemType: "goods" })}>Product</button><button type="button" className={f.itemType === "service" ? "on" : ""} onClick={() => set({ itemType: "service" })}>Service</button></div>}
        <Input label="Item name" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder="e.g. Redmi Note 14 (8/128)" />
        <div className="grid2">
          <Num label="Selling price ₹" value={f.salePrice} onChange={(v) => set({ salePrice: v })} />
          {can("financials.view") && <Num label="Purchase price ₹" value={f.purchasePrice} onChange={(v) => set({ purchasePrice: v })} />}
          <Select label="GST rate" value={f.gstRate} onChange={(e) => set({ gstRate: Number(e.target.value) })}>{GST.map((g) => <option key={g} value={g}>{g}%</option>)}</Select>
          <Select label="Selling price" value={f.priceIncludesTax ? "1" : "0"} onChange={(e) => set({ priceIncludesTax: e.target.value === "1" })}><option value="1">Includes GST (MRP style)</option><option value="0">GST extra</option></Select>
          <Select label="Unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })}>{(units ?? [{ code: f.unit, name: f.unit }]).map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</Select>
          <Input label="HSN / SAC code" inputMode="numeric" value={f.hsn} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
          <Input label="Item code / SKU" value={f.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="Auto" />
          <Input label="Barcode" value={f.barcode} onChange={(e) => set({ barcode: e.target.value })} />
          <Input label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Mobiles" />
          {f.itemType === "goods" && <Num label="Low-stock alert at" step="1" value={f.lowStockQty} onChange={(v) => set({ lowStockQty: v })} />}
          {!item && f.itemType === "goods" && <Num label="Opening stock (qty now)" step="0.001" value={f.openingStock} onChange={(v) => set({ openingStock: v })} />}
        </div>
        {item && <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active (shown while billing)</label>}
        <div className="spread">
          {item && can("items.delete") ? <button type="button" className="btn danger" onClick={() => confirm("Delete this item? Old bills keep it.") && del(`/items/${item.id}`).then(onDone).catch((e) => setError(errText(e)))}>Delete</button> : <span />}
          <button type="button" className="btn primary" onClick={save} disabled={busy || !f.name.trim()}>{busy ? "Saving…" : "Save item"}</button>
        </div>
      </div>
    </Modal>
  );
}

function StockEntry({ item, mode, branchId, onClose, onDone }: { item: any; mode: "in" | "out" | "set"; branchId: string; onClose: () => void; onDone: () => void }) {
  const errText = useErrorText();
  const { current, can } = useSession();
  const [qty, setQty] = useState(0);
  const [cost, setCost] = useState(Number(item.purchasePrice ?? 0));
  const [reason, setReason] = useState(REASONS[mode]![0]![0]);
  const [note, setNote] = useState("");
  const [branch, setBranch] = useState(branchId || String(current!.branches[0]?.id ?? ""));
  const [error, setError] = useState("");
  const title = { in: "Stock in", out: "Stock out", set: "Physical count" }[mode];
  const save = async () => {
    try {
      await post("/stock/entries", { variantId: item.variantId, mode, qty, reason, note: note || null, branchId: Number(branch) || undefined, unitCost: mode === "in" && can("financials.view") ? cost : undefined });
      onDone();
    } catch (e) { setError(errText(e)); }
  };
  return (
    <Modal title={`${title} — ${item.name}`} onClose={onClose}>
      <div className="stack">
        <Banner>{error}</Banner>
        <div className="muted small">Now in stock: <b>{Number(item.qty)} {item.unit}</b></div>
        {current!.branches.length > 1 && <Select label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>{current!.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
        <div className="grid2">
          <Num label={mode === "set" ? "Counted quantity" : "Quantity"} step="0.001" value={qty} onChange={setQty} autoFocus />
          {mode === "in" && can("financials.view") && <Num label="Cost per unit ₹" value={cost} onChange={setCost} />}
        </div>
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS[mode]!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier, bill no. …" />
        <button className="btn primary block" onClick={save} disabled={mode !== "set" && qty <= 0}>Save</button>
      </div>
    </Modal>
  );
}
