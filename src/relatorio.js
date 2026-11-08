/**
 * Formatação do relatório. Duas saídas da mesma apuração:
 * texto largo para terminal/log.
 */
import { cidade } from "./config.js";

export const brl = (n) =>
  typeof n === "number"
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : "—";

const escalas = (n) => (n === 0 ? "direto" : `${n}x`);
const duracao = (min) => (min > 0 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : "");

export function relatorioTexto(r) {
  const L = [];
  const linha = (c = "-") => L.push(c.repeat(68));

  L.push("");
  L.push(`VARREDURA INTERNACIONAL - ${r.data}`);
  L.push(`${r.origem}  |  ida ${r.ida}  ->  volta ${r.volta}`);
  linha("=");

  for (const [nome, lista] of Object.entries(r.porRegiao)) {
    L.push("");
    L.push(`[${nome}]`);
    if (!lista.length) {
      L.push("   nenhum resultado");
      continue;
    }
    for (const d of lista) {
      L.push(
        "   " + cidade(d.destino).padEnd(26) + brl(d.preco).padStart(12) +
        "   " + escalas(d.paradas).padEnd(7) + d.cia,
      );
    }
  }

  L.push("");
  linha("=");
  L.push("OS MAIS BARATOS - todos os internacionais");
  linha("=");
  for (const d of r.ordenado.slice(0, 8)) {
    L.push("   " + cidade(d.destino).padEnd(26) + brl(d.preco).padStart(12) + "   " + d.regiao);
  }

  L.push("");
  L.push("OS MAIS BARATOS - fora da America do Sul");
  linha();
  for (const d of r.foraSul.slice(0, 8)) {
    L.push("   " + cidade(d.destino).padEnd(26) + brl(d.preco).padStart(12) + "   " + d.regiao);
  }

  if (r.quedas.length) {
    L.push("");
    L.push("CAIU DESDE A ULTIMA EXECUCAO");
    linha();
    for (const q of r.quedas.slice(0, 8)) {
      L.push(
        "   " + cidade(q.destino).padEnd(26) + brl(q.preco).padStart(12) +
        `   ${q.delta}%   (antes ${brl(q.antes)})`,
      );
    }
  }

  L.push("");
  linha("=");
  L.push("PRICE INSIGHTS");
  linha("=");
  for (const g of r.gatilhos) {
    L.push("");
    L.push(`   ${cidade(g.destino)}  -  ${g.regiao}`);
    if (g.erro) {
      L.push(`      ERRO: ${g.erro}`);
      continue;
    }
    if (!g.insights) {
      L.push("      price_insights indisponivel para esta rota");
    } else {
      L.push(`      agora .......... ${brl(g.insights.preco)}`);
      if (g.insights.faixaMin != null) {
        L.push(`      faixa normal ... ${brl(g.insights.faixaMin)}  a  ${brl(g.insights.faixaMax)}`);
        const v = g.avaliacao;
        if (v?.estado === "abaixo") L.push(`      >> ABAIXO DO NORMAL em ${v.pct}% - vale olhar`);
        else if (v?.estado === "acima") L.push(`      >> acima do normal em ${v.pct}% - esperar`);
        else L.push("      >> dentro da faixa normal");
      }
      L.push(`      veredito Google  ${g.insights.nivel ?? "—"}`);
      L.push(`      historico ...... ${g.insights.pontosHistorico} pontos`);
    }
    if (g.opcoes?.length) {
      L.push("      opcoes:");
      for (const o of g.opcoes) {
        L.push(
          "         " + brl(o.preco).padStart(11) + "  " + escalas(o.paradas).padEnd(7) +
          o.cia + (duracao(o.duracao) ? "  " + duracao(o.duracao) : ""),
        );
      }
    }
  }

  L.push("");
  linha("=");
  L.push(`Buscas usadas: ${r.buscasUsadas}`);
  L.push(`Dados em: ${r.dataDir}`);
  linha("=");
  L.push("");
  return L.join("\n");
}
