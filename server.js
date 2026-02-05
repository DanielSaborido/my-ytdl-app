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
//  YT-DLP SETUP
// ===============================================================
async function ensureYTDLP() {
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  if (fs.existsSync(YTDLP_PATH)) {
    try {
      await new Promise(resolve => {
        const p = spawn(YTDLP_PATH, ["-U"]);
        p.on("close", resolve);
        p.on("error", resolve);
      });
      return YTDLP_PATH;
    } catch {}
  }

  const downloadURL =
    process.platform === "win32"
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

  return new Promise((resolve, reject) => {
    https.get(downloadURL, resp => {
      if (resp.statusCode >= 400) {
        return reject(new Error("No se pudo descargar yt-dlp"));
      }
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
// ANALYSIS WITH YT-DLP (PLAYLIST SAFE)
// ===============================================================
function normalizeVideoUrl(v) {
  if (v.webpage_url) return v.webpage_url;
  if (!v.url) return null;
  if (v.url.startsWith("http")) return v.url;
  return `https://www.youtube.com/watch?v=${v.url}`;
}

function analyzeWithYTDLP(targetUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      "-J",
      "--flat-playlist",
      "--skip-download",
      "--no-warnings",
      "--no-call-home",
      targetUrl
    ];

    const ytdlp = spawn(YTDLP_PATH, args);
    let out = "";
    let err = "";
    ytdlp.stdout.on("data", d => out += d.toString());
    ytdlp.stderr.on("data", d => err += d.toString());
    ytdlp.on("close", code => {
      if (code !== 0) {
        return reject(new Error(err || "yt-dlp analysis failed"));
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ===============================================================
// STREAM DOWNLOAD
// ===============================================================
function streamFromYTDLP(targetUrl, format, res, title) {
  const isAudio = format === "audio";
  const ext = isAudio ? "mp3" : "mp4";
  const filename = `${safeTitle(title)}.${ext}`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");

  const args = [];

  if (isAudio) {
    args.push(
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "--remux-video", "m4a"
    );
  } else {
    args.push(
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]",
      "--merge-output-format", "mp4"
    );
  }

  args.push(
    "-o", "-",
    "--no-mtime",
    "--quiet",
    "--ffmpeg-location", ffmpegPath,
    "--js-runtimes", "node",
    targetUrl
  );

  const ytdlp = spawn(YTDLP_PATH, args);

  ytdlp.stderr.on("data", d => {
    const msg = d.toString();
    if (msg.includes("ERROR")) {
      console.error(msg);
      try { res.end(); } catch {}
    }
  });

  ytdlp.stdout.pipe(res);

  ytdlp.on("close", () => {
    try { res.end(); } catch {}
  });
}


// ===============================================================
// EXPRESS APP
// ===============================================================
const app = express();

app.get("/api/info", async (req, res) => {
  try {
    const { url: targetUrl } = req.query;
    if (!targetUrl) return res.status(400).send("Falta URL");

    await ensureYTDLP();
    const info = await analyzeWithYTDLP(targetUrl);

    if (info._type === "playlist") {
      return res.json({
        type: "playlist",
        title: info.title || "Playlist",
        url: targetUrl,
        videos: (info.entries || []).map(v => ({
          url: normalizeVideoUrl(v),
          title: v.title || "Sin título",
          duration: v.duration_string || ""
        }))
      });
    }

    return res.json({
      type: "video",
      title: info.title,
      thumbnail: info.thumbnail,
      url: info.webpage_url
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error en análisis");
  }
});

app.get("/api/download", async (req, res) => {
  try {
    const { url: targetUrl, extension, title } = req.query;
    if (!targetUrl) return res.status(400).send("Falta URL");

    await ensureYTDLP();
    const fmt = extension === "audio" ? "audio" : "video";
    streamFromYTDLP(targetUrl, fmt, res, title || "file");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error en descarga");
  }
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