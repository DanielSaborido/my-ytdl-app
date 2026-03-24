import { ref } from "vue"

export const url = ref("")
export const info = ref(null)
export const currentPage = ref(1)
export const pageSize = 100
export const loadingButton = ref(null)

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
  const link = document.createElement("a")
  link.href = `/api/download?url=${encodeURIComponent(video.url)}&extension=${extension}&title=${encodeURIComponent(video.title)}`
  link.click()
}

// ============================
// PLAYLIST DOWNLOAD 🔥
// ============================
async function downloadPlaylist(extension, videos) {
  const res = await fetch("/api/playlist/start?videos=" +
    encodeURIComponent(JSON.stringify(videos)) +
    "&extension=" + extension
  )

  const { jobId } = await res.json()

  let finished = false

  const downloadedSet = new Set()

  while (!finished) {
    const statusRes = await fetch(`/api/playlist/status?jobId=${jobId}`)
    const data = await statusRes.json()

    finished = true

    for (const video of data.videos) {
      if (video.status === "done" && !downloadedSet.has(video.file)) {
        downloadedSet.add(video.file)

        const link = document.createElement("a")
        link.href = `/api/file?file=${video.file}`
        link.download = video.file
        link.click()
      }

      if (video.status !== "done") {
        finished = false
      }
    }

    await new Promise(r => setTimeout(r, 1000))
  }

  alert("✅ Playlist descargada")
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