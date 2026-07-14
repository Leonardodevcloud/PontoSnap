CREATE TABLE "ponto_escala" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"data" date NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ponto_escala" ADD CONSTRAINT "ponto_escala_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_escala" ADD CONSTRAINT "ponto_escala_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_escala" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ponto_escala" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_escala" ON "ponto_escala"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
