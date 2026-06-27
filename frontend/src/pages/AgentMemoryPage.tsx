import { TreeTableLayout } from "../components/treetable/TreeTableLayout";
import { agentMemoryColumns } from "../components/treetable/columns";

export default function AgentMemoryPage() {
  return (
    <TreeTableLayout
      scope="agent"
      objectType="agent_memory"
      columns={agentMemoryColumns}
      title="Agent Memory"
      subtitle="Private memories contributed by your agents"
    />
  );
}
