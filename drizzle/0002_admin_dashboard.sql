CREATE TYPE "public"."application_status" AS ENUM('submitted', 'under_review', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."occupancy_status" AS ENUM('vacant', 'reserved', 'occupied');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'pending', 'confirmed', 'failed', 'disputed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('rent', 'caution_deposit', 'service_charge');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('not_applicable', 'pending', 'processing', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('unpublished', 'published', 'paused');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('not_submitted', 'pending', 'verified', 'action_required', 'rejected');--> statement-breakpoint
CREATE TABLE "application" (
	"id" text PRIMARY KEY NOT NULL,
	"propertyId" text NOT NULL,
	"renterId" text NOT NULL,
	"status" "application_status" DEFAULT 'submitted' NOT NULL,
	"moveInDate" date,
	"durationMonths" integer,
	"message" text,
	"decidedBy" text,
	"decidedAt" timestamp,
	"decisionReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actorId" text,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"idType" text,
	"idNumber" text,
	"dateOfBirth" date,
	"address" text,
	"state" text,
	"country" text DEFAULT 'Nigeria',
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"providerReference" text,
	"reviewReason" text,
	"reviewedBy" text,
	"reviewedAt" timestamp,
	"submittedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"providerReference" text,
	"provider" text,
	"propertyId" text NOT NULL,
	"renterId" text NOT NULL,
	"ownerId" text NOT NULL,
	"applicationId" text,
	"type" "payment_type" DEFAULT 'rent' NOT NULL,
	"amountKobo" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"payoutStatus" "payout_status" DEFAULT 'pending' NOT NULL,
	"method" text,
	"periodStart" date,
	"periodEnd" date,
	"failureReason" text,
	"isRecordedHistory" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flaggedReason" text,
	"confirmedAt" timestamp,
	"paidOutAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"address" text NOT NULL,
	"city" text,
	"state" text,
	"propertyType" text,
	"category" text,
	"bedrooms" integer DEFAULT 0 NOT NULL,
	"bathrooms" integer DEFAULT 0 NOT NULL,
	"toilets" integer DEFAULT 0 NOT NULL,
	"maxOccupants" integer,
	"furnishing" text,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rentAmountKobo" bigint NOT NULL,
	"paymentFrequency" text DEFAULT 'yearly' NOT NULL,
	"cautionFeeKobo" bigint,
	"serviceChargeKobo" bigint,
	"authorityType" text,
	"verificationStatus" "review_status" DEFAULT 'not_submitted' NOT NULL,
	"verificationReason" text,
	"reviewedBy" text,
	"reviewedAt" timestamp,
	"submittedAt" timestamp,
	"publicationStatus" "publication_status" DEFAULT 'unpublished' NOT NULL,
	"occupancyStatus" "occupancy_status" DEFAULT 'vacant' NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flaggedReason" text,
	"archivedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_document" (
	"id" text PRIMARY KEY NOT NULL,
	"propertyId" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"mimeType" text,
	"sizeBytes" integer,
	"uploadedBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspendedReason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspendedAt" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "flaggedReason" text;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_propertyId_property_id_fk" FOREIGN KEY ("propertyId") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_renterId_user_id_fk" FOREIGN KEY ("renterId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_decidedBy_user_id_fk" FOREIGN KEY ("decidedBy") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verification" ADD CONSTRAINT "identity_verification_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verification" ADD CONSTRAINT "identity_verification_reviewedBy_user_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_propertyId_property_id_fk" FOREIGN KEY ("propertyId") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_renterId_user_id_fk" FOREIGN KEY ("renterId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_applicationId_application_id_fk" FOREIGN KEY ("applicationId") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_reviewedBy_user_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_document" ADD CONSTRAINT "property_document_propertyId_property_id_fk" FOREIGN KEY ("propertyId") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_document" ADD CONSTRAINT "property_document_uploadedBy_user_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_property_idx" ON "application" USING btree ("propertyId");--> statement-breakpoint
CREATE INDEX "application_renter_idx" ON "application" USING btree ("renterId");--> statement-breakpoint
CREATE INDEX "application_status_idx" ON "application" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "identity_verification_user_idx" ON "identity_verification" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "identity_verification_status_idx" ON "identity_verification" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reference_idx" ON "payment" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_reference_idx" ON "payment" USING btree ("providerReference");--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "payment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_renter_idx" ON "payment" USING btree ("renterId");--> statement-breakpoint
CREATE INDEX "payment_owner_idx" ON "payment" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "property_owner_idx" ON "property" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "property_verification_idx" ON "property" USING btree ("verificationStatus");--> statement-breakpoint
CREATE INDEX "property_document_property_idx" ON "property_document" USING btree ("propertyId");