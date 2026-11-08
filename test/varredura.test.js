import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { precoPorDestino, opcoesPorDestino, topOpcoes, insights, avaliar } from "../src/serpapi.js";
import { Store, calcularQuedas } from "../src/store.js";
import { varrer } from "../src/index.js";
import { dadosPainel } from "../src/painel.js";
import { RESPOSTA_MULTI, RESPOSTA_UNICA, RESPOSTA_BARATA } from "./fixtures/serpapi.js";

const tempDir = () => mkdtempSync(path.join(tmpdir(), "varredura-"));

function fakeFetch(porArrival) {
  return async (url) => {
    const arrival = new URL(url).searchParams.get("arrival_id");
    const corpo = porArrival[arrival] ?? porArrival.default;
    if (!corpo) throw new Error(`fixture faltando para arrival_id=${arrival}`);
    return { ok: true, status: 200, json: async () => corpo };
  };
}

const cfgBase = (dataDir) => ({
  apiKey: "test", origem: "GRU,CGH,VCP", ida: "2026-12-26", volta: "2027-01-03",
  moeda: "BRL", gatilhoTodas: true, nGatilhos: 1, dataDir,
  regioes: { "America do Sul": ["ASU", "SCL", "LIM"] },
});

test("destino é o aeroporto do último trecho, não o da conexão", () => {
  const mapa = precoPorDestino(RESPOSTA_MULTI);
  assert.deepEqual([...mapa.keys()].sort(), ["ASU", "LIM", "SCL"]);
  assert.equal(mapa.get("LIM").paradas, 1);
});

test("mantém só o mais barato quando o destino se repete", () => {
  // ASU aparece a 2382 (Gol) e 2500 (LATAM)
  assert.equal(precoPorDestino(RESPOSTA_MULTI).get("ASU").preco, 2382);
});

test("chamada multi-destino não traz price_insights; a única traz", () => {
  assert.equal(insights(RESPOSTA_MULTI), null);
  assert.equal(insights(RESPOSTA_UNICA).pontosHistorico, 61);
});

test("avaliar classifica contra a faixa normal", () => {
  assert.equal(avaliar(insights(RESPOSTA_UNICA)).estado, "normal");

  const barata = avaliar(insights(RESPOSTA_BARATA));
  assert.equal(barata.estado, "abaixo");
  assert.equal(barata.pct, 23); // (5200-4000)/5200

  const cara = avaliar({ preco: 3140, faixaMin: 1250, faixaMax: 2600 });
  assert.equal(cara.estado, "acima");
  assert.equal(cara.pct, 21); // (3140-2600)/2600
});

test("topOpcoes ordena por preço e expõe a companhia", () => {
  const ops = topOpcoes(RESPOSTA_UNICA, 3);
  assert.equal(ops.length, 3);
  assert.deepEqual(ops.map((o) => o.cia), ["Gol", "LATAM", "Paranair"]);
  assert.ok(ops[0].preco < ops[1].preco);
});

test("calcularQuedas ignora alta e ordena pela maior queda", () => {
  const quedas = calcularQuedas(
    [
      { destino: "ASU", preco: 2000 },
      { destino: "SCL", preco: 3000 },
      { destino: "LIM", preco: 1000 },
    ],
    { ASU: 2500, SCL: 2000, LIM: 2000 },
  );
  assert.deepEqual(quedas.map((q) => q.destino), ["LIM", "ASU"]); // SCL subiu
  assert.equal(quedas[0].delta, -50);
});

test("Store sobrevive a historico.json corrompido", () => {
  const dir = tempDir();
  const store = new Store(dir);
  writeFileSync(store.arqHist, "{ isso não é json", "utf8");
  assert.deepEqual(store.lerHistorico(), {});
});

test("varredura grava CSV com cabeçalho uma vez só e acumula linhas", async () => {
  const dir = tempDir();
  const cfg = cfgBase(dir);
  const fetchImpl = fakeFetch({ "ASU,SCL,LIM": RESPOSTA_MULTI, default: RESPOSTA_UNICA });

  await varrer(cfg, { fetchImpl, hoje: "2026-11-08" });
  await varrer(cfg, { fetchImpl, hoje: "2026-11-09" });

  const csv = readFileSync(path.join(dir, "precos.csv"), "utf8").trim().split("\n");
  assert.equal(csv[0], "data;destino;cidade;regiao;preco;paradas;cia;ida;volta");
  assert.equal(csv.filter((l) => l.startsWith("data;")).length, 1, "cabeçalho repetido");
  assert.equal(csv.length, 1 + 3 + 3, "3 destinos x 2 execuções");
  assert.ok(csv[1].includes("Assunção (ASU)"));
  assert.ok(existsSync(path.join(dir, "insights.csv")));
});

