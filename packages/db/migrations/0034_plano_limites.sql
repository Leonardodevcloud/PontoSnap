-- Migration 0034: Limites de plano (max funcionários e max CNPJs)
-- Suporta os planos Essencial / Profissional / Empresa com tetos configuráveis.
-- NULL = sem limite (plano customizado ou negociado).

ALTER TABLE plano ADD COLUMN IF NOT EXISTS max_funcionarios integer;
ALTER TABLE plano ADD COLUMN IF NOT EXISTS max_cnpjs integer;

-- Seed dos 3 planos padrão (idempotente: só insere se não existir pelo nome)
INSERT INTO plano (nome, modo, valor, max_funcionarios, max_cnpjs, descricao)
SELECT 'Essencial', 'FIXO', 79.00, 10, 1, 'Até 10 funcionários, 1 CNPJ'
WHERE NOT EXISTS (SELECT 1 FROM plano WHERE nome = 'Essencial' AND ativo = 'sim');

INSERT INTO plano (nome, modo, valor, max_funcionarios, max_cnpjs, descricao)
SELECT 'Profissional', 'FIXO', 159.00, 30, 1, 'Até 30 funcionários, 1 CNPJ'
WHERE NOT EXISTS (SELECT 1 FROM plano WHERE nome = 'Profissional' AND ativo = 'sim');

INSERT INTO plano (nome, modo, valor, max_funcionarios, max_cnpjs, descricao)
SELECT 'Empresa', 'FIXO', 299.00, 60, 3, 'Até 60 funcionários, até 3 CNPJs'
WHERE NOT EXISTS (SELECT 1 FROM plano WHERE nome = 'Empresa' AND ativo = 'sim');
