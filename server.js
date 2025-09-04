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

    execFile("yt-dlp", ["-j", url], (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp error:", stderr || err);
        return res.status(500).json({
          error: "Error al obtener info",
          details: stderr?.toString() || err.message,
        });
      }

      try {
        const data = JSON.parse(stdout);

        res.json({
          title: data.title,
          thumbnail: data.thumbnail,
          url,
        });
      } catch (parseErr) {
        console.error("Error parseando JSON:", parseErr);
        res.status(500).json({
          error: "Error parseando JSON de yt-dlp",
          raw: stdout,
        });
      }
    });
  });

  // API para descarga de YouTube
  app.get("/api/download", (req, res) => {
    const { url, type, title } = req.query;
    if (!url) return res.status(400).send("Falta la URL");
    const format =
      type === "audio"
        ? "bestaudio[ext=mp3]"
        : "bv*[ext=mp4]+ba[ext=mp3]/b[ext=mp4]";

    const ext = type === "audio" ? "mp3" : "mp4";
    const filename = safeTitle(title || "download") + "." + ext;
    const filepath = path.join(tmpdir(), filename);

    console.log(`📥 Descargando ${url} en formato ${format} -> ${filepath}`);

    const child = spawn("yt-dlp", ["-f", format, "-o", filepath, url]);

    child.stderr.on("data", (data) => console.error("yt-dlp:", data.toString()));

    child.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).send("Error en la descarga con yt-dlp");
      }
      res.download(filepath, filename, (err) => {
        if (!err) {
          fs.unlink(filepath, () => {});
        }
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
