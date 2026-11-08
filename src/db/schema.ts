import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Better Auth tables ──────────────────────────────────────────────────────
// Column names must stay as Better Auth expects them.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  // "renter" | "owner" | "admin". Users can only ever choose renter/owner;
  // admin is assigned by the seed script or another admin (see lib/auth.ts).
  role: text("role"),
  phone: text("phone"),
  // Suspension: a suspended user cannot sign in and has their sessions revoked.
  suspended: boolean("suspended").notNull().default(false),
  suspendedReason: text("suspendedReason"),
  suspendedAt: timestamp("suspendedAt"),
  // Flag: marks a user for review without blocking them.
  flagged: boolean("flagged").notNull().default(false),
  flaggedReason: text("flaggedReason"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// ─── Shared enums (PRD: Property lifecycle tab) ──────────────────────────────

/** Outcome of any review: identity (KYC) or property authority. */
export const reviewStatus = pgEnum("review_status", [
  "not_submitted",
  "pending",
  "verified",
  "action_required",
  "rejected",
]);

export const publicationStatus = pgEnum("publication_status", [
  "unpublished",
  "published",
  "paused",
]);

export const occupancyStatus = pgEnum("occupancy_status", [
  "vacant",
  "reserved",
  "occupied",
]);

export const applicationStatus = pgEnum("application_status", [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "withdrawn",
]);

export const paymentStatus = pgEnum("payment_status", [
  "initiated",
  "pending",
  "confirmed",
  "failed",
  "disputed",
  "refunded",
]);

export const payoutStatus = pgEnum("payout_status", [
  "not_applicable",
  "pending",
  "processing",
  "paid",
  "failed",
]);

/** Rental obligations only. UrState does not charge rental transaction fees. */
export const paymentType = pgEnum("payment_type", [
  "rent",
  "caution_deposit",
  "service_charge",
]);

// ─── Identity verification (KYC) ─────────────────────────────────────────────

export const identityVerification = pgTable(
  "identity_verification",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    status: reviewStatus("status").notNull().default("pending"),
    idType: text("idType"), // e.g. "NIN", "International Passport"
    idNumber: text("idNumber"),
    dateOfBirth: date("dateOfBirth"),
    address: text("address"),
    state: text("state"),
    country: text("country").default("Nigeria"),
    // Document files: [{ label, url, mimeType }]
    documents: jsonb("documents")
      .$type<{ label: string; url: string; mimeType?: string }[]>()
      .notNull()
      .default([]),
    provider: text("provider"), // verification partner, if any
    providerReference: text("providerReference"),
    reviewReason: text("reviewReason"),
    reviewedBy: text("reviewedBy").references(() => user.id),
    reviewedAt: timestamp("reviewedAt"),
    submittedAt: timestamp("submittedAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    index("identity_verification_user_idx").on(t.userId),
    index("identity_verification_status_idx").on(t.status),
  ],
);

// ─── Properties ──────────────────────────────────────────────────────────────

export const property = pgTable(
  "property",
  {
    id: text("id").primaryKey(),
    ownerId: text("ownerId")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    description: text("description"),
    address: text("address").notNull(),
    city: text("city"),
    state: text("state"),
    propertyType: text("propertyType"), // Apartment, Duplex, Bungalow…
    category: text("category"), // "long_term" | "shortlet" (pilot decision open)
    bedrooms: integer("bedrooms").notNull().default(0),
    bathrooms: integer("bathrooms").notNull().default(0),
    toilets: integer("toilets").notNull().default(0),
    maxOccupants: integer("maxOccupants"),
    furnishing: text("furnishing"),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    // Money is stored in kobo to avoid floating-point errors.
    rentAmountKobo: bigint("rentAmountKobo", { mode: "number" }).notNull(),
    paymentFrequency: text("paymentFrequency").notNull().default("yearly"),
    cautionFeeKobo: bigint("cautionFeeKobo", { mode: "number" }),
    serviceChargeKobo: bigint("serviceChargeKobo", { mode: "number" }),
    // "owner" = I own this property, "manager" = I manage on behalf of the owner
    authorityType: text("authorityType"),
    verificationStatus: reviewStatus("verificationStatus")
      .notNull()
      .default("not_submitted"),
    verificationReason: text("verificationReason"),
    reviewedBy: text("reviewedBy").references(() => user.id),
    reviewedAt: timestamp("reviewedAt"),
    submittedAt: timestamp("submittedAt"),
    publicationStatus: publicationStatus("publicationStatus")
      .notNull()
      .default("unpublished"),
    occupancyStatus: occupancyStatus("occupancyStatus")
      .notNull()
      .default("vacant"),
    flagged: boolean("flagged").notNull().default(false),
    flaggedReason: text("flaggedReason"),
    archivedAt: timestamp("archivedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    index("property_owner_idx").on(t.ownerId),
    index("property_verification_idx").on(t.verificationStatus),
  ],
);

export const propertyDocument = pgTable(
  "property_document",
  {
    id: text("id").primaryKey(),
    propertyId: text("propertyId")
      .notNull()
      .references(() => property.id),
    // "ownership_evidence" | "management_authority" | "lease" | "other"
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    mimeType: text("mimeType"),
    sizeBytes: integer("sizeBytes"),
    uploadedBy: text("uploadedBy").references(() => user.id),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("property_document_property_idx").on(t.propertyId)],
);

// ─── Applications ────────────────────────────────────────────────────────────

export const application = pgTable(
  "application",
  {
    id: text("id").primaryKey(),
    propertyId: text("propertyId")
      .notNull()
      .references(() => property.id),
    renterId: text("renterId")
      .notNull()
      .references(() => user.id),
    status: applicationStatus("status").notNull().default("submitted"),
    moveInDate: date("moveInDate"),
    durationMonths: integer("durationMonths"),
    message: text("message"),
    // The owner/manager records the decision (PRD 4.2). Admin does not.
    decidedBy: text("decidedBy").references(() => user.id),
    decidedAt: timestamp("decidedAt"),
    decisionReason: text("decisionReason"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    index("application_property_idx").on(t.propertyId),
    index("application_renter_idx").on(t.renterId),
    index("application_status_idx").on(t.status),
  ],
);

// ─── Payments ────────────────────────────────────────────────────────────────

export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull(), // UrState reference
    providerReference: text("providerReference"),
    provider: text("provider"),
    propertyId: text("propertyId")
      .notNull()
      .references(() => property.id),
    renterId: text("renterId")
      .notNull()
      .references(() => user.id),
    ownerId: text("ownerId")
      .notNull()
      .references(() => user.id),
    applicationId: text("applicationId").references(() => application.id),
    type: paymentType("type").notNull().default("rent"),
    amountKobo: bigint("amountKobo", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: paymentStatus("status").notNull().default("initiated"),
    payoutStatus: payoutStatus("payoutStatus").notNull().default("pending"),
    method: text("method"), // "Bank Transfer", "Card"…
    periodStart: date("periodStart"),
    periodEnd: date("periodEnd"),
    failureReason: text("failureReason"),
    // Historical payments recorded during onboarding, not processed by UrState.
    isRecordedHistory: boolean("isRecordedHistory").notNull().default(false),
    flagged: boolean("flagged").notNull().default(false),
    flaggedReason: text("flaggedReason"),
    confirmedAt: timestamp("confirmedAt"),
    paidOutAt: timestamp("paidOutAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_reference_idx").on(t.reference),
    // Prevents duplicate provider callbacks from creating two records.
    uniqueIndex("payment_provider_reference_idx").on(t.providerReference),
    index("payment_status_idx").on(t.status),
    index("payment_renter_idx").on(t.renterId),
    index("payment_owner_idx").on(t.ownerId),
  ],
);

// ─── Audit log ───────────────────────────────────────────────────────────────
// PRD §8: preserve actor, timestamp and reason for material changes.

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorId: text("actorId").references(() => user.id),
    // "user" | "property" | "application" | "payment" | "identity_verification"
    entityType: text("entityType").notNull(),
    entityId: text("entityId").notNull(),
    action: text("action").notNull(), // e.g. "kyc.approved", "user.suspended"
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);
