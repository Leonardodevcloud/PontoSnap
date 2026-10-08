-- Migration 0039: valores de benefício com vigência
--
-- Mudar VR/VT não pode reescrever o passado. Cada valor passa a valer
-- "a partir de" uma competência (YYYY-MM = mês do benefício). O cálculo de
-- um mês usa sempre o valor vigente naquele mês.
--
--  pessoal_padrao       valor padrão da empresa (vale pra quem não tem valor próprio)
--  pessoal_clt_config   agora com histórico: uma linha por (funcionário, vigência).
--                       usa_padrao = true → segue o padrão da empresa a partir dali.

CREATE TABLE IF NOT EXISTS pessoal_padrao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  vigente_desde varchar(7) NOT NULL,
  vr_dia numeric(10,2) NOT NULL DEFAULT 0,
  cesta_mensal numeric(10,2) NOT NULL DEFAULT 0,
  vt_tipo varchar(8) NOT NULL DEFAULT 'NENHUM',
  vt_valor numeric(10,2) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_padrao UNIQUE (tenant_id, vigente_desde),
  CONSTRAINT ck_pessoal_padrao_vt CHECK (vt_tipo IN ('NENHUM','DIA','FIXO'))
);

-- Linhas que já existiam valem desde sempre (o módulo é novo).
ALTER TABLE pessoal_clt_config ADD COLUMN IF NOT EXISTS vigente_desde varchar(7) NOT NULL DEFAULT '2000-01';
ALTER TABLE pessoal_clt_config ADD COLUMN IF NOT EXISTS usa_padrao boolean NOT NULL DEFAULT false;
ALTER TABLE pessoal_clt_config DROP CONSTRAINT IF EXISTS uq_pessoal_clt_config;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_pessoal_clt_config_vig') THEN
    ALTER TABLE pessoal_clt_config ADD CONSTRAINT uq_pessoal_clt_config_vig UNIQUE (tenant_id, empregado_id, vigente_desde);
  END IF;
END $$;

ALTER TABLE pessoal_padrao ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pessoal_padrao_tenant') THEN
    CREATE POLICY pessoal_padrao_tenant ON pessoal_padrao
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON pessoal_padrao TO ponto_app';
  END IF;
END $$;
