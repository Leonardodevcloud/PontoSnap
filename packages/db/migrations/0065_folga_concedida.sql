-- Folga concedida: o RH dá um dia de folga (ex.: convenção manda dar folga a
-- quem trabalhou no feriado). O dia não conta como falta e NÃO mexe no banco
-- de horas — diferente da folga compensatória do banco, que debita a jornada.
-- Fica em ponto_ausencia (tipo 4 = folga compensatória de feriado, como no AEJ),
-- marcada com a origem para não se confundir com a folga do banco.
ALTER TABLE ponto_ausencia ADD COLUMN IF NOT EXISTS origem varchar(16);
ALTER TABLE ponto_ausencia ADD COLUMN IF NOT EXISTS motivo varchar(200);
ALTER TABLE ponto_ausencia ADD COLUMN IF NOT EXISTS feriado_ref date;
ALTER TABLE ponto_ausencia ADD COLUMN IF NOT EXISTS criado_por uuid REFERENCES usuario(id);
