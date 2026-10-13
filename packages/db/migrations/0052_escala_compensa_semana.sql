-- Escala "compensa na semana": a carga vale pela semana (seg–dom), não por dia.
-- Dia sem batida não é falta se a semana fechar a carga.
ALTER TABLE "ponto_horario_contratual" ADD COLUMN IF NOT EXISTS "compensa_semana" boolean NOT NULL DEFAULT false;