test("segunda execução enxerga a queda da primeira", async () => {
  const dir = tempDir();
  const cfg = cfgBase(dir);

  await varrer(cfg, {
    fetchImpl: fakeFetch({ "ASU,SCL,LIM": RESPOSTA_MULTI, default: RESPOSTA_UNICA }),
    hoje: "2026-11-08",
  });

  // mesma resposta, mas ASU 500 mais barato
  const maisBarato = structuredClone(RESPOSTA_MULTI);
  maisBarato.best_flights[0].price = 1882;
  const r = await varrer(cfg, {
    fetchImpl: fakeFetch({ "ASU,SCL,LIM": maisBarato, default: RESPOSTA_UNICA }),
    hoje: "2026-11-09",
  });

  const asu = r.quedas.find((q) => q.destino === "ASU");
  assert.ok(asu, "queda de ASU não detectada");
  assert.equal(asu.antes, 2382);
  assert.equal(asu.preco, 1882);
});

test("região que falha não derruba a varredura", async () => {
  const dir = tempDir();
  const cfg = { ...cfgBase(dir), regioes: { A: ["ASU"], B: ["SCL"] } };
  const fetchImpl = async (url) => {
    const arrival = new URL(url).searchParams.get("arrival_id");
    if (arrival === "SCL") return { ok: false, status: 400, json: async () => ({ error: "boom" }) };
    return { ok: true, status: 200, json: async () => RESPOSTA_UNICA };
  };

  const r = await varrer(cfg, { fetchImpl, hoje: "2026-11-08", dryRun: true });
  assert.equal(r.porRegiao.B.length, 0);
  assert.ok(r.porRegiao.A.length > 0, "a região boa deveria ter resultado");
});

test("dry-run não escreve nada no disco", async () => {
  const dir = tempDir();
  await varrer(cfgBase(dir), {
    fetchImpl: fakeFetch({ "ASU,SCL,LIM": RESPOSTA_MULTI, default: RESPOSTA_UNICA }),
    hoje: "2026-11-08",
    dryRun: true,
  });
  assert.equal(existsSync(path.join(dir, "precos.csv")), false);
});

test("opcoesPorDestino guarda todas as opções com duração, da mais barata à mais cara", () => {
  const ops = opcoesPorDestino(RESPOSTA_MULTI);
  assert.deepEqual(ops.ASU.map((o) => o.preco), [2382, 2500]);
  assert.equal(ops.ASU[0].duracao, 100);
  assert.equal(ops.ASU[1].cia, "LATAM");
});

test("insights preserva os pontos do price_history como datas", () => {
  const ins = insights(RESPOSTA_UNICA);
  assert.equal(ins.historico.length, 61);
  assert.deepEqual(Object.keys(ins.historico[0]), ["data", "preco"]);
  assert.match(ins.historico[0].data, /^\d{4}-\d{2}-\d{2}$/);
});

test("painel lê a última varredura, o histórico do Google e a série de insights", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch({ "ASU,SCL,LIM": RESPOSTA_MULTI, default: RESPOSTA_UNICA });
  await varrer(cfgBase(dir), { fetchImpl, hoje: "2026-11-08" });

  const d = dadosPainel(dir);
  assert.equal(d.ultima.data, "2026-11-08");
  assert.ok(d.ultima.opcoes.ASU.length >= 1);
  assert.equal(d.google.ASU.pontos.length, 61);
  assert.equal(d.insights.ASU[0].faixaMin, 1700);
  assert.equal(d.historico.ASU[0].duracao, 100);
});

test("histórico do Google mescla por data entre execuções", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch({ "ASU,SCL,LIM": RESPOSTA_MULTI, default: RESPOSTA_UNICA });
  await varrer(cfgBase(dir), { fetchImpl, hoje: "2026-11-08" });
  await varrer(cfgBase(dir), { fetchImpl, hoje: "2026-11-10" });
  const g = dadosPainel(dir).google.ASU;
  assert.equal(g.pontos.length, 61); // mesmas datas: não duplica
  assert.equal(g.atualizado, "2026-11-10");
});

test("painel sem varredura gravada devolve ultima null em vez de quebrar", () => {
  const d = dadosPainel(tempDir());
  assert.equal(d.ultima, null);
  assert.deepEqual(d.google, {});
});
