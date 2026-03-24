import { ref } from "vue"

export const url = ref("")
export const info = ref(null)
export const loadingButton = ref(null)

// ============================
// ANALYZE
// ============================
export async function analyze() {
  loadingButton.value = "analyze"

  const res = await fetch(`/api/info?url=${encodeURIComponent(url.value)}`)
  info.value = await res.json()

  loadingButton.value = null
}

// ============================
// SINGLE DOWNLOAD
// ============================
async function downloadSingle(extension, video) {
  const link = document.createElement("a")
  link.href = `/api/download?url=${encodeURIComponent(video.url)}&extension=${extension}&title=${encodeURIComponent(video.title)}`
  link.download = ""
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

  while (!finished) {
    const statusRes = await fetch(`/api/playlist/status?jobId=${jobId}`)
    const data = await statusRes.json()

    finished = true

    for (const video of data.videos) {
      if (video.status === "done" && !video.downloaded) {
        video.downloaded = true

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
  if (target.type === "playlist") {
    await downloadPlaylist(extension, target.videos)
    return
  }

  await downloadSingle(extension, target)
}