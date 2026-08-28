-- Data de início de uso do ponto por funcionário.
--
-- Antes desta data, a apuração ignora o funcionário por completo: não gera
-- falta, não cobra jornada, não conta nada. Serve para dois casos:
--   • Migração: a empresa começa a usar o PontoSnap numa data — o período
--     anterior ficava em outro sistema e não deve virar falta aqui.
--   • Contratação nova: admitido no meio do mês só passa a ser apurado a
--     partir do dia em que entrou.
--
-- Nulo = sem corte (apura desde sempre, comportamento atual). Assim os
-- funcionários existentes não mudam até que se informe uma data.
ALTER TABLE empregado
  ADD COLUMN IF NOT EXISTS data_inicio_ponto date;
