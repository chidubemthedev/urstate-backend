/**
 * Creates (or promotes) an admin account. Safe to run more than once.
 *
 *   ADMIN_EMAIL=you@urstate.com.ng ADMIN_PASSWORD='a-long-password' npm run seed:admin
 *
 * Optional: ADMIN_NAME (defaults to "UrState Admin").
 * If the email already belongs to a user, that user is promoted to admin and
 * their email/password login is set to ADMIN_PASSWORD.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db } from "../db/index.js";
import { account, user } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "UrState Admin";

const fail = (message: string): never => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

if (!email || !email.includes("@")) fail("Set ADMIN_EMAIL to a valid email address.");
if (!password || password.length < 12) fail("Set ADMIN_PASSWORD to at least 12 characters.");

const main = async () => {
  const hash = await hashPassword(password!);
  const now = new Date();

  const userId = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email!));

    let id: string;
    if (existing) {
      id = existing.id;
      await tx
        .update(user)
        .set({ role: "admin", emailVerified: true, suspended: false, suspendedReason: null, suspendedAt: null, updatedAt: now })
        .where(eq(user.id, id));
    } else {
      id = randomUUID();
      await tx.insert(user).values({ id, name, email: email!, emailVerified: true, role: "admin", createdAt: now, updatedAt: now });
    }

    // Better Auth stores email/password logins as a "credential" account.
    const [credential] = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, id), eq(account.providerId, "credential")));

    if (credential) {
      await tx.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, credential.id));
    } else {
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: hash,
        createdAt: now,
        updatedAt: now,
      });
    }

    await recordAudit(
      { actorId: null, entityType: "user", entityId: id, action: existing ? "user.promoted_to_admin" : "admin.created", reason: "seed-admin script" },
      tx,
    );
    return { id, created: !existing };
  });

  console.log(
    userId.created
      ? `✔ Admin created: ${email}. Sign in at /login.`
      : `✔ ${email} is now an admin and its password was reset. Sign in at /login.`,
  );
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
