-- Migration 0038: módulo Gestão de Pessoal
--
-- Benefícios (VR/VA, VT/combustível), prestadores (MEI e motoristas),
-- lançamentos por competência, débitos parcelados e fechamento do mês.
--
-- Os CLT NÃO são cadastrados aqui: vêm da tabela empregado (base do ponto).
-- pessoal_clt_config só guarda o que o ponto não tem (cargo, benefícios, Pix).
--
-- "Tirar do mês" nunca apaga nada: grava uma exclusão (só o mês, ou daquele
-- mês em diante). Os meses anteriores ficam intactos, e o mês fechado vira
-- um snapshot imutável em pessoal_fechamento.

CREATE TABLE IF NOT EXISTS pessoal_clt_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  cargo varchar(80),
  vr_dia numeric(10,2) NOT NULL DEFAULT 0,
  cesta_mensal numeric(10,2) NOT NULL DEFAULT 0,
  vt_tipo varchar(8) NOT NULL DEFAULT 'NENHUM',      -- NENHUM | DIA | FIXO
  vt_valor numeric(10,2) NOT NULL DEFAULT 0,
  chave_pix varchar(120),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_clt_config UNIQUE (tenant_id, empregado_id),
  CONSTRAINT ck_pessoal_vt_tipo CHECK (vt_tipo IN ('NENHUM','DIA','FIXO'))
);

CREATE TABLE IF NOT EXISTS pessoal_prestador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tipo varchar(10) NOT NULL,                          -- MEI | MOTORISTA
  nome varchar(80) NOT NULL,
  documento varchar(20),                              -- CNPJ do MEI
  funcao varchar(80),                                 -- cargo (MEI) ou categoria (motorista)
  valor_mensal numeric(12,2) NOT NULL DEFAULT 0,
  base_dias varchar(8) NOT NULL DEFAULT 'SEG_SAB',    -- SEG_SAB | SEG_SEX
  chave_pix varchar(120),
  competencia_inicio varchar(7) NOT NULL,             -- YYYY-MM
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pessoal_prestador_tipo CHECK (tipo IN ('MEI','MOTORISTA')),
  CONSTRAINT ck_pessoal_base_dias CHECK (base_dias IN ('SEG_SAB','SEG_SEX'))
);
CREATE INDEX IF NOT EXISTS idx_pessoal_prestador_tenant ON pessoal_prestador (tenant_id, tipo);

CREATE TABLE IF NOT EXISTS pessoal_exclusao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  pessoa_tipo varchar(10) NOT NULL,                   -- CLT | MEI | MOTORISTA
  pessoa_id uuid NOT NULL,
  competencia varchar(7) NOT NULL,
  escopo varchar(8) NOT NULL,                         -- MES | DIANTE
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_exclusao UNIQUE (tenant_id, pessoa_tipo, pessoa_id, competencia),
  CONSTRAINT ck_pessoal_exclusao_escopo CHECK (escopo IN ('MES','DIANTE'))
);

CREATE TABLE IF NOT EXISTS pessoal_lancamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  pessoa_tipo varchar(10) NOT NULL,
  pessoa_id uuid NOT NULL,
  competencia varchar(7) NOT NULL,
  periodo varchar(10) NOT NULL DEFAULT 'MES',         -- MES | início da semana (YYYY-MM-DD)
  he_min integer NOT NULL DEFAULT 0,
  faltas integer NOT NULL DEFAULT 0,
  feriados_trab integer NOT NULL DEFAULT 0,
  dias integer,                                       -- motorista: null = automático
  adicional numeric(12,2) NOT NULL DEFAULT 0,
  meta numeric(12,2) NOT NULL DEFAULT 0,
  meta_paga boolean NOT NULL DEFAULT false,
  meta_paga_em date,
  nf_numero varchar(60),
  nf_data date,
  pago boolean NOT NULL DEFAULT false,
  observacao text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_lancamento UNIQUE (tenant_id, pessoa_tipo, pessoa_id, competencia, periodo)
);
CREATE INDEX IF NOT EXISTS idx_pessoal_lancamento_comp ON pessoal_lancamento (tenant_id, competencia);

CREATE TABLE IF NOT EXISTS pessoal_debito (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  pessoa_tipo varchar(10) NOT NULL,
  pessoa_id uuid NOT NULL,
  descricao varchar(120) NOT NULL,
  valor_total numeric(12,2) NOT NULL,
  parcelas integer NOT NULL DEFAULT 1,
  competencia_inicio varchar(7) NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pessoal_debito_parcelas CHECK (parcelas BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_pessoal_debito_tenant ON pessoal_debito (tenant_id);

CREATE TABLE IF NOT EXISTS pessoal_fechamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  competencia varchar(7) NOT NULL,
  fechado_em timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  CONSTRAINT uq_pessoal_fechamento UNIQUE (tenant_id, competencia)
);

-- RLS (mesmo padrão das demais tabelas) + GRANT pro role da API
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pessoal_clt_config','pessoal_prestador','pessoal_exclusao','pessoal_lancamento','pessoal_debito','pessoal_fechamento'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = t || '_tenant') THEN
      EXECUTE format($p$CREATE POLICY %I ON %I
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')$p$,
        t || '_tenant', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
      EXECUTE format('GRANT ALL ON %I TO ponto_app', t);
    END IF;
  END LOOP;
END $$;
