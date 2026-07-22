-- Solicitação de ajuste de ponto.
--   INCLUSAO      = batida que faltou (o funcionário informa a hora)
--   DESCONSIDERAR = batida a mais/duplicada (aponta a marcação original)
--
-- A marcação ORIGINAL nunca é apagada nem alterada (Portaria 671 — AFD é
-- imutável, hash encadeado). O ajuste vive na camada de tratamento: vira
-- marcação de fonte 'I' (incluída) ou tratada como 'D' (desconsiderada) no AEJ.
CREATE TABLE IF NOT EXISTS ponto_ajuste (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  tipo varchar(14) NOT NULL,
  data date NOT NULL,
  dt_marcacao timestamptz,
  tp_marc char(1),
  marcacao_id uuid REFERENCES ponto_marcacao(id),
  observacao varchar(400) NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'EM_ANALISE',
  origem varchar(12) NOT NULL DEFAULT 'FUNCIONARIO',
  motivo_decisao varchar(200),
  decidido_por varchar(14),
  decidido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ajuste_tenant_status ON ponto_ajuste(tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_ajuste_empregado_data ON ponto_ajuste(tenant_id, empregado_id, data);

ALTER TABLE ponto_ajuste ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_ponto_ajuste ON ponto_ajuste;
CREATE POLICY isolamento_tenant_ponto_ajuste ON ponto_ajuste
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
