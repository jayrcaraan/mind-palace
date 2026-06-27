// Identity for un-tokened (human) requests — must match backend ADMIN_USER_ID.
export const ADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";

/** Resolve a contributor_id / proposer_id to a friendly label. */
export function resolveContributor(
  id: string | null | undefined,
  agents: { id: string; name: string }[] | undefined,
): { label: string; isAgent: boolean } {
  if (!id) return { label: "Unknown", isAgent: false };
  if (id === ADMIN_USER_ID) return { label: "You", isAgent: false };
  const agent = agents?.find((a) => a.id === id);
  if (agent) return { label: agent.name, isAgent: true };
  return { label: `${id.slice(0, 8)}…`, isAgent: false };
}
