import express from "express";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFile, spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";
import archiver from "archiver";

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
      .replace(/\./g, "")
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
      url.includes("playlist?list=") ? "--flat-playlist" : "",
      url
    ].filter(Boolean);

    const child = spawn("yt-dlp", args, { shell: false });

    let output = "";
    let errOutput = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (data) => { errOutput += data.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error("yt-dlp error:", errOutput);
        return res.status(500).json({ error: "Error al obtener info" });
      }
      try {
        const data = JSON.parse(output);
        if (Array.isArray(data.entries)) {
          const videos = data.entries.map(entry => ({
            title: entry.title || "Sin título",
            url: entry.url
              ? `https://www.youtube.com/watch?v=${entry.id || entry.url}`
              : ""
          }));
          return res.json({ type: "playlist", url: data.webpage_url || url, title: data.title, videos });
        } else {
          const video = {
            type: "video",
            title: data.title || "Sin título",
            thumbnail: data.thumbnail || "",
            url: data.webpage_url || url
          };
          return res.json(video);
        }
      } catch (e) {
        console.error("Error parseando JSON:", e);
        return res.status(500).json({ error: "Error parseando JSON de yt-dlp" });
      }
    });
  });

  // API para descarga de YouTube
  app.get("/api/download", (req, res) => {
    const { url, extension, title } = req.query;
    if (!url) return res.status(400).send("Falta la URL");
    const format =
      extension === "audio"
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

      const realExt = path.extname(filePath).replace(".", "") || (extension === "audio" ? "mp3" : "mp4");
      const niceName = `${safeTitle(title || "download")}.${extension === "audio" ? "mp3" : realExt}`;
      console.log(`${niceName}`);

      res.download(filePath, niceName, (err) => {
        fs.unlink(filePath, () => {});
        if (err) console.error("Error enviando el archivo:", err);
      });
    });
  });

  // API para descarga de playlist completa de YouTube
  app.get("/api/download-playlist", (req, res) => {
    const { url, extension, title } = req.query;
    if (!url) return res.status(400).send("Falta la URL");
    const format =
      extension === "audio"
        ? "bestaudio[ext=m4a]/bestaudio[acodec*=opus]/bestaudio"
        : "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b";

    const id = crypto.randomUUID();
    const outDir = path.join(tmpdir(), id);
    fs.mkdirSync(outDir, { recursive: true });

    const outTemplate = path.join(outDir, "%(title)s.%(ext)s");

    const args = [
      "--ignore-config",
      "--no-warnings",
      "--no-progress",
      "-f", format,
      "-o", outTemplate,
      url
    ];

    console.log(`📥 Descargando playlist en lote: ${url}`);

    const child = spawn("yt-dlp", args, { shell: false });

    child.stderr.on("data", (data) => console.error("yt-dlp:", data.toString()));

    child.on("close", async (code) => {
      if (code !== 0) {
        return res.status(500).send("Error en la descarga de playlist con yt-dlp");
      }

      try {
        const files = fs.readdirSync(outDir).map(n => path.join(outDir, n));

        if (!files.length) {
          return res.status(500).send("No se encontraron archivos de la playlist");
        }

        const zipName = `${safeTitle(title || "playlist")}.zip`;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.pipe(res);

        for (const file of files) {
          console.log(`${file}`);
          archive.file(file, { name: safeTitle(path.basename(file)).slice(0, -3)+(extension === "audio" ? ".mp3" : ".mp4") });
        }

        archive.finalize();

        archive.on("end", () => {
          for (const file of files) fs.unlink(file, () => {});
          fs.rmdir(outDir, () => {});
        });
      } catch (err) {
        console.error("Error creando zip:", err);
        return res.status(500).send("Error creando el ZIP de la playlist");
      }
    });
  });

  // Crear servidor Vite en modo middleware
  const vite = await createViteServer({ server: { middlewareMode: true } });
  app.use(vite.middlewares);

  const PORT = 5173;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

start();
