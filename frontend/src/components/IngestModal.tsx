import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { collectionsApi, ingestApi } from "../lib/api";
import { CollectionTreeNode } from "../lib/types";
import { Upload, CheckCircle2, ListChecks } from "lucide-react";
import { Modal, Button, Select, FieldLabel, Input } from "./ui";

export function IngestModal({ open, onClose, objectType, scope }: {
  open: boolean; onClose: () => void;
  objectType: "kb_entry" | "user_memory";
  scope: "kb" | "user";
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [queued, setQueued] = useState(false);

  const collections = useQuery({
    queryKey: ["collections", "flat", scope],
    queryFn: () => collectionsApi.list({ scope, flat: "true" }),
    enabled: open,
  });

  const [result, setResult] = useState<import("../lib/types").IngestAccepted | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      return ingestApi.ingest(file, objectType, collectionId || undefined, subject || undefined);
    },
    onSuccess: (data) => {
      // Fire-and-forget: the worker processes in the background. Surface the
      // queued state, refresh lists, and let the user carry on.
      setResult(data);
      setQueued(true);
      qc.invalidateQueries({ queryKey: ["objects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const isDuplicate = result?.status === "duplicate";

  const reset = () => { setFile(null); setSubject(""); setCollectionId(""); setQueued(false); setResult(null); upload.reset(); };
  const close = () => { reset(); onClose(); };
  const goToTasks = () => { close(); navigate("/tasks"); };
  const goToEntry = () => { close(); if (result?.object_id) navigate(`/entry/${result.object_id}`); };

  return (
    <Modal open={open} onClose={close} width={560}
      title="Ingest File"
      subtitle="Upload a document — it's parsed, chunked and embedded in the background."
      footer={queued ? <>
        <Button variant="ghost" onClick={() => { reset(); }}>Upload another</Button>
        {isDuplicate
          ? <Button variant="primary" iconLeft={<ListChecks size={14} />} onClick={goToEntry} disabled={!result?.object_id}>View existing entry</Button>
          : <Button variant="primary" iconLeft={<ListChecks size={14} />} onClick={goToTasks}>View in Tasks</Button>}
      </> : <>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" iconLeft={<Upload size={14} />} disabled={!file || upload.isPending} loading={upload.isPending} onClick={() => upload.mutate()}>
          Upload
        </Button>
      </>}>
      {queued ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={40} style={{ color: isDuplicate ? "var(--warning)" : "var(--success)" }} />
          <div>
            <p style={{ fontWeight: 600, fontSize: 15 }}>{isDuplicate ? "Already in your knowledge base" : "Upload accepted"}</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, maxWidth: 380 }}>
              {isDuplicate
                ? (result?.message || "An identical file already exists — skipped to avoid a duplicate.")
                : "It's processing in the background — you can close this and keep working. Track progress on the Tasks page."}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div onClick={() => fileRef.current?.click()} style={{
            border: `2px dashed ${file ? "var(--accent)" : "var(--border-strong)"}`,
            borderRadius: "var(--radius-lg)", padding: "30px 24px", textAlign: "center", cursor: "pointer",
            background: file ? "var(--accent-soft)" : "var(--surface-2)", transition: "all var(--motion-fast) var(--ease)",
          }}>
            <Upload size={24} style={{ margin: "0 auto 10px", display: "block", color: file ? "var(--accent)" : "var(--text-muted)" }} />
            {file
              ? <div><p style={{ fontWeight: 600 }}>{file.name}</p><p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB</p></div>
              : <p style={{ color: "var(--text-secondary)", fontSize: 13.5 }}>Click to select — PDF, DOCX, TXT, Markdown, images</p>}
            <input ref={fileRef} type="file" style={{ display: "none" }}
              accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><FieldLabel hint="optional">Title</FieldLabel><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Override filename" /></div>
            <div><FieldLabel>Collection</FieldLabel>
              <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                <option value="">— none —</option>
                {(collections.data as CollectionTreeNode[] ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </div>

          {upload.isError && (
            <div style={{ fontSize: 12.5, color: "var(--danger)" }}>
              {(upload.error as Error)?.message || "Upload failed"}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
