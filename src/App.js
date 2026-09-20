import { ref } from "vue"
import { computed } from "vue";

export const url = ref("")
export const info = ref(null)
export const currentPage = ref(1)
export const pageSize = 100
export const loadingButton = ref(null)

// ============================
// LANGUAGE
// ============================
const lang = navigator.language.toLowerCase().startsWith("es") ? "es" : "en";

const translations = {
  en: {
    title: "YouTube Downloader",
    placeholder: "Paste here the YouTube URL",
    paste: "Paste from Clipboard",
    analyze: "Analyze",
    clear: "Clear",
    downloadVideo: "Download Video",
    downloadAudio: "Download Audio",
    playlist: "Playlist",
    downloadPlaylistVideo: "⬇️ Download Playlist Video",
    downloadPlaylistAudio: "⬇️ Download Playlist Audio",
    previous: "◀ Previous",
    next: "Next ▶",
  },

  es: {
    title: "Descargador de YouTube",
    placeholder: "Pega aquí la URL de YouTube",
    paste: "Pegar del Portapapeles",
    analyze: "Analizar",
    clear: "Limpiar",
    downloadVideo: "Descargar vídeo",
    downloadAudio: "Descargar audio",
    playlist: "Lista de reproducción",
    downloadPlaylistVideo: "⬇️ Descargar lista (vídeo)",
    downloadPlaylistAudio: "⬇️ Descargar lista (audio)",
    previous: "◀ Anterior",
    next: "Siguiente ▶",
  }
};

export const t = computed(() => translations[lang]);

// ============================
// CLIPBOARD
// ============================
export async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    url.value = text
  } catch {
    alert("No se pudo acceder al portapapeles")
  }
}

// ============================
// CLEAR
// ============================
export function clear() {
  url.value = ""
  info.value = null
  currentPage.value = 1
}

// ============================
// ANALYZE
// ============================
export async function analyze() {
  if (!url.value.trim()) {
    alert("Pega un enlace válido")
    return
  }

  loadingButton.value = "analyze"

  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url.value)}`)
    info.value = await res.json()
  } catch {
    alert("Error analizando")
  } finally {
    loadingButton.value = null
  }
}

// ============================
// PAGINATION
// ============================
export function paginatedVideos() {
  if (!info.value?.videos) return []
  const start = (currentPage.value - 1) * pageSize
  return info.value.videos.slice(start, start + pageSize)
}

export function totalPages() {
  if (!info.value?.videos) return 0
  return Math.ceil(info.value.videos.length / pageSize)
}

// ============================
// SINGLE DOWNLOAD
// ============================
async function downloadSingle(extension, video) {
  const key = `${extension}-${video.url}`;

  loadingButton.value = key;

  // Create temporary progress information on the video
  video.status = "starting";
  video.progress = 0;
  video.speed = null;
  video.eta = null;

  try {
    const startRes = await fetch(
      `/api/download/start?url=${encodeURIComponent(video.url)}` +
      `&extension=${extension}` +
      `&title=${encodeURIComponent(video.title)}`
    );

    if (!startRes.ok) {
      throw new Error("Could not start download");
    }

    const { jobId } = await startRes.json();

    let finished = false;

    while (!finished) {
      const statusRes = await fetch(
        `/api/download/status?jobId=${jobId}`
      );

      const data = await statusRes.json();

      video.status = data.status;
      video.progress = data.progress || 0;
      video.speed = data.speed;
      video.eta = data.eta;

      if (data.status === "completed") {
        finished = true;

        const link = document.createElement("a");

        link.href =
          `/api/download/file?jobId=${encodeURIComponent(jobId)}`;

        link.download = data.file;

        link.click();

      } else if (data.status === "error") {
        throw new Error(data.error || "Download failed");
      }

      if (!finished) {
        await new Promise(resolve =>
          setTimeout(resolve, 500)
        );
      }
    }

  } catch (err) {
    console.error("Single download error:", err);

    video.status = "error";

    alert(
      `Download failed:\n\n${err.message}`
    );

  } finally {
    loadingButton.value = null;
  }
}

// ============================
// PLAYLIST DOWNLOAD 🔥
// ============================
async function downloadPlaylist(extension, videos) {
  const res = await fetch(
    "/api/playlist/start?videos=" +
      encodeURIComponent(JSON.stringify(videos)) +
      "&extension=" +
      extension
  );
  const { jobId } = await res.json();

  const downloadedSet = new Set();
  let finished = false;

  while (!finished) {
    const statusRes = await fetch(`/api/playlist/status?jobId=${jobId}`);
    const data = await statusRes.json();

    data.videos.forEach((serverVideo, i) => {
      const localVideo = info.value.videos.find(v => v.url === serverVideo.url);
      if (localVideo) {
        localVideo.status = serverVideo.status;
        localVideo.progress = serverVideo.progress || 0;
        localVideo.file = serverVideo.file;
      }
    });

    data.videos.forEach(video => {
      if (video.status === "done" && !downloadedSet.has(video.file)) {
        downloadedSet.add(video.file);

        const link = document.createElement("a");
        link.href = `/api/file?file=${video.file}`;
        link.download = video.file;
        link.click();
      }
    });

    finished = data.videos.every(v => v.status === "done" || v.status === "error");

    await new Promise(r => setTimeout(r, 500));
  }

  const failedVideos = data.videos.filter(
    video => video.status === "error"
  );

  if (failedVideos.length > 0) {
    const failedList = failedVideos
      .map((video, index) => `${index + 1}. ${video.title}`)
      .join("\n");

    alert(
      `⚠️ Algunos videos no se pudieron descargar:\n\n` +
      `${failedList}\n\n` +
      `Por favor, intenta descargarlos individualmente.`
    );
  } else {
    alert("✅ Playlist descargada.");
  }
}

// ============================
// MAIN DOWNLOAD
// ============================
export async function download(extension, target) {
  if (!target) return

  if (target.type === "playlist") {
    await downloadPlaylist(extension, target.videos)
    return
  }

  await downloadSingle(extension, target)
}