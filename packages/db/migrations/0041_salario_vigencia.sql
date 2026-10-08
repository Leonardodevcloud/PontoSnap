-- Migration 0041: salário com vigência
--
-- Promoção/reajuste vale "a partir de" uma data. Cada dia da apuração usa o
-- salário vigente naquele dia; o mês da mudança sai proporcional. O campo
-- empregado.salario_mensal continua existindo como "salário atual" (o mais
-- recente), para telas e relatórios que só precisam dele.

CREATE TABLE IF NOT EXISTS empregado_salario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  vigente_desde date NOT NULL,
  salario_mensal numeric(12,2) NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_empregado_salario UNIQUE (tenant_id, empregado_id, vigente_desde)
);
CREATE INDEX IF NOT EXISTS idx_empregado_salario_emp ON empregado_salario (tenant_id, empregado_id);

-- O salário de hoje vale "desde sempre": nada que já foi apurado muda.
INSERT INTO empregado_salario (tenant_id, empregado_id, vigente_desde, salario_mensal)
SELECT tenant_id, id, DATE '2000-01-01', salario_mensal FROM empregado WHERE salario_mensal IS NOT NULL
ON CONFLICT (tenant_id, empregado_id, vigente_desde) DO NOTHING;

ALTER TABLE empregado_salario ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'empregado_salario_tenant') THEN
    CREATE POLICY empregado_salario_tenant ON empregado_salario
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON empregado_salario TO ponto_app';
  END IF;
END $$;
