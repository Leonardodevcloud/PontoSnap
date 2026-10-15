-- Migration 0058: foto e atualização cadastral do prestador
--
-- O prestador (portal) também manda a foto no primeiro acesso, como o CLT.
-- A foto fica na mesma tabela empregado_foto: empregado_id passa a ser a
-- "pessoa" (funcionário ou prestador) — por isso sai a FK para empregado.

ALTER TABLE empregado_foto DROP CONSTRAINT IF EXISTS empregado_foto_empregado_id_fkey;
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS cadastro_atualizado_em timestamptz;
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS contato_emergencia varchar(160);
