/**
 * Persistência da série histórica.
 *
 * Fica fora do código, em VARREDURA_DATA_DIR, para sobreviver a deploy,
 * troca de versão e rebuild de container. Mesmo formato do script
 * PowerShell, então o CSV do Windows pode ser concatenado direto.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const COLUNAS_PRECOS = [
  "data", "destino", "cidade", "regiao", "preco", "paradas", "cia", "ida", "volta",
];
const COLUNAS_INSIGHTS = [
  "data", "destino", "cidade", "regiao", "preco", "faixa_min", "faixa_max", "nivel",
];

/** Excel em pt-BR espera ponto-e-vírgula; campo com ; ou aspas vai escapado. */
function campoCsv(v) {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function appendCsv(arquivo, colunas, linhas) {
  if (!linhas.length) return;
  const novo = !existsSync(arquivo);
  const corpo = linhas.map((l) => colunas.map((c) => campoCsv(l[c])).join(";")).join("\n");
  appendFileSync(arquivo, (novo ? colunas.join(";") + "\n" : "") + corpo + "\n", "utf8");
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    mkdirSync(this.dir, { recursive: true });
    this.arqHist = path.join(this.dir, "historico.json");
    this.csvPrecos = path.join(this.dir, "precos.csv");
    this.csvInsights = path.join(this.dir, "insights.csv");
    this.arqGoogle = path.join(this.dir, "google.json");
    this.arqUltima = path.join(this.dir, "ultima.json");
  }

  lerJson(arquivo, padrao) {
    if (!existsSync(arquivo)) return padrao;
    try {
      return JSON.parse(readFileSync(arquivo, "utf8")) ?? padrao;
    } catch {
      return padrao;
    }
  }

  /**
   * price_history do Google por destino. Cada execução traz ~60 dias;
   * mescla por data para a série crescer além da janela do Google.
   */
  gravarHistoricoGoogle(data, gatilhos) {
    const atual = this.lerJson(this.arqGoogle, {});
    for (const g of gatilhos) {
      const pontos = g.insights?.historico;
      if (!pontos?.length) continue;
      const porData = new Map((atual[g.destino]?.pontos || []).map((p) => [p.data, p.preco]));
      for (const p of pontos) porData.set(p.data, p.preco);
      atual[g.destino] = {
        atualizado: data,
        pontos: [...porData].sort(([a], [b]) => a.localeCompare(b)).map(([d, preco]) => ({ data: d, preco })),
      };
    }
    writeFileSync(this.arqGoogle, JSON.stringify(atual), "utf8");
  }

  /** Snapshot completo da última execução — é o que o painel mostra. */
  gravarUltima(resultado) {
    writeFileSync(this.arqUltima, JSON.stringify(resultado), "utf8");
  }

  /** { [destino]: [{ data, preco }, ...] } — vazio se o arquivo não existe ou está corrompido. */
  lerHistorico() {
    if (!existsSync(this.arqHist)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.arqHist, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Arquivo corrompido não pode derrubar a varredura do dia.
      return {};
    }
  }

  /** Último preço registrado de cada destino, para calcular a variação. */
  ultimosPrecos() {
    const hist = this.lerHistorico();
    const out = {};
    for (const [destino, serie] of Object.entries(hist)) {
      const arr = Array.isArray(serie) ? serie : [];
      if (arr.length) out[destino] = arr.at(-1).preco;
    }
    return out;
  }

  /** Grava o snapshot do dia: JSON para cálculo, CSV para o usuário ler. */
  gravarPrecos(data, destinos, { ida, volta, cidadeDe, maxPontos = 400 }) {
    const hist = this.lerHistorico();
    for (const d of destinos) {
      const serie = Array.isArray(hist[d.destino]) ? hist[d.destino] : [];
      serie.push({ data, preco: d.preco, duracao: d.duracao || 0 });
      hist[d.destino] = serie.slice(-maxPontos);
    }
    writeFileSync(this.arqHist, JSON.stringify(hist, null, 2), "utf8");

    appendCsv(
      this.csvPrecos,
      COLUNAS_PRECOS,
      destinos.map((d) => ({
        data, destino: d.destino, cidade: cidadeDe(d.destino), regiao: d.regiao,
        preco: d.preco, paradas: d.paradas, cia: d.cia, ida, volta,
      })),
    );
  }

  gravarInsights(data, linhas, { cidadeDe }) {
    appendCsv(
      this.csvInsights,
      COLUNAS_INSIGHTS,
      linhas.map((l) => ({
        data, destino: l.destino, cidade: cidadeDe(l.destino), regiao: l.regiao,
        preco: l.insights.preco, faixa_min: l.insights.faixaMin,
        faixa_max: l.insights.faixaMax, nivel: l.insights.nivel,
      })),
    );
  }
}

/** Quedas desde a execução anterior, da maior para a menor. */
export function calcularQuedas(destinos, anteriores) {
  const quedas = [];
  for (const d of destinos) {
    const antes = anteriores[d.destino];
    if (!antes || antes <= 0 || d.preco >= antes) continue;
    quedas.push({ ...d, antes, delta: Number((((d.preco - antes) / antes) * 100).toFixed(1)) });
  }
  return quedas.sort((a, b) => a.delta - b.delta);
}
