import { useState } from "react";
import { Plus, Upload } from "lucide-react";
import { TreeTableLayout } from "../components/treetable/TreeTableLayout";
import { knowledgeColumns } from "../components/treetable/columns";
import { Button } from "../components/ui";
import { NewObjectModal } from "../components/NewObjectModal";
import { IngestModal } from "../components/IngestModal";

export default function KnowledgeBasePage() {
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <TreeTableLayout
        scope="kb"
        objectType="kb_entry"
        columns={knowledgeColumns}
        title="Knowledge Base"
        subtitle="Shared documents & reference material"
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="secondary" iconLeft={<Upload size={14} />} onClick={() => setUploading(true)}>Upload</Button>
            <Button size="sm" variant="primary" iconLeft={<Plus size={14} />} onClick={() => setCreating(true)}>New</Button>
          </div>
        }
      />
      <NewObjectModal open={creating} onClose={() => setCreating(false)} objectType="kb_entry" scope="kb" />
      <IngestModal open={uploading} onClose={() => setUploading(false)} objectType="kb_entry" scope="kb" />
    </>
  );
}
