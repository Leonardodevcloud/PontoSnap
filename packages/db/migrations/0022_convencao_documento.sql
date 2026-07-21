-- Convenção = o DOCUMENTO da CCT/ACT (separado da Regra, que é o cálculo).
-- Guarda sindicato, abrangência, vigência e o PDF. A IA lê o PDF e sugere Regra.
CREATE TABLE IF NOT EXISTS ponto_convencao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  nome varchar(140) NOT NULL,
  sindicato varchar(140),
  uf varchar(2),
  vigencia varchar(60),
  numero_registro_mte varchar(60),
  categoria varchar(140),
  observacoes text,
  pdf_nome varchar(200),
  pdf_base64 text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_convencao_tenant ON ponto_convencao(tenant_id);

ALTER TABLE empregado ADD COLUMN IF NOT EXISTS convencao_id uuid REFERENCES ponto_convencao(id);

ALTER TABLE ponto_convencao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_ponto_convencao ON ponto_convencao;
CREATE POLICY isolamento_tenant_ponto_convencao ON ponto_convencao
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
