ALTER TABLE "master_catalog" ADD COLUMN "specs" jsonb DEFAULT '[]'::jsonb NOT NULL;
