-- Vários usuários por empresa: a conta ganha nome (para a auditoria mostrar
-- QUEM fez) e o último acesso (para o Master/Admin ver quem está usando).
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS nome varchar(120);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS ultimo_acesso_em timestamptz;
