CREATE TABLE "assinatura" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plano_id" uuid,
	"modo_override" varchar(16),
	"valor_override" numeric(10, 2),
	"dia_vencimento" integer DEFAULT 10 NOT NULL,
	"situacao" varchar(12) DEFAULT 'ativa' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assinatura_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "cobranca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"competencia" varchar(7) NOT NULL,
	"valor" numeric(10, 2) NOT NULL,
	"qtd_funcionarios" integer,
	"vencimento" date NOT NULL,
	"status" varchar(12) DEFAULT 'ABERTA' NOT NULL,
	"boleto_url" varchar(500),
	"pago_em" timestamp with time zone,
	"aviso_pagamento_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plano" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(80) NOT NULL,
	"modo" varchar(16) DEFAULT 'FIXO' NOT NULL,
	"valor" numeric(10, 2) NOT NULL,
	"descricao" varchar(160),
	"ativo" varchar(3) DEFAULT 'sim' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_plano_id_plano_id_fk" FOREIGN KEY ("plano_id") REFERENCES "public"."plano"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assinatura_tenant" ON "assinatura" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cobranca_tenant" ON "cobranca" USING btree ("tenant_id","competencia");--> statement-breakpoint
-- plano é catálogo global do MASTER: sem RLS por tenant, só o app acessa via role.
-- assinatura e cobranca são por tenant: a empresa vê só a própria.
ALTER TABLE "assinatura" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assinatura" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_assinatura" ON "assinatura"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );--> statement-breakpoint
ALTER TABLE "cobranca" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cobranca" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "isolamento_cobranca" ON "cobranca"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );--> statement-breakpoint
ALTER TABLE "plano" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plano" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- plano: só o MASTER lê e escreve (não tem tenant_id; a empresa não vê o catálogo).
CREATE POLICY "plano_so_master" ON "plano"
  USING (current_setting('app.is_master', true) = 'on')
  WITH CHECK (current_setting('app.is_master', true) = 'on');
