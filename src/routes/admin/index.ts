import { Router } from "express";
import { requireAdmin, getAdmin } from "../../middleware/require-admin.js";
import overview from "./overview.js";
import users from "./users.js";
import properties from "./properties.js";
import applications from "./applications.js";
import payments from "./payments.js";

const router = Router();

router.use(requireAdmin);

router.get("/me", (req, res) => {
  res.json({ admin: getAdmin(req) });
});

router.use("/overview", overview);
router.use("/users", users);
router.use("/properties", properties);
router.use("/applications", applications);
router.use("/payments", payments);

export default router;
