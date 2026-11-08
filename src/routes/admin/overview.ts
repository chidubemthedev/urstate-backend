import { Router } from "express";
import { and, count, desc, eq, gte, inArray, lt, ne, or, sql, sum } from "drizzle-orm";
import { db } from "../../db/index.js";
import { application, identityVerification, payment, property, user } from "../../db/schema.js";
import { percentChange } from "../../lib/http.js";

const router = Router();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const startOfMonth = (offset = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
};

const nonAdmin = or(ne(user.role, "admin"), sql`${user.role} is null`);
const n = (v: unknown) => Number(v ?? 0);

/** Counts per bucket for the last `buckets` weeks — feeds the stat-card sparklines. */
const weeklySeries = async (column: any, where: any, buckets = 10) => {
  const since = daysAgo(buckets * 7);
  const rows = await db
    .select({
      bucket: sql<number>`floor(extract(epoch from (now() - ${column})) / 604800)::int`,
      n: count(),
    })
    .from(column.table)
    .where(and(where, gte(column, since)))
    .groupBy(sql`1`);
  const series = Array.from({ length: buckets }, () => 0);
  for (const r of rows) {
    const idx = buckets - 1 - r.bucket;
    if (idx >= 0 && idx < buckets) series[idx] = r.n;
  }
  return series;
};

type Period = "weekly" | "monthly" | "annually";

/** Confirmed rent volume, bucketed for the chart. All bucketing is in UTC. */
const volumeSeries = async (period: Period) => {
  const now = new Date();
  const [y, m, d] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
  const config = {
    weekly: { unit: "day", count: 7, at: (i: number) => new Date(Date.UTC(y, m, d - i)), fmt: { weekday: "short" } },
    monthly: { unit: "month", count: 12, at: (i: number) => new Date(Date.UTC(y, m - i, 1)), fmt: { month: "short" } },
    annually: { unit: "year", count: 5, at: (i: number) => new Date(Date.UTC(y - i, 0, 1)), fmt: { year: "numeric" } },
  }[period];

  // Current window: buckets count-1 … 0. Previous window: the same span before it.
  const starts = Array.from({ length: config.count }, (_, k) => config.at(config.count - 1 - k));
  const previousStart = config.at(config.count * 2 - 1);
  const key = (date: Date) => date.toISOString().slice(0, 10);

  const confirmedAt = sql`coalesce(${payment.confirmedAt}, ${payment.createdAt})`;
  const rows = await db
    .select({
      bucket: sql<string>`to_char(date_trunc(${config.unit}, ${confirmedAt}), 'YYYY-MM-DD')`,
      totalKobo: sum(payment.amountKobo),
    })
    .from(payment)
    .where(and(eq(payment.status, "confirmed"), gte(confirmedAt, previousStart)))
    .groupBy(sql`1`);

  const byKey = new Map(rows.map((r) => [r.bucket, n(r.totalKobo)]));
  const points = starts.map((s) => ({
    label: s.toLocaleDateString("en-GB", { ...(config.fmt as Intl.DateTimeFormatOptions), timeZone: "UTC" }),
    valueKobo: byKey.get(key(s)) ?? 0,
  }));
  const total = points.reduce((a, p) => a + p.valueKobo, 0);
  const firstKey = key(starts[0]);
  const previous = rows.filter((r) => r.bucket < firstKey).reduce((a, r) => a + n(r.totalKobo), 0);

  return { period, points, totalKobo: total, changePercent: percentChange(total, previous) };
};

