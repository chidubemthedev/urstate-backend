/**
 * Loads sample owners, renters, properties, applications and payments so the
 * admin dashboard has something to show in development.
 *
 *   npm run seed:demo           # replace demo data
 *   npm run seed:demo -- --reset   # remove demo data only
 *
 * Every demo user's email ends in @demo.urstate.test, which is how --reset
 * finds them. Demo users have no password, so nobody can sign in as them.
 * Never run this against production.
 */
import { randomUUID } from "node:crypto";
import { inArray, like, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  application,
  auditLog,
  identityVerification,
  payment,
  property,
  propertyDocument,
  session,
  user,
} from "../db/schema.js";

const DOMAIN = "@demo.urstate.test";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const naira = (n: number) => n * 100; // stored in kobo
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const photo = (id: string) => `https://images.unsplash.com/${id}?w=1200&h=760&fit=crop&auto=format`;

if (process.env.NODE_ENV === "production") {
  console.error("✖ Refusing to load demo data with NODE_ENV=production.");
  process.exit(1);
}

const reset = async () => {
  const demoUsers = await db.select({ id: user.id }).from(user).where(like(user.email, `%${DOMAIN}`));
  const ids = demoUsers.map((u) => u.id);
  if (!ids.length) return 0;

  const props = await db.select({ id: property.id }).from(property).where(inArray(property.ownerId, ids));
  const propIds = props.map((p) => p.id);
  const pays = await db.select({ id: payment.id }).from(payment).where(or(inArray(payment.renterId, ids), inArray(payment.ownerId, ids)));
  const apps = propIds.length
    ? await db.select({ id: application.id }).from(application).where(inArray(application.propertyId, propIds))
    : [];
  const entityIds = [...ids, ...propIds, ...pays.map((p) => p.id), ...apps.map((a) => a.id)];

  await db.transaction(async (tx) => {
    if (entityIds.length) await tx.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
    await tx.delete(payment).where(or(inArray(payment.renterId, ids), inArray(payment.ownerId, ids)));
    await tx.delete(application).where(inArray(application.renterId, ids));
    if (propIds.length) {
      await tx.delete(application).where(inArray(application.propertyId, propIds));
      await tx.delete(propertyDocument).where(inArray(propertyDocument.propertyId, propIds));
      await tx.delete(property).where(inArray(property.id, propIds));
    }
    await tx.delete(identityVerification).where(inArray(identityVerification.userId, ids));
    await tx.delete(session).where(inArray(session.userId, ids));
    await tx.delete(user).where(inArray(user.id, ids));
  });
  return ids.length;
};

type DemoUser = { key: string; name: string; role: "owner" | "renter"; phone: string; joined: number; kyc?: "pending" | "verified" | "rejected" | "action_required"; idType?: string; state?: string; flagged?: boolean; suspended?: boolean };

