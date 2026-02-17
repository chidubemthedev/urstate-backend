import express from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import userRoutes from "./routes/user.routes.js";

const app = express();
const PORT = 3000;

// 1. CORS Setup (Crucial for Auth)
app.use(
  cors({
    origin: [
      "http://localhost:4000",
      "http://www.dev.urstate.com.ng",
      "https://dev.urstate.com.ng",
      "https://www.dev.urstate.com.ng",
      "https://www.urstate-git-development-chidubemthedevs-projects.vercel.app",
      "https://urstate-q8lx2dj7s-chidubemthedevs-projects.vercel.app",
    ], // Your Frontend
    credentials: true, // Allow cookies to be sent
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.options("/*", cors());

// 2. Mount Better Auth Handler
// NOTE: Must be before express.json() for body parsing reasons in some setups
app.all("/api/auth/*path", toNodeHandler(auth));

// 3. Standard JSON middleware for your OTHER routes
app.use(express.json());

// Mount User Routes
// This prefixes all routes in that file with /api/user
app.use("/api/user", userRoutes);

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