// GET /api/admin/overview?period=weekly|monthly|annually
router.get("/", async (req, res) => {
  const period = (["weekly", "monthly", "annually"].includes(String(req.query.period))
    ? req.query.period
    : "monthly") as Period;

  const thisMonth = startOfMonth(0);
  const lastMonth = startOfMonth(-1);
  const confirmedThisMonth = and(eq(payment.status, "confirmed"), gte(payment.confirmedAt, thisMonth));
  const confirmedLastMonth = and(
    eq(payment.status, "confirmed"),
    gte(payment.confirmedAt, lastMonth),
    lt(payment.confirmedAt, thisMonth),
  );

  const [
    [activeUsers],
    [newUsers30],
    [newUsersPrev30],
    [verifiedProps],
    [verifiedThisMonth],
    [verifiedLastMonth],
    [txThisMonth],
    [txLastMonth],
    userSpark,
    propertySpark,
    paymentSpark,
    volume,
    [pendingKyc],
    [pendingProps],
    [paymentsToReview],
    [flaggedUsers],
    [flaggedProps],
    [failedPayments],
    [disputedPayments],
    recentUsers,
    recentProps,
    recentPayments,
    recentApplications,
  ] = await Promise.all([
    db.select({ n: count() }).from(user).where(and(nonAdmin, eq(user.suspended, false))),
    db.select({ n: count() }).from(user).where(and(nonAdmin, gte(user.createdAt, daysAgo(30)))),
    db.select({ n: count() }).from(user).where(and(nonAdmin, gte(user.createdAt, daysAgo(60)), lt(user.createdAt, daysAgo(30)))),
    db.select({ n: count() }).from(property).where(eq(property.verificationStatus, "verified")),
    db.select({ n: count() }).from(property).where(and(eq(property.verificationStatus, "verified"), gte(property.reviewedAt, thisMonth))),
    db.select({ n: count() }).from(property).where(and(eq(property.verificationStatus, "verified"), gte(property.reviewedAt, lastMonth), lt(property.reviewedAt, thisMonth))),
    db.select({ n: count(), totalKobo: sum(payment.amountKobo) }).from(payment).where(confirmedThisMonth),
    db.select({ n: count(), totalKobo: sum(payment.amountKobo) }).from(payment).where(confirmedLastMonth),
    weeklySeries(user.createdAt, nonAdmin),
    weeklySeries(property.reviewedAt, eq(property.verificationStatus, "verified")),
    weeklySeries(payment.confirmedAt, eq(payment.status, "confirmed")),
    volumeSeries(period),
    db.select({ n: count() }).from(identityVerification).where(inArray(identityVerification.status, ["pending", "action_required"])),
    db.select({ n: count() }).from(property).where(inArray(property.verificationStatus, ["pending", "action_required"])),
    db.select({ n: count() }).from(payment).where(inArray(payment.status, ["pending", "disputed"])),
    db.select({ n: count() }).from(user).where(eq(user.flagged, true)),
    db.select({ n: count() }).from(property).where(eq(property.flagged, true)),
    db.select({ n: count() }).from(payment).where(and(eq(payment.status, "failed"), gte(payment.createdAt, daysAgo(7)))),
    db.select({ n: count() }).from(payment).where(eq(payment.status, "disputed")),
    db.select({ id: user.id, name: user.name, role: user.role, at: user.createdAt }).from(user).where(nonAdmin).orderBy(desc(user.createdAt)).limit(5),
    db.select({ id: property.id, name: property.name, at: property.submittedAt }).from(property).where(sql`${property.submittedAt} is not null`).orderBy(desc(property.submittedAt)).limit(5),
    db.select({ id: payment.id, reference: payment.reference, status: payment.status, at: payment.createdAt }).from(payment).orderBy(desc(payment.createdAt)).limit(5),
    db.select({ id: application.id, at: application.createdAt }).from(application).orderBy(desc(application.createdAt)).limit(5),
  ]);

  const activity = [
    ...recentUsers.map((u) => ({ kind: "user" as const, id: u.id, text: `New ${u.role ?? "user"} signed up: ${u.name}`, at: u.at, href: `/admin/users/${u.id}` })),
    ...recentProps.map((p) => ({ kind: "property" as const, id: p.id, text: `Property submitted: ${p.name}`, at: p.at!, href: `/admin/properties/${p.id}` })),
    ...recentPayments.map((p) => ({ kind: "payment" as const, id: p.id, text: `Payment ${p.status}: ${p.reference}`, at: p.at, href: `/admin/payments/${p.id}` })),
    ...recentApplications.map((a) => ({ kind: "application" as const, id: a.id, text: "New application submitted", at: a.at, href: `/admin/applications/${a.id}` })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);

  const alerts = [
    { key: "flagged_users", label: "Flagged users", count: flaggedUsers.n, href: "/admin/users" },
    { key: "flagged_properties", label: "Flagged properties", count: flaggedProps.n, href: "/admin/properties" },
    { key: "failed_payments", label: "Failed payments in the last 7 days", count: failedPayments.n, href: "/admin/payments?status=failed" },
    { key: "disputed_payments", label: "Disputed payments", count: disputedPayments.n, href: "/admin/payments?status=disputed" },
  ].filter((a) => a.count > 0);

  res.json({
    asOf: new Date().toISOString(),
    stats: {
      activeUsers: { value: activeUsers.n, changePercent: percentChange(newUsers30.n, newUsersPrev30.n), series: userSpark },
      verifiedProperties: { value: verifiedProps.n, changePercent: percentChange(verifiedThisMonth.n, verifiedLastMonth.n), series: propertySpark },
      monthlyTransactions: { value: txThisMonth.n, changePercent: percentChange(txThisMonth.n, txLastMonth.n), series: paymentSpark },
      // Rent collected on behalf of owners. Not UrState revenue (PRD §5.3).
      rentCollected: { valueKobo: n(txThisMonth.totalKobo), changePercent: percentChange(n(txThisMonth.totalKobo), n(txLastMonth.totalKobo)), series: paymentSpark },
    },
    volume,
    activity,
    pending: [
      { key: "kyc", label: "Identity checks to review", count: pendingKyc.n, href: "/admin/users" },
      { key: "properties", label: "Properties to verify", count: pendingProps.n, href: "/admin/properties?status=pending" },
      { key: "payments", label: "Pending or disputed payments", count: paymentsToReview.n, href: "/admin/payments" },
    ],
    alerts,
  });
});

export default router;
