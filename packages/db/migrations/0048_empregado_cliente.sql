-- Gestão de pessoal: cliente (loja/empresa atendida) a que o funcionário CLT pertence.
ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "cliente" varchar(120);
