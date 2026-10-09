-- Motorista pago por semana: quanto dos débitos do mês foi descontado em cada semana.
ALTER TABLE "pessoal_lancamento" ADD COLUMN IF NOT EXISTS "debito_aplicado" numeric(12,2) NOT NULL DEFAULT 0;
