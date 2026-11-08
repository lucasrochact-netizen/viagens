/**
 * Servidor do painel.
 *
 *   npm run painel   → http://127.0.0.1:3060/varredura
 *
 * Com PAINEL_TOKEN definido, exige o link secreto: /?k=<token> grava um
 * cookie e redireciona; depois disso a página abre direto. Sem o cookie,
 * 401. É o que permite expor o painel por cloudflared sem login.
 */
import "dotenv/config";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { carregarConfig } from "./config.js";
import { painelVarredura } from "./painel.js";

const PORT = Number(process.env.PAINEL_PORT || 3060);
const HOST = process.env.PAINEL_HOST || "127.0.0.1";
const TOKEN = process.env.PAINEL_TOKEN || "";
const COOKIE = "viagens_k";

function igual(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(TOKEN);
  return x.length === y.length && timingSafeEqual(x, y);
}

function lerCookie(req, nome) {
  for (const par of (req.get("cookie") || "").split(";")) {
    const [k, ...v] = par.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return "";
}

export function exigirToken(req, res, next) {
  if (!TOKEN) return next();
  if (igual(req.query.k, TOKEN)) {
    res.cookie(COOKIE, TOKEN, {
      httpOnly: true, sameSite: "lax", maxAge: 365 * 86_400_000,
      secure: req.get("x-forwarded-proto") === "https",
    });
    const url = new URL(req.originalUrl, "http://x");
    url.searchParams.delete("k");
    return res.redirect(url.pathname === "/" ? "/varredura" : url.pathname + url.search);
  }
  if (igual(lerCookie(req, COOKIE), TOKEN)) return next();
  res.status(401).type("text").send("Acesso negado. Use o link com o código.");
}

const app = express();
app.use(exigirToken);
app.use(painelVarredura(carregarConfig().dataDir));
app.get("/", (req, res) => res.redirect("/varredura"));

app.listen(PORT, HOST, () => {
  console.log(`[painel] http://${HOST}:${PORT}/varredura${TOKEN ? " (com token)" : ""}`);
});