const people: DemoUser[] = [
  { key: "emeka", name: "Chukwuemeka Eze", role: "owner", phone: "+234 802 345 6789", joined: 280, kyc: "pending", idType: "International Passport", state: "Lagos" },
  { key: "ifeoma", name: "Ifeoma Nwachukwu", role: "owner", phone: "+234 805 678 9012", joined: 240, kyc: "verified", idType: "NIN", state: "Lagos" },
  { key: "ngozi", name: "Ngozi Bello", role: "owner", phone: "+234 803 456 7890", joined: 210, kyc: "verified", idType: "Driver's Licence", state: "Lagos" },
  { key: "kelechi", name: "Kelechi Obi", role: "owner", phone: "+234 807 890 1234", joined: 150, kyc: "verified", idType: "NIN", state: "Lagos" },
  { key: "fatima", name: "Fatima Al-Hassan", role: "owner", phone: "+234 808 901 2345", joined: 60, kyc: "rejected", idType: "Voter's Card", state: "Lagos", flagged: true },
  { key: "adaeze", name: "Adaeze Okonkwo", role: "renter", phone: "+234 801 234 5678", joined: 300, kyc: "verified", idType: "NIN", state: "Lagos" },
  { key: "tunde", name: "Tunde Afolabi", role: "renter", phone: "+234 804 567 8901", joined: 120, kyc: "rejected", idType: "Voter's Card", state: "Lagos", flagged: true, suspended: true },
  { key: "seun", name: "Seun Adeyemi", role: "renter", phone: "+234 806 789 0123", joined: 45, kyc: "pending", idType: "International Passport", state: "Lagos" },
  { key: "bisola", name: "Bisola Ogunleye", role: "renter", phone: "+234 809 012 3456", joined: 20, kyc: "action_required", idType: "NIN", state: "Lagos" },
  { key: "femi", name: "Femi Ojo", role: "renter", phone: "+234 810 123 4567", joined: 6 },
  { key: "amaka", name: "Amaka Chukwu", role: "renter", phone: "+234 811 234 5678", joined: 2, kyc: "pending", idType: "NIN", state: "Lagos" },
];

