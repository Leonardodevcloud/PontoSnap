-- Transferência de empresa (migração entre CNPJs do grupo).
-- CLT: encerra o vínculo na origem (data_saida/motivo) e traça a cadeia
-- (empregado_anterior_id). Prestador: traça a cadeia; a saída da origem é
-- feita por pessoal_exclusao (a partir da competência), que já existe.
ALTER TABLE empregado
  ADD COLUMN IF NOT EXISTS data_saida date,
  ADD COLUMN IF NOT EXISTS motivo_saida varchar(20),
  ADD COLUMN IF NOT EXISTS empregado_anterior_id uuid;

ALTER TABLE pessoal_prestador
  ADD COLUMN IF NOT EXISTS prestador_anterior_id uuid;
