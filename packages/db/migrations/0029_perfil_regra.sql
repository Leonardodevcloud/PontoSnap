-- Perfil de regra: UM pacote com os 6 itens dentro (extra, tolerância,
-- noturno, jornada, banco, destinação). Substitui a montagem peça-por-peça:
-- o RH cria o perfil uma vez e, no funcionário, escolhe o perfil com 1 clique.
--
-- O motor de cálculo NÃO muda — ele continua recebendo os 6 configs. Só a
-- forma de montar e de escolher é que ficou simples.
--
-- A convenção (documento CCT/PDF do sindicato) passa a ser um anexo OPCIONAL
-- do perfil, em vez de um conceito separado.
CREATE TABLE IF NOT EXISTS ponto_perfil_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  nome varchar(120) NOT NULL,
  -- os 6 itens, cada um um bloco de config; nulo = usa CLT naquele item
  config jsonb NOT NULL DEFAULT '{}',
  padrao boolean NOT NULL DEFAULT false,
  -- convenção coletiva (opcional): metadados + PDF do sindicato
  cct_sindicato varchar(140),
  cct_vigencia varchar(60),
  cct_registro_mte varchar(60),
  cct_pdf_nome varchar(200),
  cct_pdf_base64 text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_perfil_regra_tenant ON ponto_perfil_regra(tenant_id);
-- no máximo um perfil padrão por empresa
CREATE UNIQUE INDEX IF NOT EXISTS uq_perfil_regra_padrao
  ON ponto_perfil_regra(tenant_id) WHERE padrao;

ALTER TABLE ponto_perfil_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_ponto_perfil_regra ON ponto_perfil_regra;
CREATE POLICY isolamento_tenant_ponto_perfil_regra ON ponto_perfil_regra
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');

-- o funcionário aponta para um perfil (troca os 6 ids soltos por 1)
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS perfil_regra_id uuid REFERENCES ponto_perfil_regra(id);

-- Sem dados reais ainda: as 6 colunas soltas de regra e o vínculo de convenção
-- antigo saem, substituídos pelo perfil_regra_id acima.
ALTER TABLE empregado DROP COLUMN IF EXISTS regra_extra_id;
ALTER TABLE empregado DROP COLUMN IF EXISTS regra_tolerancia_id;
ALTER TABLE empregado DROP COLUMN IF EXISTS regra_noturno_id;
ALTER TABLE empregado DROP COLUMN IF EXISTS regra_jornada_id;
ALTER TABLE empregado DROP COLUMN IF EXISTS regra_banco_id;
ALTER TABLE empregado DROP COLUMN IF EXISTS regra_destinacao_id;
ALTER TABLE empregado DROP COLUMN IF EXISTS convencao_id;
