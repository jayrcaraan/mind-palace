import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { objectsApi, collectionsApi } from "../lib/api";
import { CollectionTreeNode } from "../lib/types";
import { Modal, Button, Input, Textarea, Select, FieldLabel } from "./ui";
import { EntityInput, EntityValue } from "./EntityInput";

export function NewObjectModal({ open, onClose, objectType, scope, defaultCollectionId }: {
  open: boolean; onClose: () => void;
  objectType: "user_memory" | "kb_entry";
  scope: "user" | "kb";
  defaultCollectionId?: string;
}) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [entities, setEntities] = useState<EntityValue[]>([]);
  const [collectionId, setCollectionId] = useState(defaultCollectionId ?? "");

  const collections = useQuery({
    queryKey: ["collections", "flat", scope],
    queryFn: () => collectionsApi.list({ scope, flat: "true" }),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => objectsApi.create({
      subject: subject || undefined, content, object_type: objectType,
      collection_id: collectionId || undefined,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      entities: entities.length ? entities : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["entities"] });
      setSubject(""); setContent(""); setTags(""); setEntities([]);
      onClose();
    },
  });

  const label = objectType === "kb_entry" ? "Knowledge Entry" : "Memory";

  return (
    <Modal open={open} onClose={onClose} width={520}
      title={`New ${label}`}
      subtitle="Add a new entry to your mind palace."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!content} loading={create.isPending} onClick={() => create.mutate()}>
          Create {label}
        </Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <FieldLabel hint="optional">Subject</FieldLabel>
          <Input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Title or summary" />
        </div>
        <div>
          <FieldLabel>Content</FieldLabel>
          <Textarea rows={7} value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="Write here… Markdown supported." style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6 }} />
        </div>
        <div className="mp-stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <FieldLabel>Collection</FieldLabel>
            <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              <option value="">— none —</option>
              {(collections.data as CollectionTreeNode[] ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel hint="comma-separated">Tags</FieldLabel>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ai, research" />
          </div>
        </div>
        <div>
          <FieldLabel hint="people, places, concepts…">Entities</FieldLabel>
          <EntityInput value={entities} onChange={setEntities} />
        </div>
      </div>
    </Modal>
  );
}
