import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema.js";
import "dotenv/config";

// 1. Configure Neon to use the 'ws' package (Required for Node.js apps)
neonConfig.webSocketConstructor = ws;

// 2. Create the Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 3. Export the Drizzle instance
export const db = drizzle(pool, { schema });
