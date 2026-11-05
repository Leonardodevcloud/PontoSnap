CREATE TABLE "ponto_holerite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"competencia" varchar(7) NOT NULL,
	"arquivo" "bytea" NOT NULL,
	"arquivo_nome" varchar(120) NOT NULL,
	"arquivo_bytes" integer NOT NULL,
	"liquido_centavos" integer,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"enviado_por" uuid,
	CONSTRAINT "uq_holerite_comp" UNIQUE("tenant_id","empregado_id","competencia")
);
--> statement-breakpoint
ALTER TABLE "ponto_holerite" ADD CONSTRAINT "ponto_holerite_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_holerite" ADD CONSTRAINT "ponto_holerite_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_holerite" ADD CONSTRAINT "ponto_holerite_enviado_por_usuario_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_holerite_empregado" ON "ponto_holerite" USING btree ("tenant_id","empregado_id","competencia");--> statement-breakpoint
ALTER TABLE "ponto_holerite" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_holerite" ON "ponto_holerite"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
