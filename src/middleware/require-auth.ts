import type { Request, Response, NextFunction } from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Attach user to the request object so routes can use it
  (req as any).user = session.user;
  (req as any).session = session.session;

  next();
};
