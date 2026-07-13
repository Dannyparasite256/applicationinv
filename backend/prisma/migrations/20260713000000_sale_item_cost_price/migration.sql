-- Snapshot unit cost on each sale line for accurate historical COGS / profit

ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "costPrice" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- Backfill from current product cost for historical rows (best available estimate)
UPDATE "sale_items" si
SET "costPrice" = p."costPrice"
FROM "products" p
WHERE si."productId" = p."id"
  AND (si."costPrice" IS NULL OR si."costPrice" = 0)
  AND p."costPrice" > 0;
