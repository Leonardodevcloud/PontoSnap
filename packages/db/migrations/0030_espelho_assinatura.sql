-- Assinatura eletrônica do espelho de ponto pelo funcionário.
--
-- O funcionário abre o espelho da competência, confere e concorda. A prova da
-- concordância é: quem (empregado), o quê (o HASH do PDF que ele viu — não o
-- PDF, que é regerável), quando, e como foi autenticado (PIN + auditoria).
--
-- Guardar o hash do documento é o que dá peso: prova que ele concordou com
-- AQUELE espelho exato, não com outro. Se o espelho for regerado idêntico, o
-- hash bate; se algo mudou (uma batida, um ajuste), o hash muda e a assinatura
-- antiga deixa de casar — sinal de que precisa reassinar.
--
-- A jornada em si continua provada pelo AFD (imutável). Este registro é a
-- camada de concordância do trabalhador.
CREATE TABLE IF NOT EXISTS espelho_assinatura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  competencia varchar(7) NOT NULL,          -- YYYY-MM
  hash_documento varchar(64) NOT NULL,      -- SHA-256 do PDF conferido
  assinado_em timestamptz NOT NULL DEFAULT now(),
  via varchar(60) NOT NULL DEFAULT 'PIN no app',
  ip varchar(45),
  auditoria_ref varchar(20),                -- referência curta p/ o carimbo
  criado_em timestamptz NOT NULL DEFAULT now()
);
-- uma assinatura vigente por empregado/competência; reassinar substitui
CREATE UNIQUE INDEX IF NOT EXISTS uq_espelho_assinatura
  ON espelho_assinatura(empregado_id, competencia);
CREATE INDEX IF NOT EXISTS ix_espelho_assinatura_tenant ON espelho_assinatura(tenant_id, competencia);

ALTER TABLE espelho_assinatura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_espelho_assinatura ON espelho_assinatura;
CREATE POLICY isolamento_tenant_espelho_assinatura ON espelho_assinatura
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
