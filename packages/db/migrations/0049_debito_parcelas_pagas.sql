-- Débito retroativo: parcelas já pagas antes de lançar no sistema.
-- A competência de início passa a ser a da PRÓXIMA parcela (parcelas_pagas + 1).
ALTER TABLE "pessoal_debito" ADD COLUMN IF NOT EXISTS "parcelas_pagas" integer NOT NULL DEFAULT 0;
