/**
 * Servidor do painel, independente do bot do WhatsApp.
 *
 *   npm run painel   → http://127.0.0.1:3060/varredura
 *
 * Escuta só em 127.0.0.1 por padrão: a página não tem autenticação.
 * Para acessar de fora, túnel SSH ou cloudflared (PAINEL_HOST muda o bind).
 */
import "dotenv/config";
import express from "express";
import { carregarConfig } from "./config.js";
import { painelVarredura } from "./painel.js";

const PORT = Number(process.env.PAINEL_PORT || 3060);
const HOST = process.env.PAINEL_HOST || "127.0.0.1";

const app = express();
app.use(painelVarredura(carregarConfig().dataDir));
app.get("/", (req, res) => res.redirect("/varredura"));

app.listen(PORT, HOST, () => {
  console.log(`[painel] http://${HOST}:${PORT}/varredura`);
});
