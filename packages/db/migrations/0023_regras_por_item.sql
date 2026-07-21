-- Regras por ITEM: cada aspecto do cálculo é um catálogo próprio, com várias
-- opções. No funcionário, monta-se escolhendo uma opção de cada item.
--   tipo: EXTRA | TOLERANCIA | NOTURNO | JORNADA | BANCO | DESTINACAO
--   config: jsonb com os parâmetros daquele tipo
--   padrao: a opção que vale pra quem não escolheu (uma por tipo/empresa)
--   convencao_id: qual convenção gerou (pra o atalho "aplicar peças da convenção")
CREATE TABLE IF NOT EXISTS ponto_regra_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  tipo varchar(16) NOT NULL,
  nome varchar(120) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  padrao boolean NOT NULL DEFAULT false,
  convencao_id uuid REFERENCES ponto_convencao(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_regra_item_tenant_tipo ON ponto_regra_item(tenant_id, tipo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_regra_item_padrao ON ponto_regra_item(tenant_id, tipo) WHERE padrao;

ALTER TABLE empregado ADD COLUMN IF NOT EXISTS regra_extra_id uuid REFERENCES ponto_regra_item(id);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS regra_tolerancia_id uuid REFERENCES ponto_regra_item(id);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS regra_noturno_id uuid REFERENCES ponto_regra_item(id);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS regra_jornada_id uuid REFERENCES ponto_regra_item(id);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS regra_banco_id uuid REFERENCES ponto_regra_item(id);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS regra_destinacao_id uuid REFERENCES ponto_regra_item(id);

ALTER TABLE ponto_regra_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_ponto_regra_item ON ponto_regra_item;
CREATE POLICY isolamento_tenant_ponto_regra_item ON ponto_regra_item
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
