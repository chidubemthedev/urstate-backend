// Single source of truth for frontends allowed to call this API.
// Used by both CORS (src/index.ts) and Better Auth's trustedOrigins.
// Add extra origins without a code change via ALLOWED_ORIGINS (comma-separated).
const defaults = [
  "http://localhost:4000",
  "http://www.dev.urstate.com.ng",
  "https://dev.urstate.com.ng",
  "https://www.dev.urstate.com.ng",
  "https://www.urstate-git-development-chidubemthedevs-projects.vercel.app",
  "https://urstate-q8lx2dj7s-chidubemthedevs-projects.vercel.app",
];

const extra = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const allowedOrigins = [...new Set([...defaults, ...extra])];
