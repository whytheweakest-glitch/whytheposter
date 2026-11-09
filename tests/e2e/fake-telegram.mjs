// Поддельный Bot API для сквозной проверки: пишет все вызовы в файл, ничего не отправляет в Telegram.
import http from "node:http";
import fs from "node:fs";
const log = process.argv[2];
let id = 500;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const method = req.url.split("/").pop();
    fs.appendFileSync(log, JSON.stringify({ method, body: body.slice(0, 2000) }) + "\n");
    const chatId = (() => { try { return JSON.parse(body).chat_id; } catch { return -1001; } })();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: method === "getMe" ? { id: 1, is_bot: true, first_name: "t", username: "t_bot" } : { message_id: ++id, chat: { id: Number(chatId), username: "wtw_test" }, date: 0 } }));
  });
}).listen(Number(process.argv[3] ?? 4555));
