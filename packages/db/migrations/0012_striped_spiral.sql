CREATE TABLE "ponto_afastamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"tipo" varchar(16) NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date NOT NULL,
	"observacao" varchar(200),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "ponto_afastamento" ADD CONSTRAINT "ponto_afastamento_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_afastamento" ADD CONSTRAINT "ponto_afastamento_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_afastamento" ADD CONSTRAINT "ponto_afastamento_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_afastamento_empregado" ON "ponto_afastamento" USING btree ("tenant_id","empregado_id","data_inicio");--> statement-breakpoint
ALTER TABLE "ponto_afastamento" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ponto_afastamento" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_afastamento" ON "ponto_afastamento"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
