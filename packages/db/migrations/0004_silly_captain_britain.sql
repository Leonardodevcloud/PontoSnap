CREATE TABLE "ponto_feriado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data" date NOT NULL,
	"nome" varchar(120) NOT NULL,
	"tipo" varchar(20) DEFAULT 'nacional' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ponto_horario_contratual" ADD COLUMN "dias_semana" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ponto_feriado" ADD CONSTRAINT "ponto_feriado_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_feriado" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ponto_feriado" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_feriado" ON "ponto_feriado"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
