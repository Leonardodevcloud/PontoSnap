-- decidido_por guarda o e-mail de quem decidiu (trilha de auditoria), não um CPF.
-- varchar(14) estourava com e-mails reais e derrubava a decisão do RH.
ALTER TABLE ponto_ajuste ALTER COLUMN decidido_por TYPE varchar(160);
