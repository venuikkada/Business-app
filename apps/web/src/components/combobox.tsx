"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import { cn, inputClass } from "./ui";

export interface ComboItem {
  id: string;
  label: string;
  sub?: string;
  raw: Record<string, unknown>;
}

/**
 * Accessible async combobox (ARIA 1.2 pattern): type to search the API,
 * arrow keys to move, Enter to pick, Esc to close.
 */
export function AsyncCombobox({
  endpoint, map, value, onPick, placeholder, footer, autoFocus, ariaLabel, className,
}: {
  endpoint: (q: string) => string;
  map: (row: Record<string, unknown>) => ComboItem;
  value?: string;
  onPick: (item: ComboItem) => void;
  placeholder?: string;
  footer?: (q: string, close: () => void) => ReactNode;
  autoFocus?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [q, setQ] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComboItem[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const reqNo = useRef(0);

  useEffect(() => setQ(value ?? ""), [value]);
  useEffect(() => {
    if (!open) return;
    const n = ++reqNo.current;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const r = await api<{ items: Record<string, unknown>[] }>("GET", endpoint(q));
        if (n === reqNo.current) {
          setItems(r.items.map(map));
          setActive(0);
        }
      } catch {
        if (n === reqNo.current) setItems([]);
      } finally {
        if (n === reqNo.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (it: ComboItem) => {
    onPick(it);
    setQ(it.label);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)} ref={box}>
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        className={inputClass}
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && items[active]) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <div className="animate-in absolute z-40 mt-1 w-full min-w-64 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <ul id={`${id}-list`} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {loading && !items.length && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
            {!loading && !items.length && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
            {items.map((it, i) => (
              <li
                key={it.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(it);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-2 text-sm", i === active && "bg-brand-50")}
              >
                <div className="font-medium">{it.label}</div>
                {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
              </li>
            ))}
          </ul>
          {footer && <div className="border-t border-line p-1">{footer(q, () => setOpen(false))}</div>}
        </div>
      )}
    </div>
  );
}
