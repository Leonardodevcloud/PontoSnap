-- O certificado deixou de ser por tenant: agora é o e-CPF do DESENVOLVEDOR,
-- único para a plataforma inteira, carregado de variável de ambiente
-- (PLATAFORMA_CERT_PFX_B64 / PLATAFORMA_CERT_SENHA). No REP-P quem assina os
-- arquivos é o programa (o desenvolvedor), não cada empresa usuária — então
-- guardar um .pfx por cliente estava errado, além de inseguro.
--
-- A tabela sai. O certificado nunca mais toca o banco.
DROP TABLE IF EXISTS certificado;
