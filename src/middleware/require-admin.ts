import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";

export type AdminRequest = Request & {
  admin: { id: string; name: string; email: string };
};

/** Allows the request through only for a signed-in, non-suspended admin. */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  // Read role/suspension from the database rather than trusting session cache.
  const [current] = await db
    .select({ role: user.role, suspended: user.suspended })
    .from(user)
    .where(eq(user.id, session.user.id));

  if (current?.role !== "admin" || current.suspended) {
    res.status(403).json({ error: "You don't have access to the admin area." });
    return;
  }

  (req as AdminRequest).admin = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
  next();
};

/** The signed-in admin, set by requireAdmin. */
export const getAdmin = (req: Request) => (req as unknown as AdminRequest).admin;
