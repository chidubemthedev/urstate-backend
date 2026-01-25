import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    async sendResetPassword({ user, url }) {
      console.log("Sending reset email to:", user.email);

      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "onboarding@resend.dev",
          to: user.email,
          subject: "Reset your password",
          // Design email template later
          html: `
                    <h1>Reset your password</h1>
                    <p>Click the link below to reset your password. This link expires in 1 hour.</p>
                    <a href="${url}" style="padding: 10px 20px; background: blue; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
                    <p>If you didn't request this, please ignore this email.</p>
                `,
        });
        console.log("Email sent successfully!");
      } catch (error) {
        console.error("Error sending email:", error);
      }
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }, request) => {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: user.email,
        subject: "Verify your email",
        html: `
                <h1>Welcome, ${user.name}!</h1>
                <p>Please verify your email to continue.</p>
                <a href="${url}">Verify Email</a>
            `,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  trustedOrigins: ["http://localhost:3000"],
});
