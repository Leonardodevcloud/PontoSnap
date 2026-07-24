-- Registros do AFD que não são marcação: tipos 2, 5 e 6 do leiaute (Anexo V).
--
--   tipo 2 — inclusão/alteração da identificação da empresa no REP
--   tipo 5 — inclusão, alteração ou exclusão de empregado no REP
--   tipo 6 — eventos sensíveis (no REP-P: "07" disponibilidade de serviço,
--            "08" indisponibilidade de serviço)
--
-- CRÍTICO: o NSR é uma sequência ÚNICA para todos os tipos de registro do AFD.
-- Por isso estes eventos consomem o mesmo contador das marcações (ponto_rep.
-- ultimo_nsr, alocado com FOR UPDATE). O ultimo_hash NÃO é tocado aqui: só o
-- registro tipo 7 tem campo de hash, e a cadeia liga marcação com marcação.
--
-- São registros fiscais: imutáveis, como as marcações.
CREATE TABLE IF NOT EXISTS ponto_evento_rep (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  rep_id uuid NOT NULL REFERENCES ponto_rep(id),
  nsr integer NOT NULL,
  tipo smallint NOT NULL,
  dt_gravacao timestamptz NOT NULL,
  fuso varchar(5) NOT NULL DEFAULT '-0300',
  -- registro tipo 2
  doc_responsavel varchar(14),
  tp_idt_empregador smallint,
  doc_empregador varchar(14),
  cno_caepf varchar(14),
  razao_social varchar(150),
  local_prestacao varchar(100),
  -- registro tipo 5
  operacao char(1),
  cpf_empregado varchar(12),
  nome_empregado varchar(52),
  dados_identificacao varchar(4),
  -- registro tipo 6
  tipo_evento smallint,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_rep_nsr ON ponto_evento_rep(rep_id, nsr);
CREATE INDEX IF NOT EXISTS ix_evento_rep_tenant ON ponto_evento_rep(tenant_id, nsr);

DROP TRIGGER IF EXISTS trg_ponto_evento_rep_imutavel ON ponto_evento_rep;
CREATE TRIGGER trg_ponto_evento_rep_imutavel
  BEFORE UPDATE OR DELETE ON ponto_evento_rep
  FOR EACH ROW EXECUTE FUNCTION ponto_bloquear_alteracao();

ALTER TABLE ponto_evento_rep ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_ponto_evento_rep ON ponto_evento_rep;
CREATE POLICY isolamento_tenant_ponto_evento_rep ON ponto_evento_rep
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
