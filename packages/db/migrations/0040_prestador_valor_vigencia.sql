-- Migration 0040: valor do contrato de MEI/motorista com vigência
--
-- Reajuste vale "a partir de" uma competência e nunca reescreve meses
-- anteriores (fechados ou não). Cada mês usa a linha mais recente <= ele.

CREATE TABLE IF NOT EXISTS pessoal_prestador_valor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  prestador_id uuid NOT NULL REFERENCES pessoal_prestador(id),
  vigente_desde varchar(7) NOT NULL,
  valor_mensal numeric(12,2) NOT NULL,
  base_dias varchar(8) NOT NULL DEFAULT 'SEG_SAB',
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_prestador_valor UNIQUE (tenant_id, prestador_id, vigente_desde),
  CONSTRAINT ck_pessoal_prestador_valor_base CHECK (base_dias IN ('SEG_SAB','SEG_SEX'))
);

-- Quem já existe: o valor atual vale desde o início do contrato.
INSERT INTO pessoal_prestador_valor (tenant_id, prestador_id, vigente_desde, valor_mensal, base_dias)
SELECT tenant_id, id, competencia_inicio, valor_mensal, base_dias FROM pessoal_prestador
ON CONFLICT (tenant_id, prestador_id, vigente_desde) DO NOTHING;

ALTER TABLE pessoal_prestador_valor ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pessoal_prestador_valor_tenant') THEN
    CREATE POLICY pessoal_prestador_valor_tenant ON pessoal_prestador_valor
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON pessoal_prestador_valor TO ponto_app';
  END IF;
END $$;
