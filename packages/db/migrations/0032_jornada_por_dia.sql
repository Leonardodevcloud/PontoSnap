-- Jornada por dia da semana na escala.
--
-- Antes: a escala tinha UMA jornada (dur_jornada_min) aplicada a todos os dias
-- úteis. Casos reais precisam variar — ex.: seg-sex 9h e sábado 4h.
--
-- Agora a escala pode ter jornada_por_dia: um mapa {dia_da_semana: minutos}
-- onde 0=domingo ... 6=sábado. Quando presente e com valor para o dia, a
-- apuração usa esse valor; senão cai em dur_jornada_min (comportamento antigo).
-- Escalas existentes ficam com jornada_por_dia nula → nada muda para elas.
ALTER TABLE ponto_horario_contratual
  ADD COLUMN IF NOT EXISTS jornada_por_dia jsonb;
