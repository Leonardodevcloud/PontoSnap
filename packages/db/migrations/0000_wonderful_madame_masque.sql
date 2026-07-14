CREATE TYPE "public"."perfil" AS ENUM('MASTER', 'ADMIN_CLIENTE', 'RH', 'COLABORADOR');--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj" varchar(14) NOT NULL,
	"razao_social" varchar(150) NOT NULL,
	"local_prestacao" varchar(200),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" varchar(180) NOT NULL,
	"senha_hash" varchar(120) NOT NULL,
	"perfil" "perfil" NOT NULL,
	"empregado_id" uuid,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "ponto_rep" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo_id_empregador" smallint NOT NULL,
	"documento_empregador" varchar(14) NOT NULL,
	"cno_caepf" varchar(14),
	"razao_social" varchar(150) NOT NULL,
	"numero_inpi" varchar(17) NOT NULL,
	"tipo_id_desenvolvedor" smallint NOT NULL,
	"documento_desenvolvedor" varchar(14) NOT NULL,
	"ultimo_nsr" bigint DEFAULT 0 NOT NULL,
	"ultimo_hash" varchar(64),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rep_tenant" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "empregado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cpf" varchar(11) NOT NULL,
	"nome" varchar(52) NOT NULL,
	"pis" varchar(11),
	"horario_contratual_id" uuid,
	"matricula_esocial" varchar(30),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_empregado_cpf" UNIQUE("tenant_id","cpf")
);
--> statement-breakpoint
CREATE TABLE "ponto_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"nsr" bigint NOT NULL,
	"tipo_evento" smallint NOT NULL,
	"dt_gravacao" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_evento_nsr" UNIQUE("rep_id","nsr")
);
--> statement-breakpoint
CREATE TABLE "ponto_marcacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"nsr" bigint NOT NULL,
	"tipo_registro" char(1) DEFAULT '7' NOT NULL,
	"cpf" varchar(11) NOT NULL,
	"dt_marcacao" timestamp with time zone NOT NULL,
	"dt_gravacao" timestamp with time zone DEFAULT now() NOT NULL,
	"coletor" smallint NOT NULL,
	"online_offline" smallint DEFAULT 0 NOT NULL,
	"hash_registro" char(64) NOT NULL,
	"hash_anterior" char(64),
	"ip_origem" varchar(45),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_marcacao_nsr" UNIQUE("rep_id","nsr"),
	CONSTRAINT "uq_marcacao_hash" UNIQUE("rep_id","hash_registro")
);
--> statement-breakpoint
CREATE TABLE "ponto_ausencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"tipo" smallint NOT NULL,
	"data" date NOT NULL,
	"qt_minutos" integer,
	"tipo_mov_bh" smallint,
	"rep_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ponto_horario_contratual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"codigo" varchar(30) NOT NULL,
	"dur_jornada_min" integer NOT NULL,
	"pares" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ponto_tratamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"empregado_id" uuid NOT NULL,
	"marcacao_id" uuid,
	"dt_marcacao" timestamp with time zone NOT NULL,
	"tp_marc" char(1) NOT NULL,
	"seq_ent_saida" smallint NOT NULL,
	"fonte_marc" char(1) DEFAULT 'O' NOT NULL,
	"cod_hor_contratual" varchar(30),
	"motivo" varchar(150),
	"criado_por" varchar(14),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_rep" ADD CONSTRAINT "ponto_rep_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empregado" ADD CONSTRAINT "empregado_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_evento" ADD CONSTRAINT "ponto_evento_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_evento" ADD CONSTRAINT "ponto_evento_rep_id_ponto_rep_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."ponto_rep"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_marcacao" ADD CONSTRAINT "ponto_marcacao_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_marcacao" ADD CONSTRAINT "ponto_marcacao_rep_id_ponto_rep_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."ponto_rep"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_ausencia" ADD CONSTRAINT "ponto_ausencia_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_ausencia" ADD CONSTRAINT "ponto_ausencia_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_ausencia" ADD CONSTRAINT "ponto_ausencia_rep_id_ponto_rep_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."ponto_rep"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_horario_contratual" ADD CONSTRAINT "ponto_horario_contratual_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_tratamento" ADD CONSTRAINT "ponto_tratamento_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_tratamento" ADD CONSTRAINT "ponto_tratamento_empregado_id_empregado_id_fk" FOREIGN KEY ("empregado_id") REFERENCES "public"."empregado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ponto_tratamento" ADD CONSTRAINT "ponto_tratamento_marcacao_id_ponto_marcacao_id_fk" FOREIGN KEY ("marcacao_id") REFERENCES "public"."ponto_marcacao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_marcacao_emp" ON "ponto_marcacao" USING btree ("tenant_id","cpf","dt_marcacao");--> statement-breakpoint

-- ============================================================
-- IMUTABILIDADE das marcações (Portaria MTP 671/2021)
-- Bloqueia UPDATE e DELETE na ponto_marcacao via trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION ponto_bloquear_alteracao()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Marcacoes de ponto sao imutaveis (Portaria MTP 671/2021). Operacao % bloqueada.', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_ponto_marcacao_imutavel
  BEFORE UPDATE OR DELETE ON ponto_marcacao
  FOR EACH ROW EXECUTE FUNCTION ponto_bloquear_alteracao();
--> statement-breakpoint

-- ============================================================
-- ROW-LEVEL SECURITY (isolamento entre tenants)
-- Cada query enxerga apenas o tenant fixado em app.current_tenant.
-- MASTER (app.is_master = 'on') enxerga tudo.
-- FORCE garante que vale até para o dono da tabela.
-- ============================================================
ALTER TABLE "usuario" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usuario" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_usuario" ON "usuario"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "ponto_rep" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ponto_rep" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_rep" ON "ponto_rep"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "empregado" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "empregado" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_empregado" ON "empregado"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "ponto_marcacao" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ponto_marcacao" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_marcacao" ON "ponto_marcacao"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "ponto_evento" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ponto_evento" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_evento" ON "ponto_evento"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "ponto_horario_contratual" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ponto_horario_contratual" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_horario_contratual" ON "ponto_horario_contratual"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "ponto_tratamento" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ponto_tratamento" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_tratamento" ON "ponto_tratamento"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
ALTER TABLE "ponto_ausencia" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ponto_ausencia" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "isolamento_tenant_ponto_ausencia" ON "ponto_ausencia"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
--> statement-breakpoint
