#!/usr/bin/env node
/**
 * CLI da varredura — o que o cron chama.
 *
 *   node src/cli.js --check      1 busca: valida chave e datas
 *   node src/cli.js --dry-run    varre tudo, não grava (até 16 buscas)
 *   node src/cli.js              varre e grava
 *   node src/cli.js --rotas      rotas fixas de fim de semana (16 buscas por fds)
 */
import "dotenv/config";
import { carregarConfig } from "./config.js";
import { varrer } from "./index.js";
import { buscar, precoPorDestino, insights, saldo } from "./serpapi.js";
import { relatorioTexto } from "./relatorio.js";
import { varrerRotas, relatorioRotas, planejar, proximasSextas, ROTAS } from "./rotas.js";
import { hojeSP } from "./config.js";
import { Store } from "./store.js";

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = carregarConfig();

  const faltando = [
    ["apiKey", "SERPAPI_KEY"],
    ["ida", "VARREDURA_IDA"],
    ["volta", "VARREDURA_VOLTA"],
  ].filter(([campo]) => !cfg[campo]);

  if (faltando.length) {
    console.error(`Falta definir: ${faltando.map(([, n]) => n).join(", ")}. Veja .env.example.`);
    process.exit(1);
  }

  // --check gasta 1 busca em vez de 14. Serve para validar chave, datas e
  // rede antes de comprometer cota com a varredura inteira.
  if (args.has("--check")) {
    const regiao = Object.keys(cfg.regioes)[0];
    const destino = cfg.regioes[regiao][0];
    console.log(`Checando ${cfg.origem} -> ${destino}  (${cfg.ida} / ${cfg.volta})`);
    try {
      const json = await buscar(cfg, destino);
      const achados = precoPorDestino(json);
      const ins = insights(json);
      console.log(`  chave ............ ok`);
      console.log(`  itinerarios ...... ${achados.size ? "ok" : "NENHUM — confira as datas"}`);
      console.log(`  price_insights ... ${ins ? `ok (${ins.pontosHistorico} pontos)` : "ausente nesta rota"}`);
      const d = achados.get(destino);
      if (d) console.log(`  mais barato ...... ${d.preco} ${cfg.moeda} (${d.cia})`);
      console.log("\n1 busca usada. Config ok — pode rodar a varredura.");
    } catch (e) {
      console.error(`  FALHOU: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  if (args.has("--rotas")) {
    const previstas = planejar(ROTAS, proximasSextas(hojeSP(), cfg.rotas.finsDeSemana)).buscas.length;
    const s = await saldo(cfg);
    if (s.restantes < previstas + cfg.rotas.reserva) {
      console.log(`[rotas] pulando: ${s.restantes} buscas restantes (${s.plano}); precisa de ${previstas} + ${cfg.rotas.reserva} de reserva.`);
      return;
    }
    const r = await varrerRotas(cfg, { dryRun: args.has("--dry-run"), store: new Store(cfg.dataDir) });
    console.log(relatorioRotas(r));
    return;
  }

  if (cfg.gatilhoTodas === "auto") {
    const s = await saldo(cfg).catch(() => null);
    cfg.gatilhoTodas = (s?.porMes ?? 0) >= 1000;
    console.log(`[varredura] faixa normal: ${cfg.gatilhoTodas ? "todas as regiões" : "rodízio"} (${s ? s.plano : "saldo indisponível"})`);
  }
  const r = await varrer(cfg, { dryRun: args.has("--dry-run") });
  console.log(relatorioTexto(r));

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
