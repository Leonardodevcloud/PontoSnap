-- Débito fixo mensal (sem número de parcelas): desconta o mesmo valor todo mês
-- até ser encerrado. valor_total guarda o valor do mês; competencia_fim é o
-- último mês com desconto (NULL = sem fim).
ALTER TABLE "pessoal_debito" ADD COLUMN IF NOT EXISTS "tipo" varchar(10) NOT NULL DEFAULT 'PARCELADO';
ALTER TABLE "pessoal_debito" ADD COLUMN IF NOT EXISTS "competencia_fim" varchar(7);
