-- Feriados por região: nacional vale para todos; estadual só para quem trabalha
-- na UF; municipal só para quem trabalha no município (código IBGE). A pessoa
-- (funcionário ou prestador) tem cidade de trabalho opcional; sem ela, vale a
-- cidade da empresa. Feriado estadual/municipal antigo (sem UF/município)
-- continua valendo para todos até o RH definir a região.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS trabalho_uf char(2);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS trabalho_municipio integer;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS trabalho_municipio_nome varchar(80);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS trabalho_uf char(2);
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS trabalho_municipio integer;
ALTER TABLE empregado ADD COLUMN IF NOT EXISTS trabalho_municipio_nome varchar(80);
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS trabalho_uf char(2);
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS trabalho_municipio integer;
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS trabalho_municipio_nome varchar(80);
ALTER TABLE ponto_feriado ADD COLUMN IF NOT EXISTS uf char(2);
ALTER TABLE ponto_feriado ADD COLUMN IF NOT EXISTS municipio integer;
ALTER TABLE ponto_feriado ADD COLUMN IF NOT EXISTS municipio_nome varchar(80);
