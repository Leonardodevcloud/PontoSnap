ALTER TABLE "tenant" ADD COLUMN "latitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "longitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "raio_metros" integer;--> statement-breakpoint
ALTER TABLE "ponto_marcacao" ADD COLUMN "observacao" varchar(200);