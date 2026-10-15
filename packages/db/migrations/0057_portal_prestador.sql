-- Migration 0057: Portal do prestador
--
-- Prestadores (MEI e motorista) ganham acesso restrito ao app:
--   * perfil PRESTADOR, usuario.prestador_id e usuario.documento (login por CPF/CNPJ);
--   * prestador_convite: link pessoal de primeiro acesso (vale 7 dias, uso único);
--   * pessoal_nota: o valor LIBERADO para o prestador emitir a nota (retrato do
--     fechamento, por mês no MEI e por semana no motorista), a situação da nota
--     (AGUARDANDO → ENVIADA → APROVADA, ou RECUSADA com motivo), a confirmação
--     ou contestação do valor e os lembretes;
--   * contato do prestador (celular/e-mail) e tomador da nota (opcional; vazio =
--     razão social e CNPJ da empresa);
--   * comunicação interna passa a ter prestadores como destinatários: a coluna
--     empregado_id de destinatário/voto vira "pessoa" (funcionário ou prestador).

ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'PRESTADOR';

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS prestador_id uuid REFERENCES pessoal_prestador(id);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS documento varchar(14);
CREATE INDEX IF NOT EXISTS idx_usuario_documento ON usuario (documento) WHERE documento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_prestador ON usuario (prestador_id) WHERE prestador_id IS NOT NULL;

ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS telefone varchar(20);
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS email varchar(180);
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS tomador_nome varchar(160);
ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS tomador_cnpj varchar(14);

CREATE TABLE IF NOT EXISTS prestador_convite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  prestador_id uuid NOT NULL REFERENCES pessoal_prestador(id),
  codigo varchar(16) NOT NULL UNIQUE,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prestador_convite ON prestador_convite (tenant_id, prestador_id);

CREATE TABLE IF NOT EXISTS pessoal_nota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  pessoa_tipo varchar(10) NOT NULL,
  pessoa_id uuid NOT NULL REFERENCES pessoal_prestador(id),
  competencia varchar(7) NOT NULL,
  periodo varchar(10) NOT NULL DEFAULT 'MES',
  valor_cent integer NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '[]'::jsonb,
  versao integer NOT NULL DEFAULT 1,
  liberado_em timestamptz NOT NULL DEFAULT now(),
  prazo date,
  pedir_confirmacao boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'AGUARDANDO',
  visto_em timestamptz,
  confirmacao varchar(10),
  confirmado_em timestamptz,
  contestacao text,
  resposta text,
  respondido_em timestamptz,
  enviada_em timestamptz,
  nf_valor_cent integer,
  conferencia jsonb,
  conferida_em timestamptz,
  conferida_por varchar(160),
  motivo_recusa text,
  lembrete_em timestamptz,
  lembretes integer NOT NULL DEFAULT 0,
  CONSTRAINT uq_pessoal_nota UNIQUE (tenant_id, pessoa_tipo, pessoa_id, competencia, periodo)
);
CREATE INDEX IF NOT EXISTS idx_pessoal_nota_pessoa ON pessoal_nota (tenant_id, pessoa_id);
CREATE INDEX IF NOT EXISTS idx_pessoal_nota_status ON pessoal_nota (tenant_id, status);

ALTER TABLE comunicado_destinatario DROP CONSTRAINT IF EXISTS comunicado_destinatario_empregado_id_fkey;
ALTER TABLE comunicado_voto DROP CONSTRAINT IF EXISTS comunicado_voto_empregado_id_fkey;

ALTER TABLE prestador_convite ENABLE ROW LEVEL SECURITY;
ALTER TABLE pessoal_nota ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prestador_convite', 'pessoal_nota'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = t || '_tenant') THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid OR current_setting(''app.is_master'', true) = ''on'') '
        'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid OR current_setting(''app.is_master'', true) = ''on'')',
        t || '_tenant', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
      EXECUTE format('GRANT ALL ON %I TO ponto_app', t);
    END IF;
  END LOOP;
END $$;
