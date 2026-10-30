-- Feriados nacionais de 2026 (portaria do governo federal) em todas as
-- empresas. Não duplica: pula a data que a empresa já tem como nacional.
-- Os próximos anos entram pelo botão "Adicionar feriados nacionais" da tela
-- de Feriados (e empresas novas já nascem com o ano corrente e o seguinte).
INSERT INTO ponto_feriado (tenant_id, data, nome, tipo)
SELECT t.id, v.data, v.nome, 'nacional'
FROM tenant t CROSS JOIN (VALUES
  ('2026-01-01'::date, 'Confraternização Universal'),
  ('2026-04-03'::date, 'Paixão de Cristo'),
  ('2026-04-21'::date, 'Tiradentes'),
  ('2026-05-01'::date, 'Dia do Trabalho'),
  ('2026-09-07'::date, 'Independência do Brasil'),
  ('2026-10-12'::date, 'Nossa Senhora Aparecida'),
  ('2026-11-02'::date, 'Finados'),
  ('2026-11-15'::date, 'Proclamação da República'),
  ('2026-11-20'::date, 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25'::date, 'Natal')
) AS v(data, nome)
WHERE NOT EXISTS (
  SELECT 1 FROM ponto_feriado f WHERE f.tenant_id = t.id AND f.data = v.data AND f.tipo = 'nacional'
);
