-- DropForeignKey
ALTER TABLE "partner_keys" DROP CONSTRAINT "partner_keys_business_id_fkey";

-- AlterTable
ALTER TABLE "partner_keys" ALTER COLUMN "business_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "external_installations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_external_installations_business" ON "external_installations"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_installations_provider_external_unique" ON "external_installations"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "partner_keys" ADD CONSTRAINT "partner_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_installations" ADD CONSTRAINT "external_installations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
