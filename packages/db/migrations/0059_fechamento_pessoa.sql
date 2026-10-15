-- Migration 0059: fechar UMA pessoa (prestador) sem fechar o mês inteiro
--
-- Ex.: desligamento no meio do mês. Congela a linha dessa pessoa (valores do
-- mês), libera a nota para ela e, no desligamento, tira ela dos meses
-- seguintes (exclusão "daqui em diante", guardada em exclusao_id para o
-- reabrir desfazer). Quando o mês inteiro fechar, ela entra com a linha
-- congelada aqui, sem recalcular.

CREATE TABLE IF NOT EXISTS pessoal_fechamento_pessoa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  competencia varchar(7) NOT NULL,
  pessoa_tipo varchar(10) NOT NULL,
  pessoa_id uuid NOT NULL,
  -- DESLIGAMENTO | ANTECIPADO
  motivo varchar(14) NOT NULL,
  ultimo_dia date,
  proporcional boolean NOT NULL DEFAULT false,
  -- parcelas de débito que iam cair depois (cobradas agora no desligamento)
  debitos_futuros numeric(12,2) NOT NULL DEFAULT 0,
  linha jsonb NOT NULL,
  exclusao_id uuid,
  cortar_acesso boolean NOT NULL DEFAULT false,
  fechado_em timestamptz NOT NULL DEFAULT now(),
  fechado_por varchar(160),
  CONSTRAINT uq_pessoal_fechamento_pessoa UNIQUE (tenant_id, competencia, pessoa_tipo, pessoa_id)
);

ALTER TABLE pessoal_fechamento_pessoa ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pessoal_fechamento_pessoa_tenant') THEN
    CREATE POLICY pessoal_fechamento_pessoa_tenant ON pessoal_fechamento_pessoa
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    GRANT ALL ON pessoal_fechamento_pessoa TO ponto_app;
  END IF;
END $$;