const main = async () => {
  const removed = await reset();
  if (process.argv.includes("--reset")) {
    console.log(`✔ Removed ${removed} demo users and their records.`);
    process.exit(0);
  }

  const id: Record<string, string> = {};
  for (const p of people) id[p.key] = randomUUID();

  await db.insert(user).values(
    people.map((p) => ({
      id: id[p.key],
      name: p.name,
      email: `${p.name.toLowerCase().replace(/[^a-z]+/g, ".")}${DOMAIN}`,
      emailVerified: true,
      role: p.role,
      phone: p.phone,
      flagged: !!p.flagged,
      flaggedReason: p.flagged ? "Mismatch between ID name and account name." : null,
      suspended: !!p.suspended,
      suspendedReason: p.suspended ? "Repeated failed identity checks." : null,
      suspendedAt: p.suspended ? ago(10) : null,
      createdAt: ago(p.joined),
      updatedAt: ago(p.joined),
    })),
  );

  await db.insert(identityVerification).values(
    people
      .filter((p) => p.kyc)
      .map((p, i) => ({
        id: randomUUID(),
        userId: id[p.key],
        status: p.kyc!,
        idType: p.idType,
        idNumber: `${p.idType === "NIN" ? "" : "A"}${(70000000000 + i * 7919).toString().slice(0, 11)}`,
        dateOfBirth: `19${85 + (i % 12)}-0${(i % 9) + 1}-1${i % 9}`,
        address: `${12 + i} Admiralty Way, Lekki Phase 1`,
        state: p.state,
        country: "Nigeria",
        documents: [
          { label: `${p.idType} (front)`, url: photo("photo-1554224155-6726b3ff858f") },
          { label: `${p.idType} (back)`, url: photo("photo-1554224155-6726b3ff858f") },
        ],
        reviewReason: p.kyc === "rejected" ? "The ID photo is blurry. Upload a clear photo of the full card." : p.kyc === "action_required" ? "Add a photo of the back of your ID." : null,
        submittedAt: ago(Math.max(1, p.joined - 3)),
        reviewedAt: p.kyc === "pending" ? null : ago(Math.max(1, p.joined - 5)),
      })),
  );

  type DemoProperty = {
    key: string; owner: string; name: string; address: string; city: string; type: string;
    beds: number; baths: number; rent: number; photo: string;
    status: "not_submitted" | "pending" | "verified" | "action_required" | "rejected";
    submitted?: number; reason?: string; flagged?: boolean;
    occupancy?: "vacant" | "reserved" | "occupied";
    published?: "unpublished" | "published" | "paused";
  };
  const props: DemoProperty[] = [
    { key: "ikoyi", owner: "emeka", name: "4-bed detached house", address: "14 Bourdillon Road", city: "Ikoyi", type: "Duplex", beds: 4, baths: 4, rent: 18_000_000, status: "pending", photo: "photo-1694771170485-e01443be2643", submitted: 3 },
    { key: "lekki", owner: "ifeoma", name: "Modern 3-bed apartment", address: "7 Admiralty Way", city: "Lekki Phase 1", type: "Apartment", beds: 3, baths: 3, rent: 6_500_000, status: "verified", occupancy: "occupied", published: "unpublished", photo: "photo-1673563932832-a0c9e0ed26f8", submitted: 200 },
    { key: "yaba", owner: "ngozi", name: "2-bed flat near Unilag", address: "22 Herbert Macaulay Way", city: "Yaba", type: "Apartment", beds: 2, baths: 2, rent: 2_400_000, status: "verified", published: "published", photo: "photo-1674758979141-4e3521ba7321", submitted: 160 },
    { key: "ikeja", owner: "kelechi", name: "Self-contained studio", address: "17 Allen Avenue", city: "Ikeja", type: "Studio", beds: 1, baths: 1, rent: 1_200_000, status: "verified", published: "published", photo: "photo-1673563932782-28daf64ff066", submitted: 120 },
    { key: "surulere", owner: "kelechi", name: "3-bed terrace", address: "5 Adeniran Ogunsanya Street", city: "Surulere", type: "Terrace", beds: 3, baths: 3, rent: 3_800_000, status: "action_required", photo: "photo-1694771170304-42b0b9b8d80d", submitted: 9, reason: "Upload the authorisation letter from the owner." },
    { key: "ajah", owner: "fatima", name: "4-bed semi-detached duplex", address: "2 Abraham Adesanya Road", city: "Ajah", type: "Duplex", beds: 4, baths: 5, rent: 5_000_000, status: "rejected", photo: "photo-1527169809256-51bcc03eef15", submitted: 40, reason: "The deed of assignment names a different owner.", flagged: true },
    { key: "gbagada", owner: "ngozi", name: "Mini flat", address: "9 Ifako Road", city: "Gbagada", type: "Apartment", beds: 1, baths: 1, rent: 1_500_000, status: "pending", photo: "photo-1659622543730-b393861b0c35", submitted: 1 },
    { key: "vi", owner: "ifeoma", name: "Office floor", address: "30 Adeola Odeku Street", city: "Victoria Island", type: "Commercial", beds: 0, baths: 2, rent: 25_000_000, status: "not_submitted", photo: "photo-1694771169758-f7036fd5ad67" },
  ];

  const pid: Record<string, string> = {};
  for (const p of props) pid[p.key] = randomUUID();

  await db.insert(property).values(
    props.map((p) => ({
      id: pid[p.key],
      ownerId: id[p.owner],
      name: p.name,
      description: `A well-kept ${p.name.toLowerCase()} in ${p.city}, Lagos, with steady water, prepaid electricity and estate security.`,
      address: p.address,
      city: p.city,
      state: "Lagos",
      propertyType: p.type,
      category: "long_term",
      bedrooms: p.beds,
      bathrooms: p.baths,
      toilets: p.baths + 1,
      amenities: ["Water supply", "Security", "Parking"],
      photos: [photo(p.photo), photo("photo-1663811398994-0b91f717d1c0"), photo("photo-1663811396969-3cb6b5522ca8")],
      rentAmountKobo: naira(p.rent),
      paymentFrequency: "yearly",
      cautionFeeKobo: naira(Math.round(p.rent * 0.1)),
      serviceChargeKobo: naira(250_000),
      authorityType: p.owner === "kelechi" ? "manager" : "owner",
      verificationStatus: p.status,
      verificationReason: p.reason ?? null,
      submittedAt: p.submitted !== undefined ? ago(p.submitted) : null,
      reviewedAt: ["verified", "rejected", "action_required"].includes(p.status) ? ago((p.submitted ?? 10) - 1) : null,
      publicationStatus: p.published ?? "unpublished",
      occupancyStatus: p.occupancy ?? "vacant",
      flagged: !!p.flagged,
      flaggedReason: p.flagged ? "Possible duplicate of another listing." : null,
      createdAt: ago((p.submitted ?? 5) + 2),
      updatedAt: ago(p.submitted ?? 5),
    })),
  );

  await db.insert(propertyDocument).values(
    props
      .filter((p) => p.status !== "not_submitted")
      .flatMap((p) => [
        { id: randomUUID(), propertyId: pid[p.key], kind: p.owner === "kelechi" ? "management_authority" : "ownership_evidence", name: p.owner === "kelechi" ? "Authorisation letter.pdf" : "Deed of assignment.pdf", url: "https://example.com/demo-document.pdf", mimeType: "application/pdf", sizeBytes: 1_240_000, uploadedBy: id[p.owner] },
        { id: randomUUID(), propertyId: pid[p.key], kind: "lease", name: "Lease agreement.pdf", url: "https://example.com/demo-lease.pdf", mimeType: "application/pdf", sizeBytes: 420_000, uploadedBy: id[p.owner] },
      ]),
  );

  const apps = [
    { key: "a1", prop: "lekki", renter: "adaeze", status: "accepted", days: 190, decided: true },
    { key: "a2", prop: "yaba", renter: "seun", status: "under_review", days: 6 },
    { key: "a3", prop: "ikeja", renter: "femi", status: "submitted", days: 2 },
    { key: "a4", prop: "yaba", renter: "bisola", status: "rejected", days: 12, decided: true, reason: "Unit reserved for an earlier applicant." },
    { key: "a5", prop: "ikeja", renter: "amaka", status: "withdrawn", days: 1 },
  ] as const;
  const aid: Record<string, string> = {};
  for (const a of apps) aid[a.key] = randomUUID();

  await db.insert(application).values(
    apps.map((a) => {
      const owner = props.find((p) => p.key === a.prop)!.owner;
      return {
        id: aid[a.key],
        propertyId: pid[a.prop],
        renterId: id[a.renter],
        status: a.status,
        moveInDate: isoDate(ago(a.days - 30)),
        durationMonths: 12,
        message: "I work nearby and would like a 12-month lease.",
        decidedBy: "decided" in a ? id[owner] : null,
        decidedAt: "decided" in a ? ago(a.days - 2) : null,
        decisionReason: "reason" in a ? a.reason : null,
        createdAt: ago(a.days),
        updatedAt: ago(Math.max(0, a.days - 2)),
      };
    }),
  );

  // Payments spread over ~14 months so every chart period has data.
  const payRows: (typeof payment.$inferInsert)[] = [];
  const addPayment = (o: { prop: string; renter: string; type: "rent" | "caution_deposit" | "service_charge"; amount: number; days: number; status: (typeof payment.$inferInsert)["status"]; payout?: (typeof payment.$inferInsert)["payoutStatus"]; failure?: string; history?: boolean }) => {
    const owner = props.find((p) => p.key === o.prop)!.owner;
    const created = ago(o.days);
    const n = payRows.length + 1;
    payRows.push({
      id: randomUUID(),
      reference: `URS-DEMO-${String(n).padStart(5, "0")}`,
      providerReference: o.status === "initiated" ? null : `DEMO-PSP-${String(n).padStart(6, "0")}`,
      provider: "demo",
      propertyId: pid[o.prop],
      renterId: id[o.renter],
      ownerId: id[owner],
      type: o.type,
      amountKobo: naira(o.amount),
      status: o.status,
      payoutStatus: o.status === "confirmed" ? (o.payout ?? "paid") : "not_applicable",
      method: n % 3 === 0 ? "Card" : "Bank transfer",
      periodStart: o.type === "rent" ? isoDate(created) : null,
      periodEnd: o.type === "rent" ? isoDate(new Date(created.getTime() + 365 * DAY)) : null,
      failureReason: o.failure ?? null,
      isRecordedHistory: !!o.history,
      confirmedAt: o.status === "confirmed" || o.status === "refunded" ? new Date(created.getTime() + 15 * 60_000) : null,
      paidOutAt: o.status === "confirmed" && (o.payout ?? "paid") === "paid" ? new Date(created.getTime() + 2 * DAY) : null,
      createdAt: created,
      updatedAt: created,
    });
  };

  addPayment({ prop: "lekki", renter: "adaeze", type: "rent", amount: 6_500_000, days: 420, status: "confirmed", history: true });
  addPayment({ prop: "lekki", renter: "adaeze", type: "rent", amount: 6_500_000, days: 185, status: "confirmed" });
  addPayment({ prop: "lekki", renter: "adaeze", type: "caution_deposit", amount: 650_000, days: 185, status: "confirmed", payout: "pending" });
  addPayment({ prop: "lekki", renter: "adaeze", type: "service_charge", amount: 250_000, days: 185, status: "confirmed" });
  for (let m = 11; m >= 0; m--) {
    addPayment({ prop: "ikeja", renter: m % 2 ? "femi" : "seun", type: "service_charge", amount: 100_000 + m * 15_000, days: m * 30 + 4, status: "confirmed", payout: m < 1 ? "processing" : "paid" });
  }
  addPayment({ prop: "yaba", renter: "seun", type: "rent", amount: 2_400_000, days: 3, status: "pending" });
  addPayment({ prop: "yaba", renter: "seun", type: "caution_deposit", amount: 240_000, days: 3, status: "initiated" });
  addPayment({ prop: "ikeja", renter: "tunde", type: "rent", amount: 1_200_000, days: 5, status: "failed", failure: "Declined by the issuing bank." });
  addPayment({ prop: "ikeja", renter: "amaka", type: "rent", amount: 1_200_000, days: 1, status: "disputed" });
  addPayment({ prop: "ikeja", renter: "femi", type: "caution_deposit", amount: 120_000, days: 50, status: "refunded" });
  for (let d = 6; d >= 0; d--) {
    addPayment({ prop: "yaba", renter: "adaeze", type: "service_charge", amount: 50_000 + d * 12_500, days: d, status: "confirmed", payout: "pending" });
  }

  await db.insert(payment).values(payRows);

  // A little history so timelines aren't empty.
  await db.insert(auditLog).values([
    ...props
      .filter((p) => p.status === "verified" || p.status === "rejected" || p.status === "action_required")
      .map((p) => ({ id: randomUUID(), actorId: null, entityType: "property", entityId: pid[p.key], action: `property.${p.status}`, reason: p.reason ?? null, createdAt: ago((p.submitted ?? 10) - 1) })),
    ...apps
      .filter((a) => "decided" in a)
      .map((a) => ({ id: randomUUID(), actorId: id[props.find((p) => p.key === a.prop)!.owner], entityType: "application", entityId: aid[a.key], action: `application.${a.status}`, reason: "reason" in a ? a.reason : null, createdAt: ago(a.days - 2) })),
    ...payRows
      .filter((p) => p.status === "confirmed")
      .slice(0, 6)
      .map((p) => ({ id: randomUUID(), actorId: null, entityType: "payment", entityId: p.id!, action: "payment.confirmed", reason: null, metadata: { source: "provider" }, createdAt: p.confirmedAt! })),
    { id: randomUUID(), actorId: null, entityType: "user", entityId: id.tunde, action: "user.suspended", reason: "Repeated failed identity checks.", createdAt: ago(10) },
  ]);

  console.log(`✔ Demo data loaded: ${people.length} users, ${props.length} properties, ${apps.length} applications, ${payRows.length} payments.`);
  console.log("  Remove it any time with: npm run seed:demo -- --reset");
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
