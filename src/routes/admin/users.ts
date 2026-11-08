import { Router } from "express";
import { and, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  auditLog,
  identityVerification,
  payment,
  property,
  session,
  user,
} from "../../db/schema.js";
import { getAdmin } from "../../middleware/require-admin.js";
import { recordAudit } from "../../lib/audit.js";
import {
  HttpError,
  optionalReason,
  pageParams,
  queryString,
  requireReason,
} from "../../lib/http.js";
import { kycStatusOf } from "./kyc-sql.js";

const router = Router();

const latestKycStatus = kycStatusOf("user");

const ROLE_FILTERS = ["renter", "owner"] as const;

// GET /api/admin/users?role=renter|owner&search=&page=&pageSize=
router.get("/", async (req, res) => {
  const { page, pageSize, offset } = pageParams(req, 10);
  const role = queryString(req, "role");
  const search = queryString(req, "search");

  // Admin accounts are managed separately and never listed here.
  const base = [or(ne(user.role, "admin"), sql`${user.role} is null`)];
  if (search) {
    base.push(or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`)));
  }
  const where = and(
    ...base,
    role && ROLE_FILTERS.includes(role as never) ? eq(user.role, role) : undefined,
  );

  const [rows, [{ total }], roleCounts] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        suspended: user.suspended,
        flagged: user.flagged,
        createdAt: user.createdAt,
        kycStatus: latestKycStatus,
      })
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(user).where(where),
    db
      .select({ role: user.role, n: count() })
      .from(user)
      .where(and(...base))
      .groupBy(user.role),
  ]);

  const counts = { all: 0, renter: 0, owner: 0 };
  for (const r of roleCounts) {
    counts.all += r.n;
    if (r.role === "renter" || r.role === "owner") counts[r.role] = r.n;
  }

  res.json({ rows, total, page, pageSize, counts });
});

// GET /api/admin/users/:id
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  const [found] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      phone: user.phone,
      suspended: user.suspended,
      suspendedReason: user.suspendedReason,
      flagged: user.flagged,
      flaggedReason: user.flaggedReason,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, id));

  if (!found || found.role === "admin") throw new HttpError(404, "User not found.");

  const [kyc, activity, payments, [{ propertyCount }]] = await Promise.all([
    db
      .select()
      .from(identityVerification)
      .where(eq(identityVerification.userId, id))
      .orderBy(desc(identityVerification.submittedAt))
      .limit(1),
    db
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
      .where(
        or(
          and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, id)),
          eq(auditLog.actorId, id),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
    db
      .select({
        id: payment.id,
        reference: payment.reference,
        amountKobo: payment.amountKobo,
        status: payment.status,
        type: payment.type,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .where(or(eq(payment.renterId, id), eq(payment.ownerId, id)))
      .orderBy(desc(payment.createdAt))
      .limit(20),
    db.select({ propertyCount: count() }).from(property).where(eq(property.ownerId, id)),
  ]);

  res.json({
    user: found,
    kyc: kyc[0] ?? null,
    activity,
    payments,
    propertyCount,
  });
});

/** Finds the submission an admin can act on: the latest pending/action-required one. */
const reviewableKyc = async (userId: string) => {
  const [latest] = await db
    .select({ id: identityVerification.id, status: identityVerification.status })
    .from(identityVerification)
    .where(
      and(
        eq(identityVerification.userId, userId),
        inArray(identityVerification.status, ["pending", "action_required"]),
      ),
    )
    .orderBy(desc(identityVerification.submittedAt))
    .limit(1);
  if (!latest) throw new HttpError(409, "There's no identity submission waiting for review.");
  return latest;
};

const kycDecision =
  (status: "verified" | "rejected" | "action_required", action: string, reasonRequired: boolean) =>
  async (req: any, res: any) => {
    const adminId = getAdmin(req).id;
    const reason = reasonRequired ? requireReason(req) : optionalReason(req);
    const kyc = await reviewableKyc(req.params.id);

    await db.transaction(async (tx) => {
      await tx
        .update(identityVerification)
        .set({
          status,
          reviewReason: reason,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(identityVerification.id, kyc.id));
      await recordAudit(
        { actorId: adminId, entityType: "user", entityId: req.params.id, action, reason, metadata: { verificationId: kyc.id, from: kyc.status } },
        tx,
      );
    });
    res.json({ status });
  };

router.post("/:id/kyc/approve", kycDecision("verified", "kyc.approved", false));
router.post("/:id/kyc/reject", kycDecision("rejected", "kyc.rejected", true));
router.post("/:id/kyc/request-info", kycDecision("action_required", "kyc.action_required", true));

const assertManageable = async (adminId: string, targetId: string) => {
  if (adminId === targetId) throw new HttpError(400, "You can't change your own account here.");
  const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, targetId));
  if (!target) throw new HttpError(404, "User not found.");
  if (target.role === "admin") throw new HttpError(403, "Admin accounts can't be changed here.");
};

router.post("/:id/flag", async (req, res) => {
  const adminId = getAdmin(req).id;
  await assertManageable(adminId, req.params.id);
  const reason = optionalReason(req);
  await db.transaction(async (tx) => {
    await tx.update(user).set({ flagged: true, flaggedReason: reason, updatedAt: new Date() }).where(eq(user.id, req.params.id));
    await recordAudit({ actorId: adminId, entityType: "user", entityId: req.params.id, action: "user.flagged", reason }, tx);
  });
  res.json({ flagged: true });
});

router.post("/:id/unflag", async (req, res) => {
  const adminId = getAdmin(req).id;
  await assertManageable(adminId, req.params.id);
  const reason = optionalReason(req);
  await db.transaction(async (tx) => {
    await tx.update(user).set({ flagged: false, flaggedReason: null, updatedAt: new Date() }).where(eq(user.id, req.params.id));
    await recordAudit({ actorId: adminId, entityType: "user", entityId: req.params.id, action: "user.unflagged", reason }, tx);
  });
  res.json({ flagged: false });
});

// Suspension needs a recorded reason (PRD admin journey §2) and ends live sessions.
router.post("/:id/suspend", async (req, res) => {
  const adminId = getAdmin(req).id;
  await assertManageable(adminId, req.params.id);
  const reason = requireReason(req);
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ suspended: true, suspendedReason: reason, suspendedAt: new Date(), updatedAt: new Date() })
      .where(eq(user.id, req.params.id));
    await tx.delete(session).where(eq(session.userId, req.params.id));
    await recordAudit({ actorId: adminId, entityType: "user", entityId: req.params.id, action: "user.suspended", reason }, tx);
  });
  res.json({ suspended: true });
});

router.post("/:id/reactivate", async (req, res) => {
  const adminId = getAdmin(req).id;
  await assertManageable(adminId, req.params.id);
  const reason = requireReason(req);
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ suspended: false, suspendedReason: null, suspendedAt: null, updatedAt: new Date() })
      .where(eq(user.id, req.params.id));
    await recordAudit({ actorId: adminId, entityType: "user", entityId: req.params.id, action: "user.reactivated", reason }, tx);
  });
  res.json({ suspended: false });
});

export default router;
