-- Fase 1: o banco de horas passa a ser definido pela Regra (convenção) do
-- funcionário, não mais só pela empresa. Assim, na mesma empresa, um motorista
-- pode ter banco de 12 meses e um administrativo pode não ter banco.
--
-- banco_modo: HERDA (usa a config da empresa) | ATIVO (banco ligado por esta
-- regra) | INATIVO (banco desligado por esta regra). Default HERDA para não
-- mudar o comportamento de quem já existe.

ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS banco_modo varchar(8) NOT NULL DEFAULT 'HERDA';
ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS banco_tipo_acordo varchar(12);
ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS ativa boolean NOT NULL DEFAULT true;
ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS padrao boolean NOT NULL DEFAULT false;

-- No máximo uma regra padrão por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cct_padrao ON ponto_cct(tenant_id) WHERE padrao;
