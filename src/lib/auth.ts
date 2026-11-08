import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import { Resend } from "resend";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { user as userTable } from "../db/schema.js";
import { allowedOrigins } from "../config/origins.js";

/** Roles a person can pick for themselves. "admin" is never self-assignable. */
export const SELF_ASSIGNABLE_ROLES = ["renter", "owner"] as const;

const assertSelfAssignableRole = (role: unknown) => {
  if (role === undefined || role === null || role === "") return;
  if (!SELF_ASSIGNABLE_ROLES.includes(role as never)) {
    throw new APIError("BAD_REQUEST", {
      message: "Role must be renter or owner.",
    });
  }
};

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to ensure we point to the frontend
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4000";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
  }),

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false, // Optional because old users might not have it
        input: true, // Allows frontend to send this field (validated below)
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        // `role` accepts client input, so block anyone signing up as admin.
        before: async (data) => {
          assertSelfAssignableRole(data.role);
        },
      },
      update: {
        // Same guard for authClient.updateUser({ role }).
        // Admin promotion happens through the seed script, not this API.
        before: async (data) => {
          if ("role" in data) assertSelfAssignableRole(data.role);
        },
      },
    },
    session: {
      create: {
        // Suspended accounts cannot start a new session.
        before: async (session) => {
          const [found] = await db
            .select({ suspended: userTable.suspended })
            .from(userTable)
            .where(eq(userTable.id, session.userId));
          if (found?.suspended) {
            throw new APIError("FORBIDDEN", {
              message:
                "This account is suspended. Contact UrState support for help.",
            });
          }
        },
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    async sendResetPassword({ user, url, token }) {
      console.log("Sending reset email to:", user.email);

      const resetLink = `${frontendUrl}/reset-password?token=${token}`;

      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to: user.email,
          subject: "Reset your UrState password",
          html: `
                   <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Password Reset</h2>
                    <p>Hello ${user.name},</p>
                    <p>Click the button below to reset your password.</p>
                    <a href="${resetLink}" style="padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">
                        Reset Password
                    </a>
                </div>
                `,
        });
        console.log("Email sent successfully!");
      } catch (error) {
        console.error("Error sending email:", error);
      }
    },
  },
  emailVerification: {
    async sendVerificationEmail({ user, url, token }, request) {
      const verifyLink = `${frontendUrl}/verify-email?token=${token}`;

      await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: user.email,
        subject: "Welcome to UrState!",
        html: `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Verify your Email</h2>
                    <p>Welcome ${user.name}! Please verify your email to continue.</p>
                    <a href="${verifyLink}" style="color: blue;">Verify my account</a>
                </div>
            `,
      });
    },
    autoSignInAfterVerification: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // 2. Handle Role for Google Signup
      // mapProfileToUser: async (profile) => {
      //   return {
      //     role: "renter",
      //   };
      // },
    },
  },
  trustedOrigins: allowedOrigins,
});
