-- Migration 0036: fechamento automático do banco de horas
--
-- ponto_banco_fechamento marca que a competência (YYYY-MM) de um funcionário
-- já foi levada ao banco (ponto_banco_mov). Um mês pode fechar com zero
-- movimentos; sem esta marca não daria pra distinguir "não fechou" de
-- "fechou zerado". Com ela, o sistema fecha sozinho todo mês encerrado que
-- ainda não tem linha aqui — acabou a necessidade de o RH "lançar competência".

CREATE TABLE IF NOT EXISTS ponto_banco_fechamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  competencia varchar(7) NOT NULL,
  total_min integer NOT NULL DEFAULT 0,
  lancamentos integer NOT NULL DEFAULT 0,
  origem varchar(8) NOT NULL DEFAULT 'AUTO',
  fechado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_banco_fechamento UNIQUE (tenant_id, empregado_id, competencia)
);
CREATE INDEX IF NOT EXISTS idx_banco_fechamento_empregado ON ponto_banco_fechamento (tenant_id, empregado_id);

-- Competências que o RH já tinha lançado manualmente viram fechamento, pra não
-- serem refeitas (e sobrescritas) pela sincronização automática.
INSERT INTO ponto_banco_fechamento (tenant_id, empregado_id, competencia, total_min, lancamentos, origem, fechado_em)
SELECT tenant_id, empregado_id, competencia, COALESCE(SUM(minutos), 0), COUNT(*), 'MANUAL', MAX(criado_em)
  FROM ponto_banco_mov
 WHERE competencia IS NOT NULL
 GROUP BY tenant_id, empregado_id, competencia
ON CONFLICT (tenant_id, empregado_id, competencia) DO NOTHING;

-- RLS: mesmo padrão das demais tabelas (app.current_tenant / app.is_master).
ALTER TABLE ponto_banco_fechamento ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ponto_banco_fechamento_tenant') THEN
    CREATE POLICY ponto_banco_fechamento_tenant ON ponto_banco_fechamento
      USING (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.is_master', true) = 'on'
      )
      WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.is_master', true) = 'on'
      );
  END IF;
END $$;

-- Permissões pro role da API (ponto_app, sem superuser, sem bypassrls)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON ponto_banco_fechamento TO ponto_app';
  END IF;
END $$;
