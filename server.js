import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import { spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import ffmpegPath from "ffmpeg-static";
import open from "open";

const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 5173;
const url = `http://localhost:${PORT}`;
const BIN_DIR = path.join(os.homedir(), ".local-bin");
const YTDLP_FILE = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const YTDLP_PATH = path.join(BIN_DIR, YTDLP_FILE);

// ===============================================================
// DOWNLOAD STORAGE
// ===============================================================
const DOWNLOAD_DIR = path.join(os.tmpdir(), "yt-downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

let playlistJobs = {};

// ===============================================================
// YT-DLP SETUP
// ===============================================================
async function ensureYTDLP() {
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  if (fs.existsSync(YTDLP_PATH)) return YTDLP_PATH;

  const downloadURL =
    process.platform === "win32"
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

  return new Promise((resolve, reject) => {
    https.get(downloadURL, resp => {
      const file = fs.createWriteStream(YTDLP_PATH);
      resp.pipe(file);
      file.on("finish", () => {
        file.close();
        try { fs.chmodSync(YTDLP_PATH, 0o755); } catch {}
        resolve(YTDLP_PATH);
      });
    }).on("error", reject);
  });
}

// ===============================================================
// HELPERS
// ===============================================================
function safeTitle(title) {
  return (title || "file")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/[^a-zA-Z0-9\s-_]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function normalizeVideoUrl(v) {
  if (v.webpage_url) return v.webpage_url;
  if (!v.url) return null;
  if (v.url.startsWith("http")) return v.url;
  return `https://www.youtube.com/watch?v=${v.url}`;
}

// ===============================================================
// ANALYZE
// ===============================================================
function analyzeWithYTDLP(targetUrl) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(YTDLP_PATH, [
      "-J",
      "--flat-playlist",
      "--skip-download",
      targetUrl
    ]);

    let out = "";
    ytdlp.stdout.on("data", d => out += d.toString());
    ytdlp.on("close", () => resolve(JSON.parse(out)));
    ytdlp.on("error", reject);
  });
}

// ===============================================================
// STREAM SINGLE DOWNLOAD
// ===============================================================
function streamFromYTDLP(targetUrl, format, res, title) {
  const ext = format === "audio" ? "mp3" : "mp4";
  const filename = `${safeTitle(title)}.${ext}`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/octet-stream");

  const args = format === "audio"
    ? ["-f", "bestaudio", "--extract-audio", "--audio-format", "mp3"]
    : ["-f", "mp4"];

  args.push("--js-runtimes", "node", "-o", "-", targetUrl);

  const ytdlp = spawn(YTDLP_PATH, args);
  ytdlp.stdout.pipe(res);
}

// ===============================================================
// PLAYLIST PROCESSOR
// ===============================================================
const MAX_CONCURRENT = 4;

async function processPlaylist(jobId, extension) {
  const job = playlistJobs[jobId];
  const queue = [...job.videos];
  const active = [];

  async function worker(video) {
    return new Promise(resolve => {
      video.status = "downloading";

      const ext = extension === "audio" ? "mp3" : "mp4";
      const filename = safeTitle(video.title) + "." + ext;
      const filepath = path.join(DOWNLOAD_DIR, filename);

      const args = [];

      if (extension === "audio") {
        args.push(
          "-f", "bestaudio",
          "--extract-audio",
          "--audio-format", "mp3",
          "--ffmpeg-location", ffmpegPath
        );
      } else {
        args.push(
          "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]",
          "--merge-output-format", "mp4",
          "--ffmpeg-location", ffmpegPath
        );
      }

      args.push("--js-runtimes", "node", "-o", filepath, video.url);

      const p = spawn(YTDLP_PATH, args);

      p.stderr.on("data", d => {
        console.log("YT-DLP:", d.toString());
      });

      p.on("close", async () => {
        let attempts = 0;

        while (!fs.existsSync(filepath) && attempts < 10) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }

        if (fs.existsSync(filepath)) {
          video.status = "done";
          video.file = filename;
        } else {
          console.error("❌ Archivo no generado:", filepath);
          video.status = "error";
        }

        resolve();
      });

      p.on("error", () => {
        video.status = "error";
        resolve();
      });
    });
  }

  while (queue.length || active.length) {
    while (active.length < MAX_CONCURRENT && queue.length) {
      const v = queue.shift();
      const jobPromise = worker(v);
      active.push(jobPromise);
      jobPromise.finally(() => {
        active.splice(active.indexOf(jobPromise), 1);
      });
    }
    await Promise.race(active);
  }
}

// ===============================================================
// EXPRESS APP
// ===============================================================
const app = express();

app.get("/api/info", async (req, res) => {
  await ensureYTDLP();

  const info = await analyzeWithYTDLP(req.query.url);

  if (info._type === "playlist") {
    return res.json({
      type: "playlist",
      title: info.title,
      videos: info.entries.map(v => ({
        url: normalizeVideoUrl(v),
        title: v.title
      }))
    });
  }

  res.json({
    type: "video",
    title: info.title,
    thumbnail: info.thumbnail,
    url: info.webpage_url
  });
});

// SINGLE
app.get("/api/download", async (req, res) => {
  await ensureYTDLP();
  streamFromYTDLP(req.query.url, req.query.extension, res, req.query.title);
});

// START PLAYLIST
app.get("/api/playlist/start", async (req, res) => {
  const jobId = Date.now().toString();
  const videos = JSON.parse(req.query.videos);

  playlistJobs[jobId] = {
    videos: videos.map(v => ({
      ...v,
      status: "pending",
      file: null
    }))
  };

  processPlaylist(jobId, req.query.extension);

  res.json({ jobId });
});

// STATUS
app.get("/api/playlist/status", (req, res) => {
  res.json(playlistJobs[req.query.jobId]);
});

// FILE DOWNLOAD
app.get("/api/file", (req, res) => {
  const filepath = path.join(DOWNLOAD_DIR, req.query.file);

  if (!fs.existsSync(filepath)) {
    console.error("❌ Intento de descarga de archivo inexistente:", filepath);
    return res.status(404).send("Archivo no disponible aún");
  }

  res.download(filepath);
});

// ===============================================================
// VITE / STATIC
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