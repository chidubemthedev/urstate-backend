import { Router } from "express";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { application, auditLog, property, user } from "../../db/schema.js";
import { HttpError, queryString } from "../../lib/http.js";
import { kycStatusOf } from "./kyc-sql.js";

// Read-only. The responsible owner/manager records application decisions
// (PRD 4.2); admin assistance must not overwrite them (admin journey §4).
const router = Router();

const renter = alias(user, "renter");
const owner = alias(user, "owner");
const actor = alias(user, "actor");

const STATUSES = ["submitted", "under_review", "accepted", "rejected", "withdrawn"] as const;

// GET /api/admin/applications?status=
router.get("/", async (req, res) => {
  const status = queryString(req, "status");
  const where = status && STATUSES.includes(status as never)
    ? eq(application.status, status as (typeof STATUSES)[number])
    : undefined;

  const [rows, statusCounts] = await Promise.all([
    db
      .select({
        id: application.id,
        status: application.status,
        moveInDate: application.moveInDate,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        renter: { id: renter.id, name: renter.name, email: renter.email, image: renter.image },
        owner: { id: owner.id, name: owner.name, image: owner.image },
        property: {
          id: property.id,
          name: property.name,
          address: property.address,
          photo: sql<string | null>`${property.photos}->>0`,
        },
      })
      .from(application)
      .innerJoin(renter, eq(renter.id, application.renterId))
      .innerJoin(property, eq(property.id, application.propertyId))
      .innerJoin(owner, eq(owner.id, property.ownerId))
      .where(where)
      .orderBy(desc(application.updatedAt))
      .limit(200),
    db.select({ status: application.status, n: count() }).from(application).groupBy(application.status),
  ]);

  const counts: Record<string, number> = { all: 0 };
  for (const s of STATUSES) counts[s] = 0;
  for (const r of statusCounts) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }
  res.json({ rows, counts });
});

// GET /api/admin/applications/:id
router.get("/:id", async (req, res) => {
  const [found] = await db
    .select({
      application,
      renter: {
        id: renter.id,
        name: renter.name,
        email: renter.email,
        phone: renter.phone,
        image: renter.image,
        createdAt: renter.createdAt,
        kycStatus: kycStatusOf("renter"),
      },
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        image: owner.image,
        kycStatus: kycStatusOf("owner"),
        propertyCount: sql<number>`(select count(*)::int from ${property} p where p."ownerId" = ${owner.id})`,
      },
      property: {
        id: property.id,
        name: property.name,
        address: property.address,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        rentAmountKobo: property.rentAmountKobo,
        paymentFrequency: property.paymentFrequency,
        photo: sql<string | null>`${property.photos}->>0`,
      },
      decidedByName: actor.name,
    })
    .from(application)
    .innerJoin(renter, eq(renter.id, application.renterId))
    .innerJoin(property, eq(property.id, application.propertyId))
    .innerJoin(owner, eq(owner.id, property.ownerId))
    .leftJoin(actor, eq(actor.id, application.decidedBy))
    .where(eq(application.id, req.params.id));

  if (!found) throw new HttpError(404, "Application not found.");

  const history = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      reason: auditLog.reason,
      createdAt: auditLog.createdAt,
      actorName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(eq(auditLog.entityType, "application"), eq(auditLog.entityId, req.params.id)))
    .orderBy(desc(auditLog.createdAt));

  res.json({ ...found, history });
});

export default router;
