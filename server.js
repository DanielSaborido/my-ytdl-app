import express from "express";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFile, spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";

async function start() {
  const app = express();

  // Función para limpiar el título de manera segura
  function safeTitle(title) {
    return title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 100)
      .trim();
  }

  // API para analizar YouTube
  app.get("/api/info", (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Falta la URL");

    const args = [
      "--ignore-config",
      "--no-warnings",
      "--skip-download",
      "-J",
      url
    ];

    execFile("yt-dlp", args, (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp error:", stderr || err);
        return res.status(500).json({ error: "Error al obtener info" });
      }
      try {
        const data = JSON.parse(stdout);
        const title = data.title || (data.entries && data.entries[0]?.title) || "Sin título";
        const thumbnail = data.thumbnail || (data.entries && data.entries[0]?.thumbnail) || "";
        return res.json({ title, thumbnail, url });
      } catch (e) {
        console.error("Error parseando JSON:", e);
        return res.status(500).json({ error: "Error parseando JSON de yt-dlp" });
      }
    });
  });

  // API para descarga de YouTube
  app.get("/api/download", (req, res) => {
    const { url, type, title } = req.query;
    if (!url) return res.status(400).send("Falta la URL");
    const format =
      type === "audio"
        ? "bestaudio[ext=m4a]/bestaudio[acodec*=opus]/bestaudio"
        : "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b";

    const id = crypto.randomUUID();
    const outTemplate = path.join(tmpdir(), `${id}.%(ext)s`);

    const args = [
      "--ignore-config",
      "--no-warnings",
      "--no-progress",
      "--no-check-formats",
      "--concurrent-fragments", "1",
      // "--cookies-from-browser", "chrome",
      // "--cookies-from-browser", "edge",
      "-f", format,
      "-o", outTemplate,
      "--print", "after_move:filepath",
      url
    ];

    console.log(`📥 Descargando ${url} con formato: ${format}`);
    const child = spawn("yt-dlp", args, { shell: false });

    let printed = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { printed += chunk; });

    child.stderr.on("data", (data) => console.error("yt-dlp:", data.toString()));

    child.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).send("Error en la descarga con yt-dlp");
      }

      let filePath = printed.trim().split(/\r?\n/).filter(Boolean).pop();

      if (!filePath) {
        const files = fs.readdirSync(tmpdir())
          .filter(n => n.startsWith(id + "."))
          .map(n => path.join(tmpdir(), n));
        filePath = files[0];
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(500).send("No se pudo localizar el archivo descargado");
      }

      const realExt = path.extname(filePath).replace(".", "") || (type === "audio" ? "m4a" : "mp4");
      const niceName = `${safeTitle(title || "download")}.${realExt}`;

      res.download(filePath, niceName, (err) => {
        fs.unlink(filePath, () => {});
        if (err) console.error("Error enviando el archivo:", err);
      });
    });
  });

  // Crear servidor Vite en modo middleware
  const vite = await createViteServer({ server: { middlewareMode: true } });
  app.use(vite.middlewares);

  const PORT = 5173;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

start();
