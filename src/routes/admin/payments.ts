import { Router } from "express";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "../../db/index.js";
import { auditLog, payment, property, user } from "../../db/schema.js";
import { getAdmin } from "../../middleware/require-admin.js";
import { recordAudit } from "../../lib/audit.js";
import { HttpError, optionalReason, queryString, requireReason } from "../../lib/http.js";

// Admin can inspect and flag payments, but cannot move money. Confirmation
// comes from the payment provider or authorised reconciliation; custody,
// payout release and refunds wait on the provider model and policy
// (PRD 4.4, admin journey §5).
const router = Router();

const renter = alias(user, "renter");
const owner = alias(user, "owner");

const STATUSES = ["initiated", "pending", "confirmed", "failed", "disputed", "refunded"] as const;

// GET /api/admin/payments?status=
router.get("/", async (req, res) => {
  const status = queryString(req, "status");
  const where = status && STATUSES.includes(status as never)
    ? eq(payment.status, status as (typeof STATUSES)[number])
    : undefined;

  const [rows, statusCounts, [awaitingPayout]] = await Promise.all([
    db
      .select({
        id: payment.id,
        reference: payment.reference,
        type: payment.type,
        amountKobo: payment.amountKobo,
        status: payment.status,
        payoutStatus: payment.payoutStatus,
        flagged: payment.flagged,
        isRecordedHistory: payment.isRecordedHistory,
        createdAt: payment.createdAt,
        renter: { id: renter.id, name: renter.name, image: renter.image },
        owner: { id: owner.id, name: owner.name, image: owner.image },
        property: { id: property.id, name: property.name },
      })
      .from(payment)
      .innerJoin(renter, eq(renter.id, payment.renterId))
      .innerJoin(owner, eq(owner.id, payment.ownerId))
      .innerJoin(property, eq(property.id, payment.propertyId))
      .where(where)
      .orderBy(desc(payment.createdAt))
      .limit(200),
    db
      .select({ status: payment.status, n: count(), totalKobo: sum(payment.amountKobo) })
      .from(payment)
      .groupBy(payment.status),
    db
      .select({ totalKobo: sum(payment.amountKobo) })
      .from(payment)
      .where(
        and(
          eq(payment.status, "confirmed"),
          sql`${payment.payoutStatus} in ('pending', 'processing')`,
        ),
      ),
  ]);

  const counts: Record<string, number> = { all: 0 };
  const totals: Record<string, number> = {};
  for (const s of STATUSES) {
    counts[s] = 0;
    totals[s] = 0;
  }
  for (const r of statusCounts) {
    counts[r.status] = r.n;
    counts.all += r.n;
    totals[r.status] = Number(r.totalKobo ?? 0);
  }

  res.json({
    rows,
    counts,
    summary: {
      confirmedKobo: totals.confirmed,
      pendingKobo: totals.initiated + totals.pending,
      awaitingPayoutKobo: Number(awaitingPayout?.totalKobo ?? 0),
      failedKobo: totals.failed,
    },
  });
});

// GET /api/admin/payments/:id
router.get("/:id", async (req, res) => {
  const [found] = await db
    .select({
      payment,
      renter: { id: renter.id, name: renter.name, email: renter.email, image: renter.image },
      owner: { id: owner.id, name: owner.name, email: owner.email, image: owner.image },
      property: { id: property.id, name: property.name, address: property.address },
    })
    .from(payment)
    .innerJoin(renter, eq(renter.id, payment.renterId))
    .innerJoin(owner, eq(owner.id, payment.ownerId))
    .innerJoin(property, eq(property.id, payment.propertyId))
    .where(eq(payment.id, req.params.id));
  if (!found) throw new HttpError(404, "Payment not found.");

  const history = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      reason: auditLog.reason,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(eq(auditLog.entityType, "payment"), eq(auditLog.entityId, req.params.id)))
    .orderBy(desc(auditLog.createdAt));

  res.json({ ...found, history });
});

router.post("/:id/flag", async (req, res) => {
  const adminId = getAdmin(req).id;
  const reason = requireReason(req);
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(payment)
      .set({ flagged: true, flaggedReason: reason, updatedAt: new Date() })
      .where(eq(payment.id, req.params.id))
      .returning({ id: payment.id });
    if (rows.length) {
      await recordAudit({ actorId: adminId, entityType: "payment", entityId: req.params.id, action: "payment.flagged", reason }, tx);
    }
    return rows.length;
  });
  if (!updated) throw new HttpError(404, "Payment not found.");
  res.json({ flagged: true });
});

router.post("/:id/unflag", async (req, res) => {
  const adminId = getAdmin(req).id;
  const reason = optionalReason(req);
  await db.transaction(async (tx) => {
    await tx
      .update(payment)
      .set({ flagged: false, flaggedReason: null, updatedAt: new Date() })
      .where(eq(payment.id, req.params.id));
    await recordAudit({ actorId: adminId, entityType: "payment", entityId: req.params.id, action: "payment.unflagged", reason }, tx);
  });
  res.json({ flagged: false });
});

export default router;
