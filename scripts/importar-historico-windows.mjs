#!/usr/bin/env node
/**
 * Importa o histórico gerado pela versão PowerShell (Windows) para o
 * formato do servidor.
 *
 *   node scripts/importar-historico-windows.mjs <pasta-origem> [--dry-run]
 *
 * A pasta de origem é a varredura-voos do Windows, com precos.csv e
 * opcionalmente historico.json. Linhas cuja data+destino já existem são
 * ignoradas, então rodar duas vezes não duplica.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { carregarConfig } from "../src/config.js";

const [origem, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");

if (!origem) {
  console.error("Uso: node scripts/importar-historico-windows.mjs <pasta-origem> [--dry-run]");
  process.exit(1);
}

const destino = carregarConfig().dataDir;
const csvOrigem = path.join(origem, "precos.csv");
const csvDestino = path.join(destino, "precos.csv");

if (!existsSync(csvOrigem)) {
  console.error(`Não achei ${csvOrigem}`);
  process.exit(1);
}

/** CSV com ';' e aspas duplas escapadas — mesmo dialeto que o store grava. */
function parseCsv(texto) {
  const linhas = texto.replace(/\r\n/g, "\n").trim().split("\n");
  const cab = linhas.shift().split(";");
  return linhas.filter(Boolean).map((l) => {
    const campos = [];
    let atual = "";
    let dentroAspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (dentroAspas) {
        if (c === '"' && l[i + 1] === '"') { atual += '"'; i++; }
        else if (c === '"') dentroAspas = false;
        else atual += c;
      } else if (c === '"') dentroAspas = true;
      else if (c === ";") { campos.push(atual); atual = ""; }
      else atual += c;
    }
    campos.push(atual);
    return Object.fromEntries(cab.map((k, i) => [k, campos[i] ?? ""]));
  });
}

const novas = parseCsv(readFileSync(csvOrigem, "utf8"));

const existentes = new Set();
if (existsSync(csvDestino)) {
  for (const r of parseCsv(readFileSync(csvDestino, "utf8"))) {
    existentes.add(`${r.data}|${r.destino}`);
  }
}

const aImportar = novas.filter((r) => r.data && r.destino && !existentes.has(`${r.data}|${r.destino}`));

console.log(`origem ....... ${novas.length} linhas`);
console.log(`já existiam .. ${novas.length - aImportar.length}`);
console.log(`a importar ... ${aImportar.length}`);

if (dryRun) {
  console.log("\n--dry-run: nada foi gravado.");
  process.exit(0);
}
if (!aImportar.length) {
  console.log("\nNada a fazer.");
  process.exit(0);
}

mkdirSync(destino, { recursive: true });

const COLUNAS = ["data", "destino", "cidade", "regiao", "preco", "paradas", "cia", "ida", "volta"];
const campo = (v) => (/[;"\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
const corpo = aImportar.map((r) => COLUNAS.map((c) => campo(r[c])).join(";")).join("\n");
const novoArquivo = !existsSync(csvDestino);
appendFileSync(csvDestino, (novoArquivo ? COLUNAS.join(";") + "\n" : "") + corpo + "\n", "utf8");

// historico.json: funde as séries, ordena por data e tira duplicatas
const histDestino = path.join(destino, "historico.json");
const hist = existsSync(histDestino) ? JSON.parse(readFileSync(histDestino, "utf8")) : {};

for (const r of aImportar) {
  const preco = Number(r.preco);
  if (!Number.isFinite(preco)) continue;
  const serie = Array.isArray(hist[r.destino]) ? hist[r.destino] : [];
  if (!serie.some((p) => p.data === r.data)) serie.push({ data: r.data, preco });
  hist[r.destino] = serie.sort((a, b) => a.data.localeCompare(b.data)).slice(-400);
}
writeFileSync(histDestino, JSON.stringify(hist, null, 2), "utf8");

console.log(`\nImportado para ${destino}`);
console.log(`  precos.csv     +${aImportar.length} linhas`);
console.log(`  historico.json ${Object.keys(hist).length} destinos`);
