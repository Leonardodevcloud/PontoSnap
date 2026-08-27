-- Vigência de escala por funcionário.
--
-- Antes: o empregado tinha UM horarioContratualId fixo, aplicado a todos os
-- dias — mudar a escala reescrevia o passado. Agora cada funcionário tem um
-- histórico: "de tal data até tal data, valia a escala X". A apuração, para
-- cada dia, usa a escala que estava vigente NAQUELE dia.
--
-- Isso separa dois casos que antes se confundiam:
--   • Correção de cadastro errado  → edita a vigência (ou a própria escala).
--   • Mudança real de escala        → encerra a vigente numa data e abre outra
--                                     a partir do dia seguinte; o passado fica
--                                     intacto.
--
-- O empregado.horario_contratual_id continua existindo como "escala atual"
-- (leitura rápida / compatibilidade), mas a fonte da verdade para apuração
-- passa a ser esta tabela.
CREATE TABLE IF NOT EXISTS empregado_escala_vigencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  horario_contratual_id uuid NOT NULL REFERENCES ponto_horario_contratual(id),
  data_inicio date NOT NULL,           -- primeiro dia em que esta escala vale
  data_fim date,                       -- último dia (null = vigente/aberta)
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_escala_vig_emp ON empregado_escala_vigencia(empregado_id, data_inicio);
CREATE INDEX IF NOT EXISTS ix_escala_vig_tenant ON empregado_escala_vigencia(tenant_id);

ALTER TABLE empregado_escala_vigencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_escala_vig ON empregado_escala_vigencia;
CREATE POLICY isolamento_tenant_escala_vig ON empregado_escala_vigencia
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');

-- Semear vigência aberta para quem já tem escala vinculada (não perde histórico
-- atual). data_inicio bem no passado para cobrir qualquer apuração existente.
INSERT INTO empregado_escala_vigencia (tenant_id, empregado_id, horario_contratual_id, data_inicio)
SELECT tenant_id, id, horario_contratual_id, DATE '2000-01-01'
FROM empregado
WHERE horario_contratual_id IS NOT NULL;
