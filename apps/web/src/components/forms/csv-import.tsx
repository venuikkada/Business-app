"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Badge, Button, Card, CardHeader, Table, Td, Th, inputClass } from "../ui";
import { useToast } from "../client";

interface PreviewRow { row: number; data: Record<string, unknown> | null; errors: string[]; warnings: string[] }

export function CsvImport({ entity, template, columns, doneHref }: { entity: "parties" | "products"; template: string; columns: Array<[string, string]>; doneHref: string }) {
  const router = useRouter();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; valid: number; invalid: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doPreview() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api("POST", `${entity}/import/preview`, { csv }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    try {
      const r = await api<{ imported: number }>("POST", `${entity}/import/commit`, { csv }, { idempotencyKey: newIdempotencyKey() });
      toast("success", `Imported ${r.imported} records`);
      router.push(doneHref);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="1. Prepare your file"
          subtitle="Save from Excel / Google Sheets as CSV (UTF-8). The first row must contain the column names."
          action={
            <a className="text-sm font-medium text-brand-700" download={`${entity}-template.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>
              Download template
            </a>
          }
        />
        <div className="p-5">
          <div className="mb-3 flex flex-wrap gap-1.5">{columns.map(([c, h]) => <span key={c} title={h}><Badge>{c}</Badge></span>)}</div>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 3_000_000) return setError("Please upload a file smaller than 3 MB");
              setCsv(await file.text());
              setPreview(null);
            }}
          />
          <textarea className={`${inputClass} mt-3 font-mono text-xs`} rows={6} placeholder="…or paste CSV here" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} />
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={doPreview} disabled={busy || !csv.trim()}>{busy && !preview ? "Checking…" : "2. Check for errors"}</Button>
          </div>
        </div>
      </Card>
      {preview && (
        <Card>
          <CardHeader
            title={`3. Review — ${preview.valid} ready, ${preview.invalid} with errors`}
            subtitle={preview.invalid ? "Fix the rows with errors in your file and check again. Nothing has been saved yet." : "Nothing is saved until you click Import."}
            action={<Button onClick={commit} disabled={busy || preview.invalid > 0 || preview.valid === 0}>{busy ? "Importing…" : `Import ${preview.valid}`}</Button>}
          />
          <Table>
            <thead>
              <tr><Th>Row</Th><Th>Name</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 500).map((r) => (
                <tr key={r.row}>
                  <Td className="text-muted">{r.row}</Td>
                  <Td>{(r.data?.name as string) ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    {r.errors.length ? r.errors.map((e, i) => <div key={i} className="text-red-700">{e}</div>) : r.warnings.length ? r.warnings.map((w, i) => <div key={i} className="text-amber-700">{w}</div>) : <Badge color="green">OK</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
