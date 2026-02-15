import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to ensure we point to the frontend
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false, // Optional because old users might not have it
        input: true, // Allows frontend to send this field
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
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // 2. Handle Role for Google Signup
      mapProfileToUser: async (profile) => {
        return {
          role: "renter", // DEFAULT ROLE if not specified
          // Note: Sending dynamic roles via OAuth is complex.
          // Usually, you default to 'renter' and let them switch,
          // OR you ask them to select a role *after* Google sign-in.
        };
      },
    },
  },
  trustedOrigins: [
    "http://localhost:3000",
    "http://www.dev.urstate.com.ng",
    "https://www.urstate-git-development-chidubemthedevs-projects.vercel.app",
    "https://urstate-q8lx2dj7s-chidubemthedevs-projects.vercel.app",
  ],
});
