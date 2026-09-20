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

let singleDownloadJobs = {};
let playlistJobs = {};

// ===============================================================
// YT-DLP AUTO UPDATE
// ===============================================================
async function updateYTDLP() {
  if (!fs.existsSync(YTDLP_PATH)) return;

  return new Promise(resolve => {
    console.log("Checking for yt-dlp updates...");

    const updater = spawn(YTDLP_PATH, ["-U"], {
      stdio: "inherit"
    });

    updater.on("close", () => resolve());
    updater.on("error", err => {
      console.warn("Could not update yt-dlp:", err.message);
      resolve();
    });
  });
}

// ===============================================================
// YT-DLP SETUP
// ===============================================================
async function ensureYTDLP() {
  if (!fs.existsSync(BIN_DIR))
    fs.mkdirSync(BIN_DIR, { recursive: true });

  if (!fs.existsSync(YTDLP_PATH)) {
    const downloadURL =
      process.platform === "win32"
        ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

    await new Promise((resolve, reject) => {
      https.get(downloadURL, resp => {
        const file = fs.createWriteStream(YTDLP_PATH);

        resp.pipe(file);

        file.on("finish", () => {
          file.close();
          try {
            fs.chmodSync(YTDLP_PATH, 0o755);
          } catch {}

          resolve();
        });

      }).on("error", reject);
    });
  } else {
    await updateYTDLP();
  }

  return YTDLP_PATH;
}

// ===============================================================
// HELPERS
// ===============================================================
function safeTitle(title) {
  return (title || "file")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " ")
    .replace(/[^a-zA-Z0-9\s-_]/g, "")
    .replace(/\s+/g, " ")
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

    const args = [
      "-J",
      "--flat-playlist",
      "--skip-download",

      "--no-warnings",

      "--extractor-args",
      "youtube:player_client=android",

      "--cookies-from-browser",
      "chrome",

      targetUrl
    ];

    const ytdlp = spawn(YTDLP_PATH, args);

    let out = "";
    let err = "";

    ytdlp.stdout.on("data", d => out += d.toString());
    ytdlp.stderr.on("data", d => err += d.toString());

    ytdlp.on("close", () => {

      if (!out.trim()) {
        console.error("YT-DLP ANALYZE ERROR:");
        console.error(err);

        return reject(
          new Error(err || "yt-dlp analyze failed")
        );
      }

      try {
        resolve(JSON.parse(out));
      } catch (e) {
        console.error("JSON PARSE ERROR");
        console.error(out);

        reject(e);
      }

    });

    ytdlp.on("error", reject);

  });
}

// ===============================================================
// STREAM SINGLE DOWNLOAD
// ===============================================================
async function streamFromYTDLP(targetUrl, format, title, jobId) {
  const ext = format === "audio" ? "mp3" : "mp4";

  const filename = `${safeTitle(title)}.${ext}`;

  const filepath = path.join(
    DOWNLOAD_DIR,
    `${Date.now()}-${filename}`
  );

  const args = [];

  if (format === "audio") {
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

  args.push(
    "--newline",
    "--progress",
    "--retries", "3",
    "--fragment-retries", "3",
    "--js-runtimes", "node",
    "-o", filepath,
    targetUrl
  );

  console.log("Starting yt-dlp:", args.join(" "));

  const ytdlp = spawn(YTDLP_PATH, args);

  let stderr = "";

  const updateProgress = output => {
    stderr += output;

    console.log("YT-DLP:", output);

    const match = output.match(
      /\[download\]\s+([\d.]+)%.*?at\s+([^\s]+).*?ETA\s+([^\s]+)/
    );

    if (match) {
      const job = singleDownloadJobs[jobId];

      if (job) {
        job.status = "downloading";
        job.progress = parseFloat(match[1]);
        job.speed = match[2];
        job.eta = match[3];
      }
    }
  };

  ytdlp.stdout.on("data", d => {
    updateProgress(d.toString());
  });

  ytdlp.stderr.on("data", d => {
    updateProgress(d.toString());
  });

  ytdlp.on("error", err => {
    console.error("yt-dlp process error:", err);

    const job = singleDownloadJobs[jobId];

    if (job) {
      job.status = "error";
      job.error = err.message;
    }
  });

  ytdlp.on("close", code => {
    const job = singleDownloadJobs[jobId];

    if (code !== 0 || !fs.existsSync(filepath)) {
      console.error("yt-dlp failed:", stderr);

      if (job) {
        job.status = "error";
        job.error = "yt-dlp failed";
      }

      return;
    }

    console.log("Download completed:", filepath);

    if (job) {
      job.status = "completed";
      job.progress = 100;
      job.speed = null;
      job.eta = null;
      job.file = filename;
      job.filepath = filepath;
    }
  });
}

// ===============================================================
// PLAYLIST PROCESSOR
// ===============================================================
const MAX_CONCURRENT = 5;

async function processPlaylist(jobId, extension) {
  const job = playlistJobs[jobId];
  const queue = [...job.videos];
  const active = [];

  async function worker(video) {
    return new Promise(resolve => {
      video.status = "downloading";
      video.progress = 0;

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

      args.push("--retries", "3", "--fragment-retries", "3","--js-runtimes", "node", "-o", filepath, video.url);

      const p = spawn(YTDLP_PATH, args);

      p.stderr.on("data", d => {
        const out = d.toString();
        console.log("YT-DLP:", out);
        const match = out.match(/(\d{1,3}\.\d)%/);
        if (match) {
          video.progress = parseFloat(match[1]);
        }
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
          video.progress = 100;
        } else {
          console.error("❌ Archivo no generado:", filepath);
          video.status = "error";
          video.progress = 0;
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

// SINGLE DOWNLOADS
app.get("/api/download/start", async (req, res) => {
  try {
    await ensureYTDLP();

    const jobId =
      Date.now().toString() +
      Math.random().toString(36).slice(2);

    singleDownloadJobs[jobId] = {
      status: "starting",
      progress: 0,
      speed: null,
      eta: null,
      error: null,
      file: null,
      filepath: null
    };

    streamFromYTDLP(
      req.query.url,
      req.query.extension,
      req.query.title,
      jobId
    );

    res.json({ jobId });

  } catch (err) {
    console.error("Download start error:", err);

    res.status(500).json({
      error: "Download failed"
    });
  }
});

app.get("/api/download/status", (req, res) => {
  const job = singleDownloadJobs[req.query.jobId];

  if (!job) {
    return res.status(404).json({
      status: "error",
      error: "Job not found"
    });
  }

  res.json(job);
});

app.get("/api/download/file", (req, res) => {
  const job = singleDownloadJobs[req.query.jobId];

  if (!job || job.status !== "completed") {
    return res.status(404).send("File not ready");
  }

  if (!job.filepath || !fs.existsSync(job.filepath)) {
    return res.status(404).send("File not found");
  }

  res.download(job.filepath, job.file, err => {
    fs.unlink(job.filepath, unlinkErr => {
      if (unlinkErr) {
        console.error(
          "Could not delete temporary file:",
          unlinkErr
        );
      }
    });

    delete singleDownloadJobs[req.query.jobId];

    if (err) {
      console.error("Response download error:", err);
    }
  });
});

app.get("/api/download", (req, res) => {
  res.status(400).send("Use /api/download/start");
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

  res.download(filepath, req.query.file, err => {
    if (!err) {
      fs.unlink(filepath, e => {
        if (e) console.error("Error borrando:", filepath);
        else console.log("🧹 Eliminado:", filepath);
      });
    }
  });
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