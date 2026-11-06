-- Cadastro do funcionário (cargo e chave Pix saem dos benefícios) e cesta
-- básica com "recebe sim/não" por pessoa.
--
-- 1) Cargo e chave Pix passam a ser do cadastro (empregado): valem para todos
--    os meses, sem vigência. Copia o último valor informado nos benefícios.
-- 2) pessoal_clt_cesta ganha "recebe": false = a pessoa não recebe cesta, mesmo
--    que o padrão da empresa pague. cesta_desde pode ficar vazio (= automático:
--    3 meses depois da admissão). Sem linha = recebe, automático (como antes).
--    O "a empresa paga cesta?" do padrão é cesta_mensal > 0 (sem coluna nova).

ALTER TABLE empregado
  ADD COLUMN IF NOT EXISTS cargo varchar(80),
  ADD COLUMN IF NOT EXISTS chave_pix varchar(120);

UPDATE empregado e SET cargo = c.cargo
FROM (
  SELECT DISTINCT ON (empregado_id) empregado_id, cargo
  FROM pessoal_clt_config
  WHERE cargo IS NOT NULL AND btrim(cargo) <> ''
  ORDER BY empregado_id, vigente_desde DESC
) c
WHERE c.empregado_id = e.id AND e.cargo IS NULL;

UPDATE empregado e SET chave_pix = c.chave_pix
FROM (
  SELECT DISTINCT ON (empregado_id) empregado_id, chave_pix
  FROM pessoal_clt_config
  WHERE chave_pix IS NOT NULL AND btrim(chave_pix) <> ''
  ORDER BY empregado_id, vigente_desde DESC
) c
WHERE c.empregado_id = e.id AND e.chave_pix IS NULL;

ALTER TABLE pessoal_clt_cesta
  ADD COLUMN IF NOT EXISTS recebe boolean NOT NULL DEFAULT true;
ALTER TABLE pessoal_clt_cesta
  ALTER COLUMN cesta_desde DROP NOT NULL;
