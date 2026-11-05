-- Holerite: guardar o bruto (Total de Proventos, lido do PDF) e o pagamento
-- do líquido via Pix. O líquido já existia (liquido_centavos).
ALTER TABLE ponto_holerite
  ADD COLUMN IF NOT EXISTS bruto_centavos integer,
  ADD COLUMN IF NOT EXISTS pago_em timestamptz,
  ADD COLUMN IF NOT EXISTS pago_por uuid REFERENCES usuario(id),
  ADD COLUMN IF NOT EXISTS valor_pago_centavos integer;
