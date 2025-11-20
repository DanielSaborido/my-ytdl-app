import express from "express";
import fs from "fs";
import path from "path";
import ytdl from "ytdl-core";
import { createServer as createViteServer } from "vite";
import os from "os";
import https from "https";
import { spawn } from "child_process";

const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 5173;
const YTDLP_PATH = path.join(os.homedir(), ".local-bin", "yt-dlp.exe");

async function start() {
  const app = express();

  async function ensureYTDLP() {
    const binDir = path.join(os.homedir(), ".local-bin");
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
    const FILE = process.platform === "win32"
      ? "yt-dlp.exe"
      : "yt-dlp";
    const YTDLP_PATH = path.join(binDir, FILE);
    if (fs.existsSync(YTDLP_PATH)) {
      console.log("✔️ yt-dlp encontrado:", YTDLP_PATH);
      return YTDLP_PATH;
    }
    console.log("⬇️ Descargando yt-dlp…");
    const downloadURL = process.platform === "win32"
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    return new Promise((resolve, reject) => {
      function download(url) {
        https.get(
          url,
          { headers: { "User-Agent": "Mozilla/5.0" } },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              console.log("➡️ Redirigiendo a:", res.headers.location);
              return download(res.headers.location);
            }
            if (res.statusCode !== 200) {
              return reject(`HTTP ${res.statusCode}`);
            }
            const fileStream = fs.createWriteStream(YTDLP_PATH);
            res.pipe(fileStream);
            fileStream.on("finish", () => {
              fileStream.close();
              fs.chmodSync(YTDLP_PATH, 0o755);
              console.log(`✔️ yt-dlp instalado en ${YTDLP_PATH}`);
              resolve(YTDLP_PATH);
            });
          }
        ).on("error", reject);
      }
      download(downloadURL);
    });
  }

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

  const YT_KEY = "AIzaSyAO_FJ2SlqUOrAgW2P9Wf5Kcp_FvN9UApo";

  async function fetchInnerTube(body) {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/browse?key=${YT_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    return res.json();
  }

  function extractVideos(json) {
    let results = [];
    let nextToken = null;

    function dig(obj) {
      if (!obj || typeof obj !== "object") return;
      if (obj.playlistVideoRenderer) {
        results.push({
          url: `https://www.youtube.com/watch?v=${obj.playlistVideoRenderer.videoId}`,
          title: obj.playlistVideoRenderer.title?.runs?.[0]?.text || "",
          duration: obj.playlistVideoRenderer.lengthText?.runs?.[0]?.text || ""
        });
      }
      const continuations = obj.playlistVideoListRenderer?.continuations || obj.playlistVideoListContinuation?.continuations;
      if (Array.isArray(continuations)) {
        for (const cont of continuations) {
          const nextContinuationData = cont.nextContinuationData;
          if (nextContinuationData?.continuation) {
            nextToken = nextContinuationData.continuation;
          }
        }
      }
      for (const k in obj) {
        if (typeof obj[k] === "object") dig(obj[k]);
      }
    }
    dig(json);
    return { results, nextToken };
  }

  async function getFullPlaylist(playlistId) {
    let results = [];
    let nextToken = null;
    let pageIndex = 1;
    let title = "";

    let json = await fetchInnerTube({
      context: { client: { clientName: "ANDROID", clientVersion: "19.08.35" } },
      browseId: `VL${playlistId}`
    });
    fs.writeFileSync("playlist_dump.json", JSON.stringify(json, null, 2));
    console.log("📁 JSON guardado en playlist_dump.json");
    const header = json?.header?.playlistHeaderRenderer;
    if (header?.title?.runs?.[0]?.text) {
      title = header.title.runs[0].text;
    }
    let { results: pageVideos, nextToken: cont } = extractVideos(json);
    results.push(...pageVideos);
    nextToken = cont;
    console.log("Página inicial:", results.length, "videos");

    while (nextToken) {
      json = await fetchInnerTube({
        context: { client: { clientName: "ANDROID", clientVersion: "19.08.35" } },
        continuation: nextToken
      });
      fs.writeFileSync(
        `playlist_page_${pageIndex}.json`,
        JSON.stringify(json, null, 2)
      );
      console.log(`📁 Guardada página ${pageIndex}`);
      pageIndex++;
      const { results: pageResults, nextToken: cont2 } = extractVideos(json);
      results.push(...pageResults);
      nextToken = cont2;
      console.log("🔢 Total acumulado:", results.length);
    }
    return { title, results };
  }

  /**************************************
   * EXTRAER PLAYER RESPONSE OFICIAL
   **************************************/
  async function getPlayerResponse(videoId) {
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
        const { title, results: videos } = await getFullPlaylist(playlistId);
        return res.json({
          type: "playlist",
          title: title,
          url,
          videos
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
  function streamFromYTDLP(url, format, res, title) {
    const filename = `${safeTitle(title)}.${format === "audio" ? "mp3" : "mp4"}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", format === "audio" ? "audio/mpeg" : "video/mp4");
    const ytdlp = spawn(YTDLP_PATH, [
      "-f",
      format === "audio" ? "bestaudio" : "best",
      "--audio-format",
      "mp3",
      "-o",
      "-",
      url,
      "--quiet"
    ], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    ytdlp.stdout.pipe(res);
    ytdlp.on("close", () => res.end());
  }

  app.get("/api/download", async (req, res) => {
    try {
      const { url, extension, title } = req.query;
      if (!url) return res.status(400).send("Falta la URL");
      await ensureYTDLP();
      streamFromYTDLP(url, extension === "audio" ? "audio" : "video", res, title || "video");
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