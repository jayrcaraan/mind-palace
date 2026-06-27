import { ReactNode } from "react";
import { ObjectResponse } from "../../lib/types";

export interface ColumnDef {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: "left" | "right" | "center";
  render: (obj: ObjectResponse) => ReactNode;
}

export type TreeScope = "user" | "agent" | "kb";

/** A node in the left-hand tree. `id` is what gets passed to the table as the
 *  active filter; special string ids drive virtual roots:
 *   - "all"            → no collection filter (everything of this type)
 *   - "none"           → uncategorized (collection_id IS NULL)
 *   - "agent:<id>"     → all memories authored by agent <id>
 *   - "agent-none:<id>"→ uncategorized memories of agent <id>
 *   - <uuid>           → a real collection
 */
export interface TreeItem {
  id: string;
  label: string;
  count?: number;
  icon?: "all" | "folder" | "agent" | "inbox";
  children?: TreeItem[];
  depth: number;
  collectionId?: string;     // real collection (for edit/delete)
  editable?: boolean;
}
