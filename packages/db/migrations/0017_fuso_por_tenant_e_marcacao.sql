ALTER TABLE "tenant" ADD COLUMN "fuso" varchar(6) DEFAULT '-0300' NOT NULL;--> statement-breakpoint
ALTER TABLE "ponto_marcacao" ADD COLUMN "fuso" varchar(6) DEFAULT '-0300' NOT NULL;