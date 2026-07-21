-- Destinação de faltas e atrasos, por Regra (convenção) do funcionário.
--
-- destinacao_faltas:  DESCONTA (sinaliza desconto na folha) | BANCO (abate do
--                     banco) | ABONA (não desconta)
-- destinacao_atrasos: DESCONTA | BANCO | TOLERA
--
-- Se o banco da regra estiver desligado, "BANCO" cai pra DESCONTA em runtime.
-- O sistema calcula e sinaliza; o desconto real é aplicado pela folha.

ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS destinacao_faltas varchar(10) NOT NULL DEFAULT 'DESCONTA';
ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS destinacao_atrasos varchar(10) NOT NULL DEFAULT 'BANCO';
