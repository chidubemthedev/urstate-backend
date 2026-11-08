import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { allowedOrigins } from "./config/origins.js";
import { HttpError } from "./lib/http.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin/index.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 1. CORS Setup (Crucial for Auth)
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // Allow cookies to be sent
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

// 2. Mount Better Auth Handler
// NOTE: Must be before express.json() for body parsing reasons in some setups
app.all("/api/auth/*path", toNodeHandler(auth));

// 3. Standard JSON middleware for your OTHER routes
app.use(express.json());

// Mount User Routes
// This prefixes all routes in that file with /api/user
app.use("/api/user", userRoutes);

// Admin dashboard API — every route requires an admin session.
app.use("/api/admin", adminRoutes);

// 4. Example Protected Route
app.get("/api/dashboard", async (req, res) => {
  // Check session
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).send("Unauthorized");
    return;
  }

  res.json({
    message: "Here is your secret data",
    user: session.user,
  });
});

// Express 5 forwards async errors here. Known errors keep their message;
// anything else is logged and returned as a generic 500.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
