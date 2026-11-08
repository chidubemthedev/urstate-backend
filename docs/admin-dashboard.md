# Admin dashboard

The admin dashboard lives in the frontend at `/admin` and talks to
`/api/admin/*` on this server. Every admin route requires a signed-in user
whose `role` is `admin`.

## First-time setup

1. **Apply the database changes**

   ```bash
   npm install
   npm run db:migrate
   ```

   This applies `drizzle/0002_admin_dashboard.sql`. It adds identity reviews,
   properties, property documents, applications, payments and an audit log,
   plus suspend/flag/phone columns on `user`. Existing users and logins are
   untouched.

   If `db:migrate` fails with "relation … already exists", the database was
   originally set up with `db:push`. Use `npm run db:push` instead.

2. **Create your admin account**

   ```bash
   ADMIN_EMAIL=you@urstate.com.ng ADMIN_PASSWORD='at-least-12-characters' npm run seed:admin
   ```

   - Safe to run again. If the email already exists, that user is promoted to
     admin and their email/password login is set to `ADMIN_PASSWORD`.
   - Optional `ADMIN_NAME` (defaults to "UrState Admin").
   - Sign in at `/login` with that email and password. You'll land on
     `/admin/dashboard`.

3. **Optional: load demo data**

   ```bash
   npm run seed:demo            # loads (or replaces) demo data
   npm run seed:demo -- --reset # removes it
   ```

   Adds 11 sample Lagos owners and renters, 8 properties, 5 applications and
   28 payments spread over ~14 months, so every screen has something to show.
   Demo users have emails ending `@demo.urstate.test` and no password, so
   nobody can sign in as them. The script refuses to run with
   `NODE_ENV=production`. Don't run it against the live database.

## What admins can and can't do

| Area | Admin can | Admin can't |
| --- | --- | --- |
| Users | Approve/reject identity checks, request more info, flag, suspend, reactivate | Delete users, edit admins, act on their own account |
| Properties | Verify, reject, request more info, flag duplicate/fraud | Publish (that's the owner's action) |
| Applications | View | Accept or reject (owners decide, PRD 4.2) |
| Payments | View, flag for review | Release, hold or refund funds (waits on the provider model and payout policy) |

Rejecting, requesting info, suspending, reactivating and flagging a
property or payment all require a reason. Every admin action is written to
`audit_log` with the actor, timestamp and reason.

Suspending a user deletes their sessions immediately, and a database hook
blocks new sign-ins until they're reactivated.

## Security change in `src/lib/auth.ts`

The `role` field accepts input from the browser (sign-up sends it). Before
this change, anyone could sign up or call `updateUser` with `role: "admin"`.
Hooks now only allow `renter` or `owner` from the client; `admin` can only
be set by `seed:admin` (or directly in the database).

## Allowed origins

CORS and Better Auth's `trustedOrigins` now share one list in
`src/config/origins.ts`. Add origins without a code change with
`ALLOWED_ORIGINS=https://a.example,https://b.example`.

## Money

All amounts are stored in kobo (`₦1 = 100`) as integers to avoid rounding
errors. The frontend formats them with `formatNaira()`.

## Local Google sign-in

When running the backend locally, set `BETTER_AUTH_URL=http://localhost:3000`
and add `http://localhost:3000/api/auth/callback/google` as an authorised
redirect URI in Google Cloud Console. Otherwise Google sends users back to
the Render deployment, which sets its cookie on the wrong domain.
