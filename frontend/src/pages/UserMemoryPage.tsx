import { useState } from "react";
import { Plus } from "lucide-react";
import { TreeTableLayout } from "../components/treetable/TreeTableLayout";
import { userMemoryColumns } from "../components/treetable/columns";
import { Button } from "../components/ui";
import { NewObjectModal } from "../components/NewObjectModal";

export default function UserMemoryPage() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <TreeTableLayout
        scope="user"
        objectType="user_memory"
        columns={userMemoryColumns}
        title="User Memory"
        subtitle="Your personal memories & notes"
        actions={<Button size="sm" variant="primary" iconLeft={<Plus size={14} />} onClick={() => setCreating(true)}>New</Button>}
      />
      <NewObjectModal open={creating} onClose={() => setCreating(false)} objectType="user_memory" scope="user" />
    </>
  );
}
