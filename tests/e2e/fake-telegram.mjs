// Поддельный Bot API для сквозной проверки: пишет все вызовы в файл, ничего не отправляет в Telegram.
import http from "node:http";
import fs from "node:fs";
const log = process.argv[2];
let id = 500;
const results = {
  getMe: () => ({ id: 1, is_bot: true, first_name: "t", username: "t_bot" }),
  getUpdates: () => [{ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 111, type: "private" }, from: { id: 111, is_bot: false, first_name: "Owner", username: "owner" }, text: "hi" } }],
  getChat: () => ({ id: -1001, title: "Тест", type: "channel" }),
  getChatMember: () => ({ status: "administrator", can_post_messages: true, user: { id: 1 } }),
};
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/health") return res.end("ok");
    const method = req.url.split("/").pop();
    fs.appendFileSync(log, JSON.stringify({ method, body: body.slice(0, 2000) }) + "\n");
    const chatId = (() => { try { return JSON.parse(body).chat_id; } catch { return -1001; } })();
    res.setHeader("content-type", "application/json");
    const result = results[method]?.() ?? { message_id: ++id, chat: { id: Number(chatId), username: "wtw_test" }, date: 0 };
    res.end(JSON.stringify({ ok: true, result }));
  });
}).listen(Number(process.argv[3] ?? 4555));
