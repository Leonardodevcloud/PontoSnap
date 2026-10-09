-- Empresa do prestador (MEI/motorista) e registro do pagamento (valor e hora).
ALTER TABLE "pessoal_prestador" ADD COLUMN IF NOT EXISTS "empresa" varchar(120);
--> statement-breakpoint
ALTER TABLE "pessoal_lancamento" ADD COLUMN IF NOT EXISTS "valor_pago" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "pessoal_lancamento" ADD COLUMN IF NOT EXISTS "pago_em" timestamptz;
--> statement-breakpoint
-- Lançamentos já marcados como pagos antes desta versão: usa a última atualização como hora do pagamento.
UPDATE "pessoal_lancamento" SET "pago_em" = "atualizado_em" WHERE "pago" = true AND "pago_em" IS NULL;
