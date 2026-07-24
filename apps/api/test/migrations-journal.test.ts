import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Trava do journal de migrations.
 *
 * O drizzle aplica uma migration só quando o `when` dela é ESTRITAMENTE MAIOR
 * que o da última já aplicada (`created_at < folderMillis`). Duas entradas com
 * o mesmo timestamp fazem a segunda ser pulada em silêncio: o deploy passa
 * verde, o código novo sobe, e a tabela simplesmente não existe em produção.
 *
 * O outro jeito de perder uma migration é criar o .sql e esquecer de registrar
 * no journal — aí ela nunca roda (só os testes, que leem a pasta inteira).
 *
 * Este teste fecha os dois buracos antes do deploy.
 */
const DIR = resolve(__dirname, '../../../packages/db/migrations');
const journal = JSON.parse(readFileSync(resolve(DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};

describe('journal de migrations', () => {
  it('os timestamps são estritamente crescentes', () => {
    const fora: string[] = [];
    journal.entries.forEach((e, i) => {
      const ant = journal.entries[i - 1];
      if (ant && e.when <= ant.when) fora.push(`${e.tag} (when ${e.when} <= ${ant.tag} ${ant.when})`);
    });
    expect(fora, 'migration com timestamp repetido/menor seria PULADA em produção').toEqual([]);
  });

  it('não há idx repetido', () => {
    const idxs = journal.entries.map((e) => e.idx);
    expect(idxs.length).toBe(new Set(idxs).size);
  });

  it('todo .sql da pasta está registrado no journal', () => {
    const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, ''));
    const registrados = new Set(journal.entries.map((e) => e.tag));
    const orfaos = arquivos.filter((a) => !registrados.has(a));
    expect(orfaos, 'migration fora do journal nunca roda em produção').toEqual([]);
  });

  it('toda entrada do journal tem o .sql correspondente', () => {
    const arquivos = new Set(readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')));
    const semArquivo = journal.entries.filter((e) => !arquivos.has(e.tag)).map((e) => e.tag);
    expect(semArquivo).toEqual([]);
  });
});
