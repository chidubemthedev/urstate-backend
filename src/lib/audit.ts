import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

type Executor = Pick<typeof db, "insert">;

export type AuditEntity =
  | "user"
  | "identity_verification"
  | "property"
  | "application"
  | "payment";

/** Records who changed what, when and why (PRD §8, admin journey §6). */
export const recordAudit = async (
  entry: {
    actorId: string | null;
    entityType: AuditEntity;
    entityId: string;
    action: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
  executor: Executor = db,
) => {
  await executor.insert(auditLog).values({
    id: randomUUID(),
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? null,
  });
};
