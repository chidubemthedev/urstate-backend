import { Router } from "express";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth.js";

const router = Router();

// POST /api/user/role
router.post("/role", requireAuth, async (req, res) => {
  try {
    const { role } = req.body;
    const currentUser = (req as any).user;

    // 1. Validation
    if (!role || (role !== "renter" && role !== "owner")) {
      res.status(400).json({
        error: "Invalid role. Must be 'renter' or 'owner'.",
      });
      return;
    }

    // 2. Database Update
    // We update the user whose ID matches the session
    await db
      .update(user)
      .set({ role: role })
      .where(eq(user.id, currentUser.id));

    res.json({ success: true, role });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
