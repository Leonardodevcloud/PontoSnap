CREATE TABLE "ponto_banco_mov" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"data" date NOT NULL,
	"minutos" integer NOT NULL,
	"tipo" varchar(12) NOT NULL,
	"descricao" varchar(160),
	"competencia" varchar(7),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "banco_tipo_acordo" varchar(12) DEFAULT 'NENHUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "banco_prazo_meses" integer;--> statement-breakpoint
ALTER TABLE "ponto_banco_mov" ADD CONSTRAINT "ponto_banco_mov_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_banco_mov" ADD CONSTRAINT "ponto_banco_mov_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_banco_mov_empregado" ON "ponto_banco_mov" USING btree ("tenant_id","empregado_id","data");--> statement-breakpoint
ALTER TABLE "ponto_banco_mov" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ponto_banco_mov" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_banco_mov" ON "ponto_banco_mov"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
