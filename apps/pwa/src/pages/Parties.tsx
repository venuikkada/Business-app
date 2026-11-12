import { useState } from "react";
import { MessageCircle, Plus, Search, Users } from "lucide-react";
import { patch, post } from "../lib/api";
import { date, inr } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { useErrorText } from "../i18n";
import { Banner, Empty, Input, Loading, Modal, Num, PageHead, Select } from "../components/ui";

export function Parties() {
  const { can, current } = useSession();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const q = new URLSearchParams({ ...(search ? { search } : {}), ...(type ? { type } : {}) });
  const { data, error, reload } = useLoad<any[]>(`/parties?${q}`);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const due = (data ?? []).reduce((a, p) => a + Math.max(0, Number(p.balance)), 0);
  return (
    <div>
      <PageHead title="Customers & suppliers" sub={data ? `${data.length} parties · ${inr(due)} to collect` : undefined}>
        {can("parties.create") && <button className="btn primary" onClick={() => setEdit("new")}><Plus className="ic" />Add</button>}
      </PageHead>
      <div className="toolbar">
        <div className="search"><Search className="ic" /><input placeholder="Search name, mobile or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All</option><option value="customer">Customers</option><option value="supplier">Suppliers</option></select>
      </div>
      <Banner>{error}</Banner>
      <div className="card flush">
        {!data ? <Loading /> : data.length === 0 ? <Empty icon={<Users />} title="No customers yet" text="Save regular customers to bill faster and track what they owe." /> : (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Name</th><th>Mobile</th><th>GSTIN</th><th className="num">Balance</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={() => setOpen(p.id)}>
                <td><b>{p.name}</b> <span className="badge gray">{p.partyType}</span></td><td>{p.mobile ?? "—"}</td><td>{p.gstin ?? "—"}</td>
                <td className="num">{Number(p.balance) > 0 ? <span className="badge bad">{inr(p.balance)} due</span> : Number(p.balance) < 0 ? <span className="badge ok">{inr(-Number(p.balance))} advance</span> : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {edit && <PartyForm party={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {open && <Ledger id={open} business={current!.tenant.name} onClose={() => setOpen(null)} onEdit={(p) => { setOpen(null); setEdit(p); }} canEdit={can("parties.edit")} />}
    </div>
  );
}

function Ledger({ id, business, onClose, onEdit, canEdit }: { id: number; business: string; onClose: () => void; onEdit: (p: any) => void; canEdit: boolean }) {
  const { data: p } = useLoad<any>(`/parties/${id}`);
  if (!p) return <Modal title="…" onClose={onClose}><Loading /></Modal>;
  const bal = Number(p.balance);
  const wa = `https://wa.me/${(p.mobile ?? "").replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${encodeURIComponent(`Namaste ${p.name}, a gentle reminder from ${business}: ${inr(bal)} is pending. Please pay at your convenience. Thank you!`)}`;
  return (
    <Modal title={p.name} onClose={onClose}>
      <div className="stack">
        <div className="spread">
          <div><div className="muted small">{[p.mobile, p.gstin].filter(Boolean).join(" · ") || "No contact saved"}</div><div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{bal >= 0 ? `${inr(bal)} due` : `${inr(-bal)} advance`}</div></div>
          <div className="row">
            {bal > 0 && p.mobile && <a className="btn small success" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="ic" />Remind</a>}
            {canEdit && <button className="btn small" onClick={() => onEdit(p)}>Edit</button>}
          </div>
        </div>
        <table className="table">
          <thead><tr><th>Date</th><th>Entry</th><th className="num">Billed</th><th className="num">Received</th></tr></thead>
          <tbody>{p.ledger.length === 0 ? <tr><td colSpan={4} className="muted">No entries yet.</td></tr> : p.ledger.map((l: any) => (
            <tr key={l.id}><td>{date(l.date)}</td><td>{l.narration}</td><td className="num">{Number(l.debit) ? inr(l.debit) : ""}</td><td className="num">{Number(l.credit) ? inr(l.credit) : ""}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function PartyForm({ party, onClose, onDone }: { party: any | null; onClose: () => void; onDone: () => void }) {
  const errText = useErrorText();
  const [f, setF] = useState({ partyType: party?.partyType ?? "customer", name: party?.name ?? "", mobile: party?.mobile ?? "", gstin: party?.gstin ?? "", billingAddress: party?.billingAddress ?? "", openingBalance: 0 });
  const [error, setError] = useState("");
  const save = async () => {
    try {
      const { openingBalance, ...rest } = f;
      if (party) await patch(`/parties/${party.id}`, rest); else await post("/parties", f);
      onDone();
    } catch (e) { setError(errText(e)); }
  };
  return (
    <Modal title={party ? "Edit" : "Add customer / supplier"} onClose={onClose}>
      <div className="stack">
        <Banner>{error}</Banner>
        <Select label="Type" value={f.partyType} onChange={(e) => setF({ ...f, partyType: e.target.value })}><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="both">Both</option></Select>
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        <div className="grid2">
          <Input label="Mobile" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
          <Input label="GSTIN (optional)" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) })} />
        </div>
        <Input label="Address" value={f.billingAddress} onChange={(e) => setF({ ...f, billingAddress: e.target.value })} />
        {!party && <Num label="Old balance they owe you ₹ (optional)" value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} />}
        <button className="btn primary block" onClick={save} disabled={!f.name.trim()}>Save</button>
      </div>
    </Modal>
  );
}
