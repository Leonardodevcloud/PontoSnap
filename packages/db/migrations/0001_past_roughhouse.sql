CREATE TABLE "dispositivo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" varchar(80) NOT NULL,
	"token_hash" varchar(120) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "empregado" ADD COLUMN "matricula" varchar(30);--> statement-breakpoint
ALTER TABLE "empregado" ADD COLUMN "pin_hash" varchar(120);--> statement-breakpoint
ALTER TABLE "dispositivo" ADD CONSTRAINT "dispositivo_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empregado" ADD CONSTRAINT "uq_empregado_matricula" UNIQUE("tenant_id","matricula");--> statement-breakpoint
ALTER TABLE "dispositivo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dispositivo" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_dispositivo" ON "dispositivo"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
