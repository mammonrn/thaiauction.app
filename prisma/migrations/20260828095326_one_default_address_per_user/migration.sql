-- Enforce "at most one default shipping address per user" in the database.
--
-- This is a PARTIAL unique index: uniqueness applies only to rows where
-- isDefault is true, so a user may still keep any number of non-default
-- addresses. Prisma's schema language cannot express a WHERE clause on an
-- index, so this migration is hand-written SQL and the index is intentionally
-- absent from schema.prisma.
--
-- The application already clears the previous default before setting a new one
-- inside a transaction; this index is the backstop that keeps the invariant
-- true even for a code path that forgets to, or two concurrent requests that
-- interleave.
CREATE UNIQUE INDEX "shipping_addresses_one_default_per_user"
  ON "shipping_addresses" ("userId")
  WHERE "isDefault";
