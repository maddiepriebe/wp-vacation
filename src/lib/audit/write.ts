import { auditLog } from "@/db/schema";
import type { DB } from "@/db/client";

type DrizzleTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Conceptual audit envelope per spec §7.3. The underlying `audit_log` table
 * splits the actor into (`actor_type`, `actor_id`) and the target into
 * (`entity_type`, `entity_id`). This helper accepts the simpler shape that
 * callers actually want — admin actor + dot-namespaced action whose prefix
 * names the entity — and maps it onto the Phase 1 schema columns.
 */
export type AuditEnvelope = {
  actorAdminId: string;
  action: string;
  targetId: string | null;
  payload: Record<string, unknown>;
};

export async function writeAuditLog(
  tx: DrizzleTx,
  envelope: AuditEnvelope,
): Promise<void> {
  // `entity_type` is derived from the action namespace (the segment before
  // the first `.`). The audit_log row stores it explicitly because the
  // Phase 1 schema requires it; callers only need to think about `action`.
  const entityType = envelope.action.split(".")[0] || "unknown";

  // The Phase 1 schema marks `entity_id` notNull, but the spec's conceptual
  // envelope allows `targetId: null` (e.g., import summaries). Fall back to
  // empty string when no target is supplied.
  const entityId = envelope.targetId ?? "";

  await tx.insert(auditLog).values({
    actorType: "admin",
    actorId: envelope.actorAdminId,
    action: envelope.action,
    entityType,
    entityId,
    payload: envelope.payload,
  });
}
