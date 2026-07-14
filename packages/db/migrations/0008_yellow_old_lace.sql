CREATE TABLE "ponto_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'pendente' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resultado" jsonb,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ponto_job" ADD CONSTRAINT "ponto_job_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ponto_job" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_job" ON "ponto_job"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
