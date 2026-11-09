/**
 * Painel web da varredura: GET /varredura (página) e GET /varredura/dados.json.
 *
 * Só leitura dos arquivos em VARREDURA_DATA_DIR — não chama a SerpApi.
 * Montado pelo bot em src/index.js; isolado num Router para dar pra testar
 * sem subir o cliente do WhatsApp.
 */
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CIDADES } from "./config.js";
import { Store } from "./store.js";

const HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "painel.html");

/** insights.csv → { [destino]: [{ data, preco, faixaMin, faixaMax, nivel }] } */
export function lerInsightsCsv(arquivo) {
  if (!existsSync(arquivo)) return {};
  const [cab, ...linhas] = readFileSync(arquivo, "utf8").trim().split("\n");
  const col = cab.split(";");
  const out = {};
  for (const linha of linhas) {
    const v = Object.fromEntries(linha.split(";").map((x, i) => [col[i], x]));
    (out[v.destino] ||= []).push({
      data: v.data,
      preco: Number(v.preco),
      faixaMin: v.faixa_min ? Number(v.faixa_min) : null,
      faixaMax: v.faixa_max ? Number(v.faixa_max) : null,
      nivel: v.nivel || null,
    });
  }
  return out;
}

export function dadosPainel(dataDir) {
  const store = new Store(dataDir);
  return {
    ultima: store.lerJson(store.arqUltima, null),
    google: store.lerJson(store.arqGoogle, {}),
    historico: store.lerHistorico(),
    insights: lerInsightsCsv(store.csvInsights),
    rotas: store.lerJson(store.arqRotas, null),
    rotasHistorico: store.lerJson(store.arqRotasHist, {}),
    cidades: CIDADES,
  };
}

export function painelVarredura(dataDir) {
  const router = express.Router();
  router.get("/varredura", (req, res) => res.sendFile(HTML));
  router.get("/varredura/dados.json", (req, res) => {
    try {
      res.json(dadosPainel(dataDir));
    } catch (err) {
      res.status(500).json({ error: "dados_ilegiveis", message: err.message });
    }
  });
  return router;
}
