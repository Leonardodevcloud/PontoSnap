-- Forma de cálculo da compensação, por Regra:
--  BANCO_HORAS: extras/déficits acumulam no banco entre os meses (prazo 6/12).
--  INTRA_MES:   compensa dentro do mês; não carrega saldo pro mês seguinte.
ALTER TABLE ponto_cct ADD COLUMN IF NOT EXISTS forma_calculo varchar(12) NOT NULL DEFAULT 'BANCO_HORAS';
