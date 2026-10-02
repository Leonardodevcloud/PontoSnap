-- Migration 0037: contrato de horas (horário flexível) na escala
--
-- Com flexivel = true, a apuração usa só a carga horária do dia (dur_jornada_min
-- ou jornada_por_dia): quem entra mais tarde e sai mais tarde cumpriu a jornada,
-- sem atraso nem extra. Os pares (horários) ficam como referência.
ALTER TABLE ponto_horario_contratual ADD COLUMN IF NOT EXISTS flexivel boolean NOT NULL DEFAULT false;
