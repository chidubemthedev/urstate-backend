import { sql, type SQL } from "drizzle-orm";
import { identityVerification } from "../../db/schema.js";

/**
 * Latest KYC status for a user, as a correlated subquery.
 *
 * `table` is the name (or alias) of the user table in the outer query, e.g.
 * "user", "renter", "owner". It's passed explicitly because Drizzle omits the
 * table prefix in single-table selects, which would make `"id"` resolve to
 * the subquery's own id column.
 */
export const kycStatusOf = (table: string): SQL<string> =>
  sql<string>`coalesce((
    select iv."status"::text from ${identityVerification} iv
    where iv."userId" = ${sql.identifier(table)}."id"
    order by iv."submittedAt" desc limit 1
  ), 'not_submitted')`;
