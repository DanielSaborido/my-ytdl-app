import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import os from "os";
import https from "https";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import open from "open";

const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 5173;
const url = `http://localhost:${PORT}`;
const BIN_DIR = path.join(os.homedir(), ".local-bin");
const YTDLP_FILE = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const YTDLP_PATH = path.join(BIN_DIR, YTDLP_FILE);

// ===============================================================
//  CARGAR COOKIES JSON (para análisis)
// ===============================================================
function loadJsonCookies() {
  const file = fs.readFileSync("./cookies_json.txt", "utf8");
  const arr = JSON.parse(file);
  return arr.map(c => `${c.name}=${c.value}`).join("; ");
}
const COOKIE_JSON_STRING = loadJsonCookies();

// ===============================================================
//  DESCARGAR/ACTUALIZAR YT-DLP
// ===============================================================
async function ensureYTDLP() {
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  if (fs.existsSync(YTDLP_PATH)) {
    try {
      await new Promise((resolve) => {
        const update = spawn(YTDLP_PATH, ["-U"]);
        update.on("close", () => resolve());
        update.on("error", () => resolve());
      });
      return YTDLP_PATH;
    } catch {
      console.log("Error actualizando yt-dlp, re-descargando…");
    }
  }

  const downloadURL =
    process.platform === "win32"
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

  return new Promise((resolve, reject) => {
    https.get(downloadURL, (resp) => {
      if (resp.statusCode >= 400) return reject(new Error("No se pudo descargar yt-dlp"));
      const fileStream = fs.createWriteStream(YTDLP_PATH);
      resp.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        try { fs.chmodSync(YTDLP_PATH, 0o755); } catch {}
        resolve(YTDLP_PATH);
      });
      fileStream.on("error", reject);
    }).on("error", reject);
  });
}

// ===============================================================
// SAFE FILENAME
// ===============================================================
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

// ===============================================================
// GET YT-DLP INFO
// ===============================================================
function extractYouTubeIds(raw) {
  if (!raw) return { videoId: null, playlistId: null };
  let s = raw.toString().trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let url;
  try {
    url = new URL(s);
  } catch {
    return { videoId: null, playlistId: null };
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let videoId = null;
  let playlistId = null;

  if (url.searchParams.has("list")) {
    playlistId = url.searchParams.get("list");
  }
  if (url.searchParams.has("v")) {
    videoId = url.searchParams.get("v");
  }
  if (!videoId && host === "youtu.be") {
    videoId = url.pathname.slice(1);
  }
  if (!videoId && url.pathname.startsWith("/shorts/")) {
    videoId = url.pathname.split("/")[2];
  }
  if (!videoId && host === "music.youtube.com") {
    videoId = url.searchParams.get("v");
  }

  return { videoId, playlistId };
}

const YT_KEY = "AIzaSyAO_FJ2SlqUOrAgW2P9Wf5Kcp_FvN9UApo";

// ===============================================================
//  FETCH ANDROID + COOKIES (bypass EJS challenge)
// ===============================================================
async function fetchInnerTube(body) {
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/browse?key=${YT_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.youtube/19.08.35"
      },
      body: JSON.stringify({
        ...body,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.08.35",
            androidSdkVersion: 30,
            hl: "es",
            gl: "US"
          }
        }
      })
    }
  );
  return res.json();
}

