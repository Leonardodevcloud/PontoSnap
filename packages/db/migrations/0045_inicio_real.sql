-- Data real de início: quem já trabalhava antes de usar o sistema.
-- MEI/motorista: "presta serviço desde". CLT: admissão (base da carência da cesta).
ALTER TABLE "pessoal_prestador" ADD COLUMN IF NOT EXISTS "inicio_atividade" date;
--> statement-breakpoint
ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "data_admissao" date;
