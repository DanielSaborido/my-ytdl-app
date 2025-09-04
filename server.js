import express from "express";
import { execFile, spawn } from "child_process";
import { createServer as createViteServer } from "vite";

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

    execFile("yt-dlp", ["--get-title", "--get-thumbnail", url], (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp error:", stderr || err);
        return res.status(500).json({ error: "Error al obtener info", details: stderr || err.message });
      }

      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        return res.status(500).json({ error: "Salida incompleta de yt-dlp", raw: stdout });
      }

      const [title, thumbnail] = lines;
      res.json({ title, thumbnail, url });
    });
  });

  // API para descarga de YouTube
  app.get("/api/download", (req, res) => {
    const { url, type, title } = req.query;
    if (!url) return res.status(400).send("Falta la URL");

    const format = type === "audio" ? "bestaudio" : "bestvideo+bestaudio";
    const ext = type === "audio" ? "mp3" : "mp4";
    const filename = safeTitle(title || "download");

    res.setHeader("Content-Disposition", `attachment; filename="${filename}.${ext}"`);

    const child = spawn("yt-dlp", ["-f", format, "-o", "-", url]);

    // Pipe directo al response
    child.stdout.pipe(res);

    child.stderr.on("data", (data) => {
      console.error("yt-dlp error:", data.toString());
    });

    child.on("close", (code) => {
      if (code !== 0) console.error(`yt-dlp salió con código ${code}`);
    });
  });

  // Crear servidor Vite en modo middleware
  const vite = await createViteServer({ server: { middlewareMode: true } });
  app.use(vite.middlewares);

  const PORT = 5173;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

start();
