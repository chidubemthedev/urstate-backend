import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
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
          subject: "Reset your UrState password",
          // Design email template later
          html: `
                   <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Password Reset</h2>
                    <p>Hello ${user.name},</p>
                    <p>Click the button below to reset your password.</p>
                    <a href="${url}" style="padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">
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
    sendVerificationEmail: async ({ user, url, token }, request) => {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: user.email,
        subject: "Welcome to UrState!",
        html: `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Verify your Email</h2>
                    <p>Welcome ${user.name}! Please verify your email to continue.</p>
                    <a href="${url}" style="color: blue;">Verify my account</a>
                </div>
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
