import { Router } from "express";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  application,
  auditLog,
  property,
  propertyDocument,
  user,
} from "../../db/schema.js";
import { getAdmin } from "../../middleware/require-admin.js";
import { recordAudit } from "../../lib/audit.js";
import { HttpError, optionalReason, queryString, requireReason } from "../../lib/http.js";
import { kycStatusOf } from "./kyc-sql.js";

const router = Router();

/** Admin list filters → stored verification statuses. */
const FILTERS = {
  pending: ["pending", "action_required"],
  verified: ["verified"],
  rejected: ["rejected"],
} as const;

const owner = alias(user, "owner");

// GET /api/admin/properties?status=pending|verified|rejected&search=
router.get("/", async (req, res) => {
  const status = queryString(req, "status") as keyof typeof FILTERS | undefined;
  const search = queryString(req, "search");
  const active = isNull(property.archivedAt);
  const filter = status && FILTERS[status] ? inArray(property.verificationStatus, [...FILTERS[status]]) : undefined;
  const searchFilter = search
    ? or(ilike(property.name, `%${search}%`), ilike(property.address, `%${search}%`))
    : undefined;

  const [rows, statusCounts] = await Promise.all([
    db
      .select({
        id: property.id,
        name: property.name,
        address: property.address,
        city: property.city,
        state: property.state,
        propertyType: property.propertyType,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        rentAmountKobo: property.rentAmountKobo,
        paymentFrequency: property.paymentFrequency,
        photo: sql<string | null>`${property.photos}->>0`,
        verificationStatus: property.verificationStatus,
        publicationStatus: property.publicationStatus,
        occupancyStatus: property.occupancyStatus,
        flagged: property.flagged,
        submittedAt: property.submittedAt,
        createdAt: property.createdAt,
        owner: { id: owner.id, name: owner.name, image: owner.image },
      })
      .from(property)
      .innerJoin(owner, eq(owner.id, property.ownerId))
      .where(and(active, filter, searchFilter))
      .orderBy(desc(sql`coalesce(${property.submittedAt}, ${property.createdAt})`))
      .limit(200),
    db
      .select({ status: property.verificationStatus, n: count() })
      .from(property)
      .where(active)
      .groupBy(property.verificationStatus),
  ]);

  const counts = { all: 0, pending: 0, verified: 0, rejected: 0 };
  for (const r of statusCounts) {
    counts.all += r.n;
    if (r.status === "pending" || r.status === "action_required") counts.pending += r.n;
    if (r.status === "verified") counts.verified += r.n;
    if (r.status === "rejected") counts.rejected += r.n;
  }
  res.json({ rows, counts });
});

// GET /api/admin/properties/:id
router.get("/:id", async (req, res) => {
  const [found] = await db.select().from(property).where(eq(property.id, req.params.id));
  if (!found) throw new HttpError(404, "Property not found.");

  const [ownerRow, documents, [{ applicationCount }], history] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        image: user.image,
        createdAt: user.createdAt,
        kycStatus: kycStatusOf("user"),
      })
      .from(user)
      .where(eq(user.id, found.ownerId)),
    db
      .select()
      .from(propertyDocument)
      .where(eq(propertyDocument.propertyId, found.id))
      .orderBy(desc(propertyDocument.createdAt)),
    db.select({ applicationCount: count() }).from(application).where(eq(application.propertyId, found.id)),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
        actorName: user.name,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(and(eq(auditLog.entityType, "property"), eq(auditLog.entityId, found.id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
  ]);

  res.json({ property: found, owner: ownerRow[0] ?? null, documents, applicationCount, history });
});

const REVIEWABLE = ["pending", "action_required"] as const;

const review =
  (status: "verified" | "rejected" | "action_required", action: string, reasonRequired: boolean) =>
  async (req: any, res: any) => {
    const adminId = getAdmin(req).id;
    const reason = reasonRequired ? requireReason(req) : optionalReason(req);
    const [found] = await db
      .select({ status: property.verificationStatus })
      .from(property)
      .where(eq(property.id, req.params.id));
    if (!found) throw new HttpError(404, "Property not found.");
    if (!REVIEWABLE.includes(found.status as never)) {
      throw new HttpError(409, "This property isn't waiting for review.");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(property)
        .set({
          verificationStatus: status,
          verificationReason: reason,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          // A rejected property can't stay visible to renters.
          ...(status === "rejected" ? { publicationStatus: "unpublished" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(property.id, req.params.id));
      await recordAudit(
        { actorId: adminId, entityType: "property", entityId: req.params.id, action, reason, metadata: { from: found.status } },
        tx,
      );
    });
    res.json({ verificationStatus: status });
  };

// Verifying approves eligibility only. Publishing stays the owner's action (PRD 4.1).
router.post("/:id/verify", review("verified", "property.verified", false));
router.post("/:id/reject", review("rejected", "property.rejected", true));
router.post("/:id/request-info", review("action_required", "property.action_required", true));

router.post("/:id/flag", async (req, res) => {
  const adminId = getAdmin(req).id;
  const reason = requireReason(req);
  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(property)
      .set({ flagged: true, flaggedReason: reason, updatedAt: new Date() })
      .where(eq(property.id, req.params.id))
      .returning({ id: property.id });
    if (updated.length) {
      await recordAudit({ actorId: adminId, entityType: "property", entityId: req.params.id, action: "property.flagged", reason }, tx);
    }
    return updated.length;
  });
  if (!result) throw new HttpError(404, "Property not found.");
  res.json({ flagged: true });
});

router.post("/:id/unflag", async (req, res) => {
  const adminId = getAdmin(req).id;
  const reason = optionalReason(req);
  await db.transaction(async (tx) => {
    await tx
      .update(property)
      .set({ flagged: false, flaggedReason: null, updatedAt: new Date() })
      .where(eq(property.id, req.params.id));
    await recordAudit({ actorId: adminId, entityType: "property", entityId: req.params.id, action: "property.unflagged", reason }, tx);
  });
  res.json({ flagged: false });
});

export default router;
