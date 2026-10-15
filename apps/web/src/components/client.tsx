"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Button, buttonClass, cn, inputClass } from "./ui";

// ------------------------------------------------------------------ toasts
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
        {items.map((t) => (
          <div key={t.id} role="status" className={cn("animate-in pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg", t.kind === "error" ? "bg-red-700 text-white" : t.kind === "success" ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line")}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ dialog
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className={cn("m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-white p-0 shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
      {open && (
        <div className="animate-in">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-stone-100" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Shared handling for API errors that need a user decision. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Network problem. Check your connection and try again.";
}

export interface ActionProps {
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  children: ReactNode;
  confirm?: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; reason?: { label: string; minLength?: number; field?: string } };
  success?: string;
  /** Where to go afterwards. "{id}" is replaced with the id returned by the API. */
  redirect?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  className?: string;
  disabled?: boolean;
}

/**
 * A button that calls the API, optionally after a confirmation (with an
 * optional reason), then refreshes the page or redirects. Handles approval
 * requests and possible duplicates with clear messages.
 */
export function ActionButton({ method = "POST", path, body, children, confirm, success, redirect, variant = "secondary", size = "md", className, disabled }: ActionProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [needsOverride, setNeedsOverride] = useState<string | null>(null);

  async function run(extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const payload = { ...(body ?? {}), ...(confirm?.reason ? { [confirm.reason.field ?? "reason"]: reason } : {}), ...extra };
      const data = await api(method, path, method === "DELETE" ? undefined : payload, { idempotencyKey: method === "POST" ? newIdempotencyKey() : undefined });
      setOpen(false);
      setNeedsOverride(null);
      if (success) toast("success", success);
      if (redirect) router.push(redirect.replace("{id}", String((data as { id?: string } | null)?.id ?? "")));
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") {
        toast("info", e.message);
        setOpen(false);
        router.refresh();
      } else if (e instanceof ApiError && e.code === "NEGATIVE_STOCK") {
        setNeedsOverride(e.message);
      } else toast("error", describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={disabled || busy} onClick={() => (confirm ? setOpen(true) : run())} className={buttonClass(variant, size, className)}>
        {busy && !open ? "Working…" : children}
      </button>
      {confirm && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={confirm.title}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Back
              </Button>
              <Button variant={confirm.danger ? "danger" : "primary"} disabled={busy || (!!confirm.reason && reason.trim().length < (confirm.reason.minLength ?? 3))} onClick={() => run()}>
                {busy ? "Working…" : confirm.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          {confirm.body && <div className="text-sm text-muted">{confirm.body}</div>}
          {confirm.reason && (
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium">{confirm.reason.label}</span>
              <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </label>
          )}
        </Modal>
      )}
      <Modal
        open={!!needsOverride}
        onClose={() => setNeedsOverride(null)}
        title="Not enough stock"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNeedsOverride(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => run({ allowNegativeStock: true })}>
              Issue anyway (owner override)
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{needsOverride}</p>
        <p className="mt-2 text-sm text-muted">Only owners and managers can override. The override is recorded in the audit log.</p>
      </Modal>
    </>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        toast("success", "Copied");
      }}
    >
      {label}
    </Button>
  );
}

/** Opens a link returned by an API (e.g. WhatsApp share) in a new tab. */
export function OpenLinkButton({ path, field, children, variant = "secondary", size = "md", after }: { path: string; field: string; children: ReactNode; variant?: Parameters<typeof buttonClass>[0]; size?: Parameters<typeof buttonClass>[1]; after?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={buttonClass(variant, size)}
      onClick={async () => {
        // Open synchronously to avoid popup blockers, then navigate it.
        const w = window.open("about:blank", "_blank");
        setBusy(true);
        try {
          const d = await api<Record<string, unknown>>("GET", path);
          const url = String(d[field] ?? "");
          if (w) w.location.href = url;
          else window.location.href = url;
          if (after) await api("POST", after).catch(() => undefined);
        } catch (e) {
          w?.close();
          toast("error", describeError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}
