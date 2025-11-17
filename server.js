import express from "express";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import archiver from "archiver";
import { createServer as createViteServer } from "vite";

const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 5173;

async function start() {
  const app = express();

  /**************************************
   * SAFE FILENAME
   **************************************/
  function safeTitle(title) {
    return (title || "file")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 100)
      .trim();
  }

  /**************************************
   * EXTRAER ID YouTube
   **************************************/
  function extractYouTubeIds(raw) {
    if (!raw) return { videoId: null, playlistId: null };
    let s = raw.toString().trim();
    if (!/^https?:\/\//i.test(s)) {
      s = "https://" + s;
    }
    let url;
    try {
      url = new URL(s);
    } catch (e) {
      return { videoId: null, playlistId: null };
    }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let videoId = null;
    let playlistId = null;

    if (host === "youtu.be") {
      const p = url.pathname || "";
      if (p.startsWith("/")) videoId = p.slice(1).split("/")[0] || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "www.youtube.com") {
      if (url.searchParams.has("v")) {
        videoId = url.searchParams.get("v");
      }
      if (url.searchParams.has("list")) {
        playlistId = url.searchParams.get("list");
      }
      if (!videoId) {
        const path = url.pathname || "";
        const parts = path.split("/").filter(Boolean);
        if (parts[0] === "embed" && parts[1]) videoId = parts[1];
        if (!videoId && parts[0] === "v" && parts[1]) videoId = parts[1];
      }
    }

    if (!videoId && /^[a-zA-Z0-9_-]{6,}$/.test(raw)) {
      videoId = raw;
    }

    return {
      videoId: videoId || null,
      playlistId: playlistId || null
    };
  }

  /**************************************
   * EXTRAER PLAYER RESPONSE OFICIAL
   **************************************/
  async function getPlayerResponse(videoId) {
    console.log(videoId)
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const html = await fetch(watchUrl).then(r => r.text());

    const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[1]);
  }

  /**************************************
   * API: INFO (video o playlist)
   **************************************/
  app.get("/api/info", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).send("Falta la URL");
      const { videoId, playlistId } = extractYouTubeIds(url);

      if (playlistId) {
        const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
        const html = await fetch(playlistUrl).then(r => r.text());

        const entries = [...html.matchAll(/"playlistVideoRenderer":\s*(\{.+?\})/gs)]
          .map(m => JSON.parse(m[1]))
          .map(v => ({
            type: "video",
            title: v.title?.runs?.[0]?.text || "Sin título",
            url: `https://www.youtube.com/watch?v=${v.videoId}`
          }));

        return res.json({
          type: "playlist",
          title: safeTitle(playlistId),
          url: playlistUrl,
          videos: entries
        });
      }

      if (!videoId) return res.status(400).send("URL de YouTube inválida (no se pudo extraer ID)");

      const pr = await getPlayerResponse(videoId);
      if (!pr) return res.status(500).send("No se pudo obtener info del video");

      return res.json({
        type: "video",
        title: pr.videoDetails?.title || "Sin título",
        thumbnail: pr.videoDetails?.thumbnail?.thumbnails?.pop()?.url || "",
        url: `https://www.youtube.com/watch?v=${videoId}`
      });

    } catch (err) {
      console.error(err);
      res.status(500).send("Error analizando enlace");
    }
  });

  /**************************************
   * API: DESCARGA DIRECTA DE AUDIO/VIDEO
   **************************************/
  app.get("/api/download", async (req, res) => {
    try {
      const { url, extension, title } = req.query;
      if (!url) return res.status(400).send("Falta la URL");
      const { videoId } = extractYouTubeIds(url);
      if (!videoId) return res.status(400).send("ID de video no encontrado en la URL");
      const pr = await getPlayerResponse(videoId);
      if (!pr) return res.status(500).send("No se pudo obtener playerResponse");
      const formats = pr.streamingData?.adaptiveFormats;
      if (!formats) return res.status(500).send("No hay streams disponibles");

      let chosen;
      if (extension === "audio") {
        chosen =
          formats.find(f => f.mimeType.includes("audio/mp4")) ||
          formats.find(f => f.mimeType.includes("audio/webm")) ||
          formats.find(f => f.mimeType.includes("audio"));
      } else {
        chosen =
          formats.find(f => f.mimeType.includes("video/mp4") && f.height <= 1080 && f.mimeType.includes("video/mp4")) ||
          formats.find(f => f.mimeType.includes("video/webm")) ||
          formats.find(f => f.mimeType.includes("video"));
      }
      if (!chosen?.url)
        return res.status(500).send("No se encontró stream válido");

      const fileExt = extension === "audio"
        ? chosen.mimeType.includes("webm") ? "webm" : "m4a"
        : chosen.mimeType.includes("webm") ? "webm" : "mp4";
      const filename = `${safeTitle(title)}.${fileExt}`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", chosen.mimeType.split(";")[0]);

      console.log("➡️ Streaming directo:", filename);

      const stream = await fetch(chosen.url);
      stream.body.pipe(res);

    } catch (err) {
      console.error(err);
      res.status(500).send("Error descargando");
    }
  });

  if (isProd) {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({ server: { middlewareMode: true } });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () =>
    console.log(`🚀 Servidor funcionando en http://localhost:${PORT}`)
  );
}
start();