CREATE TABLE "ponto_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"tipo" varchar(16) NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date NOT NULL,
	"minutos" integer,
	"status" varchar(12) DEFAULT 'EM_ANALISE' NOT NULL,
	"motivo_recusa" varchar(200),
	"arquivo" "bytea" NOT NULL,
	"arquivo_nome" varchar(120) NOT NULL,
	"arquivo_mime" varchar(60) NOT NULL,
	"arquivo_bytes" integer NOT NULL,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"analisado_em" timestamp with time zone,
	"analisado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "ponto_documento" ADD CONSTRAINT "ponto_documento_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_documento" ADD CONSTRAINT "ponto_documento_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_documento" ADD CONSTRAINT "ponto_documento_analisado_por_usuario_id_fk" FOREIGN KEY ("analisado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_documento_empregado" ON "ponto_documento" USING btree ("tenant_id","empregado_id","data_inicio");--> statement-breakpoint
ALTER TABLE "ponto_documento" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ponto_documento" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_documento" ON "ponto_documento"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
