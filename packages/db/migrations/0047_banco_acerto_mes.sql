-- Banco "compensa no mês e paga a diferença": o que o fechamento acertou.
-- > 0 = horas pagas na folha · < 0 = horas descontadas · 0 = nada (ou devendo
-- que passou para o mês seguinte). NULL = fechamento antigo/acumulado (sem acerto).
ALTER TABLE "ponto_banco_fechamento" ADD COLUMN IF NOT EXISTS "acerto_min" integer;
