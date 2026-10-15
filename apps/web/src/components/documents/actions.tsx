"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONVERSIONS, DOC_TYPE_META, type DocType } from "@cba/core";
import { api, ApiError } from "@/lib/api-client";
import { ActionButton, OpenLinkButton, useToast } from "../client";
import { buttonClass, LinkButton } from "../ui";

export interface DocActionProps {
  id: string;
  type: DocType;
  status: string;
  partyId: string;
  balanceDue: string;
  perms: { create: boolean; edit: boolean; del: boolean; pay: boolean; pdf: boolean; convertTo: DocType[] };
  approval: { id: string; status: string } | null;
  hasShareToken: boolean;
}

export function DocumentActions(p: DocActionProps) {
  const router = useRouter();
  const toast = useToast();
  const [converting, setConverting] = useState<string | null>(null);
  const meta = DOC_TYPE_META[p.type];
  const issued = p.status !== "draft" && p.status !== "cancelled";
  const payable = (p.type === "invoice" || p.type === "purchase_bill") && ["issued", "partially_paid"].includes(p.status) && Number(p.balanceDue) > 0;
  const conversions = (CONVERSIONS[p.type] ?? []).filter((t) => p.perms.convertTo.includes(t));
  const canConvert = issued && !(p.type === "quotation" && p.status === "rejected") && !["fulfilled", "received"].includes(p.status) && !(p.type === "delivery_challan" && p.status === "converted");

  async function convert(target: DocType) {
    setConverting(target);
    try {
      const d = await api<{ id: string }>("POST", `documents/${p.id}/convert`, { target });
      toast("success", `Draft ${DOC_TYPE_META[target].label.toLowerCase()} created — review and issue it`);
      router.push(`/documents/${target}/${d.id}/edit`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Failed");
    } finally {
      setConverting(null);
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {p.status === "draft" && (
        <>
          {p.perms.edit && <LinkButton href={`/documents/${p.type}/${p.id}/edit`} variant="secondary">Edit</LinkButton>}
          {p.perms.create && p.approval?.status !== "pending" && (
            <ActionButton variant="primary" path={`documents/${p.id}/finalize`} body={p.approval?.status === "approved" ? { approvalId: p.approval.id } : {}} success={`${meta.label} issued`}>
              {p.type === "quotation" ? "Mark as sent" : "Issue"}
            </ActionButton>
          )}
          {p.perms.del && (
            <ActionButton method="DELETE" variant="danger" path={`documents/${p.id}`} redirect={`/documents/${p.type}`} success="Draft deleted" confirm={{ title: "Delete this draft?", body: "Drafts have no number, so nothing is lost from your records.", confirmLabel: "Delete", danger: true }}>
              Delete
            </ActionButton>
          )}
        </>
      )}
      {payable && p.perms.pay && (
        <LinkButton href={`/payments/new?direction=${p.type === "invoice" ? "in" : "out"}&partyId=${p.partyId}&documentId=${p.id}`}>
          {p.type === "invoice" ? "Record payment" : "Pay supplier"}
        </LinkButton>
      )}
      {p.perms.pdf && (
        <a href={`/api/v1/documents/${p.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary")}>PDF</a>
      )}
      {issued && meta.side === "sales" && (
        <OpenLinkButton path={`documents/${p.id}/share`} field="whatsappUrl" after={`documents/${p.id}/shared`} variant="secondary">
          WhatsApp
        </OpenLinkButton>
      )}
      {issued && p.hasShareToken && meta.side === "sales" && (
        <button
          type="button"
          className={buttonClass("ghost")}
          onClick={async () => {
            const d = await api<{ link: string }>("GET", `documents/${p.id}/share`);
            await navigator.clipboard.writeText(d.link);
            toast("success", "Link copied — anyone with this link can view this document");
          }}
        >
          Copy link
        </button>
      )}
      {p.type === "quotation" && ["sent", "expired"].includes(p.status) && p.perms.edit && (
        <>
          <ActionButton path={`documents/${p.id}/status`} body={{ status: "accepted" }} success="Marked accepted" variant="secondary">Accepted</ActionButton>
          <ActionButton path={`documents/${p.id}/status`} body={{ status: "rejected" }} success="Marked rejected" variant="ghost">Rejected</ActionButton>
        </>
      )}
      {canConvert &&
        conversions.map((t) => (
          <button key={t} type="button" disabled={!!converting} onClick={() => convert(t)} className={buttonClass(t === "invoice" ? "primary" : "secondary")}>
            {converting === t ? "Creating…" : `→ ${DOC_TYPE_META[t].label}`}
          </button>
        ))}
      {p.perms.create && (
        <ActionButton path={`documents/${p.id}/duplicate`} variant="ghost" success="Copy created as draft" redirect={`/documents/${p.type}/{id}/edit`}>
          Duplicate
        </ActionButton>
      )}
      {issued && p.perms.del && (
        <ActionButton
          variant="danger"
          path={`documents/${p.id}/cancel`}
          success={`${meta.label} cancelled`}
          confirm={{
            title: `Cancel ${meta.label.toLowerCase()}?`,
            body: meta.isTaxDocument
              ? "The number is kept and marked cancelled (no gaps). Stock effects are reversed. Payments must be voided first. For partial returns, issue a credit note instead."
              : "The document will be marked cancelled.",
            confirmLabel: "Cancel document",
            danger: true,
            reason: { label: "Reason (kept in the audit log)", minLength: 3 },
          }}
        >
          Cancel
        </ActionButton>
      )}
    </div>
  );
}