// ===============================================================
// EXTRAER PLAYER RESPONSE (con cookies)
// ===============================================================
async function getPlayerResponse(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetch(watchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Cookie": COOKIE_JSON_STRING
    }
  }).then(r => r.text());
  const marker = "ytInitialPlayerResponse =";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  let jsonText = html.slice(idx + marker.length);
  let depth = 0;
  let end = 0;
  for (let i = 0; i < jsonText.length; i++) {
    if (jsonText[i] === "{") depth++;
    if (jsonText[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (!end) return null;
  jsonText = jsonText.slice(0, end);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("JSON parse failed:", e.message);
    return null;
  }
}

// ===============================================================
// INFO API
// ===============================================================
async function getFullPlaylist(playlistId) {
  let results = [];
  let nextToken = null;
  let title = "";
  let json = await fetchInnerTube({
    context: { client: { clientName: "ANDROID", clientVersion: "19.08.35" } },
    browseId: playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`
  });
  const header = json?.header?.playlistHeaderRenderer;

  if (header?.title?.runs?.[0]?.text) title = header.title.runs[0].text;
  function extractVideos(obj) {
    let out = [];
    let cont = null;
    function dig(o) {
      if (!o || typeof o !== "object") return;
      if (o.playlistVideoRenderer) {
        out.push({
          url: "https://www.youtube.com/watch?v=" + o.playlistVideoRenderer.videoId,
          title: o.playlistVideoRenderer.title?.runs?.[0]?.text || "",
          duration: o.playlistVideoRenderer.lengthText?.runs?.[0]?.text || ""
        });
      }
      const c1 = o.playlistVideoListRenderer?.continuations;
      const c2 = o.playlistVideoListContinuation?.continuations;
      const continuations = c1 || c2;
      if (Array.isArray(continuations)) {
        for (const c of continuations) {
          const d = c.nextContinuationData;
          if (d?.continuation && !cont) cont = d.continuation;
        }
      }
      for (const k in o) dig(o[k]);
    }
    dig(obj);
    return { out, cont };
  }

  let page1 = extractVideos(json);
  results.push(...page1.out);
  nextToken = page1.cont;
  while (nextToken) {
    json = await fetchInnerTube({
      context: { client: { clientName: "ANDROID", clientVersion: "19.08.35" } },
      continuation: nextToken
    });
    let p = extractVideos(json);
    results.push(...p.out);
    nextToken = p.cont;
  }
  return { title, results };
}

// ===============================================================
// API /info
// ===============================================================
const app = express();

app.get("/api/info", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Falta URL");
    const { videoId, playlistId } = extractYouTubeIds(url);
    if (playlistId) {
      const { title, results } = await getFullPlaylist(playlistId);
      return res.json({ type: "playlist", title, url, videos: results });
    }
    if (!videoId) return res.status(400).send("ID inválido");
    const pr = await getPlayerResponse(videoId);
    if (!pr) return res.status(500).send("No se pudo obtener info");
    return res.json({
      type: "video",
      title: pr.videoDetails?.title || "Sin título",
      thumbnail: pr.videoDetails?.thumbnail?.thumbnails?.pop()?.url || "",
      url: `https://www.youtube.com/watch?v=${videoId}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error en análisis");
  }
});

// ===============================================================
// STREAM YT-DLP
// ===============================================================
function streamFromYTDLP(url, format, res, title) {
  const isAudio = format === "audio";
  const filename = `${safeTitle(title)}.${isAudio ? "mp3" : "mp4"}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", isAudio ? "audio/mpeg" : "video/mp4");

  const args = [];
  if (isAudio) {
    args.push("-f", "bestaudio", "--extract-audio", "--audio-format", "mp3");
  } else {
    args.push("-f", "bestvideo+bestaudio/best");
  }
  args.push("-o", "-", "--no-mtime", "--quiet", "--ffmpeg-location", ffmpegPath, "--js-runtimes", "node", url);

  const ytdlp = spawn(YTDLP_PATH, args);
  ytdlp.stderr.on("data", (d) => console.error("yt-dlp:", d.toString()));
  ytdlp.stdout.pipe(res);
  ytdlp.on("close", (code) => {
    if (code !== 0) console.error("yt-dlp exited with", code);
    try { res.end(); } catch {}
  });
}

// ===============================================================
// SERVIDOR EXPRESS
// ===============================================================
app.get("/api/download", async (req, res) => {
  try {
    const { url, extension, title } = req.query;
    if (!url) return res.status(400).send("Falta URL");
    await ensureYTDLP();
    const fmt = extension === "audio" ? "audio" : "video";
    streamFromYTDLP(url, fmt, res, title || "file");
  } catch (err) {
    console.error("API /download error:", err);
    res.status(500).send("Error en descarga: " + (err.message || err));
  }
});

// ===============================================================
// VITE O STATIC
// ===============================================================
if (isProd) {
  app.use(express.static("dist"));
  app.get("*", (_, res) => res.sendFile(path.resolve("dist", "index.html")));
} else {
  (async () => {
    const vite = await createViteServer({ server: { middlewareMode: true } });
    app.use(vite.middlewares);
  })();
}

app.listen(PORT, () => {
  console.log(`🚀 Servidor listo: ${url}`);
  if (!process.env.BROWSER_OPENED) {
    process.env.BROWSER_OPENED = "true";
    open(url);
  }
});