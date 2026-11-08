/**
 * Varredura internacional de passagens — lógica pura, sem efeito colateral.
 * A CLI mora em cli.js.
 *
 * Duas camadas, por causa de um limite da API (ver docs/varredura.md):
 *   1. Descoberta — 1 chamada por região, até 8 destinos. Dá preço,
 *      não dá price_insights.
 *   2. Gatilho    — 1 chamada por destino. Dá price_insights e a
 *      comparação entre companhias.
 *
 */
import { cidade } from "./config.js";
import { buscar, precoPorDestino, opcoesPorDestino, topOpcoes, insights, avaliar } from "./serpapi.js";
import { Store, calcularQuedas } from "./store.js";

const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Roda a varredura completa.
 * @param {object} cfg
 * @param {object} [opts] { fetchImpl, hoje, diaDoAno }
 */
export async function varrer(cfg, opts = {}) {
  const data = opts.hoje || hojeISO();
  const nomesRegiao = Object.keys(cfg.regioes);
  const porRegiao = {};
  const todos = [];
  const opcoes = {};
  let buscasUsadas = 0;

  // ---- camada 1: descoberta
  for (const nome of nomesRegiao) {
    try {
      const json = await buscar(cfg, cfg.regioes[nome].join(","), opts);
      buscasUsadas++;
      for (const [dest, lista] of Object.entries(opcoesPorDestino(json))) {
        opcoes[dest] = [...(opcoes[dest] || []), ...lista].sort((a, b) => a.preco - b.preco);
      }
      const lista = [...precoPorDestino(json).values()]
        .map((d) => ({ ...d, regiao: nome }))
        .sort((a, b) => a.preco - b.preco);
      porRegiao[nome] = lista;
      todos.push(...lista);
    } catch (e) {
      buscasUsadas++;
      porRegiao[nome] = [];
      console.error(`[varredura] região "${nome}" falhou: ${e.message}`);
    }
  }

  const ordenado = [...todos].sort((a, b) => a.preco - b.preco);
  const foraSul = ordenado.filter((d) => d.regiao !== "America do Sul");

  // ---- quedas: compara antes de gravar o snapshot de hoje
  const store = new Store(cfg.dataDir);
  const anteriores = store.ultimosPrecos();
  const quedas = calcularQuedas(ordenado, anteriores);

  // ---- alvos do gatilho: 1 por região.
  // Pegar "os N mais baratos no geral" faria a América do Sul monopolizar
  // e uma queda na Europa nunca seria vista.
  const alvos = [];
  const inicio = cfg.gatilhoTodas
    ? 0
    : (opts.diaDoAno ?? diaDoAno(new Date())) % nomesRegiao.length;
  const limite = cfg.gatilhoTodas ? nomesRegiao.length : cfg.nGatilhos;

  for (let i = 0; i < nomesRegiao.length && alvos.length < limite; i++) {
    const lista = porRegiao[nomesRegiao[(inicio + i) % nomesRegiao.length]];
    if (lista?.length) alvos.push(lista[0]);
  }

  // ---- camada 2: gatilho
  const gatilhos = [];
  for (const alvo of alvos) {
    try {
      const json = await buscar(cfg, alvo.destino, opts);
      buscasUsadas++;
      const ins = insights(json);
      opcoes[alvo.destino] = opcoesPorDestino(json)[alvo.destino] || opcoes[alvo.destino] || [];
      gatilhos.push({
        destino: alvo.destino,
        regiao: alvo.regiao,
        insights: ins,
        avaliacao: avaliar(ins),
        opcoes: topOpcoes(json, 3),
      });
    } catch (e) {
      buscasUsadas++;
      gatilhos.push({ destino: alvo.destino, regiao: alvo.regiao, erro: e.message });
    }
  }

  const resultado = {
    data, origem: cfg.origem, ida: cfg.ida, volta: cfg.volta,
    porRegiao, ordenado, foraSul, quedas, gatilhos, opcoes, buscasUsadas,
    dataDir: cfg.dataDir,
  };

  if (!opts.dryRun) {
    store.gravarPrecos(data, ordenado, {
      ida: cfg.ida, volta: cfg.volta, cidadeDe: (c) => cidade(c),
    });
    store.gravarInsights(
      data,
      gatilhos.filter((g) => g.insights),
      { cidadeDe: (c) => cidade(c) },
    );
    store.gravarHistoricoGoogle(data, gatilhos);
    store.gravarUltima(resultado);
  }
  return resultado;
}

export function diaDoAno(d) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86_400_000);
}
