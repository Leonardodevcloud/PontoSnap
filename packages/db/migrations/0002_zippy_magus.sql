CREATE TABLE "certificado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pfx_cifrado" text NOT NULL,
	"senha_cifrada" text NOT NULL,
	"cn" varchar(200),
	"validade" timestamp with time zone,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_certificado_tenant" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "certificado" ADD CONSTRAINT "certificado_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificado" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "certificado" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_certificado" ON "certificado"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
