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
const COLUNAS_ROTAS = [
  "data", "rota", "sexta", "total", "ida_preco", "ida_partida", "ida_trecho", "ida_cia",
  "volta_preco", "volta_chegada", "volta_trecho", "volta_cia",
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

/**
 * Grava as linhas do dia substituindo as que já existem com a mesma data.
 * Rodar duas vezes no mesmo dia não duplica a série.
 */
function gravarDiaCsv(arquivo, colunas, data, linhas) {
  if (!linhas.length) return;
  if (existsSync(arquivo)) {
    const [cab, ...resto] = readFileSync(arquivo, "utf8").split("\n").filter(Boolean);
    const mantidas = resto.filter((l) => !l.startsWith(`${data};`));
    if (mantidas.length !== resto.length) {
      writeFileSync(arquivo, [cab, ...mantidas].join("\n") + "\n", "utf8");
    }
  }
  appendCsv(arquivo, colunas, linhas);
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
    this.arqRotas = path.join(this.dir, "rotas_ultima.json");
    this.arqRotasHist = path.join(this.dir, "rotas_historico.json");
    this.csvRotas = path.join(this.dir, "rotas.csv");
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

  /**
   * Rotas fixas: snapshot, série do total por viagem (rota + fim de semana)
   * e CSV. Na série, uma segunda execução no mesmo dia substitui a primeira.
   */
  gravarRotas(data, r) {
    writeFileSync(this.arqRotas, JSON.stringify(r), "utf8");
    const hist = this.lerJson(this.arqRotasHist, {});
    for (const v of r.viagens) {
      if (v.total == null) continue;
      const chave = `${v.rota}|${v.sexta}`;
      const serie = (hist[chave] || []).filter((p) => p.data !== data);
      serie.push({ data, total: v.total, ida: v.melhorIda.preco, volta: v.melhorVolta.preco });
      hist[chave] = serie;
    }
    writeFileSync(this.arqRotasHist, JSON.stringify(hist), "utf8");
    const p = (o, campo) => (o ? o[campo] : "");
    gravarDiaCsv(this.csvRotas, COLUNAS_ROTAS, data, r.viagens.map((v) => ({
      data, rota: v.rota, sexta: v.sexta, total: v.total ?? "",
      ida_preco: p(v.melhorIda, "preco"), ida_partida: p(v.melhorIda, "partida"),
      ida_trecho: v.melhorIda ? `${v.melhorIda.de}-${v.melhorIda.para}` : "", ida_cia: p(v.melhorIda, "cia"),
      volta_preco: p(v.melhorVolta, "preco"), volta_chegada: p(v.melhorVolta, "chegada"),
      volta_trecho: v.melhorVolta ? `${v.melhorVolta.de}-${v.melhorVolta.para}` : "", volta_cia: p(v.melhorVolta, "cia"),
    })));
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
      const serie = (Array.isArray(hist[d.destino]) ? hist[d.destino] : []).filter((p) => p.data !== data);
      serie.push({ data, preco: d.preco, duracao: d.duracao || 0 });
      hist[d.destino] = serie.slice(-maxPontos);
    }
    writeFileSync(this.arqHist, JSON.stringify(hist, null, 2), "utf8");

    gravarDiaCsv(
      this.csvPrecos,
      COLUNAS_PRECOS,
      data,
      destinos.map((d) => ({
        data, destino: d.destino, cidade: cidadeDe(d.destino), regiao: d.regiao,
        preco: d.preco, paradas: d.paradas, cia: d.cia, ida, volta,
      })),
    );
  }

  gravarInsights(data, linhas, { cidadeDe }) {
    gravarDiaCsv(
      this.csvInsights,
      COLUNAS_INSIGHTS,
      data,
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
