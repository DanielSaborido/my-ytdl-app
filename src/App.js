import { ref } from "vue"

export const url = ref("")
export const info = ref(null)
export const currentPage = ref(1);
export const pageSize = 100;
export const loadingButton = ref(null)

export async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    url.value = text
  } catch (err) {
    alert("No se pudo acceder al portapapeles")
  }
}

export function clear() {
  url.value = ""
  info.value = null
  currentPage.value = 1
}

/*****************************************
 * 📌 ANALIZAR (INFO DE VIDEO O PLAYLIST)
 *****************************************/
export async function analyze() {
  if (!url.value.trim()) {
    alert("Pega un enlace válido de YouTube")
    return
  }
  loadingButton.value = "analyze"
  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url.value)}`)
    if (!res.ok) throw new Error("Error analizando enlace")
    info.value = await res.json()
  } catch (err) {
    alert("No se pudo analizar el enlace")
  } finally {
    loadingButton.value = null
  }
}

export function paginatedVideos() {
  if (!info.value || !Array.isArray(info.value.videos)) return [];
  const start = (currentPage.value - 1) * pageSize;
  const end = start + pageSize;
  return info.value.videos.slice(start, end);
}

export function totalPages() {
  if (!info.value || !Array.isArray(info.value.videos)) return 0;
  return Math.ceil(info.value.videos.length / pageSize);
}

/*****************************************
 * 📌 EXTRAER NOMBRE DESDE CONTENT-DISPOSITION
 *****************************************/
function getFilenameFromDisposition(header, fallback) {
  if (!header) return fallback
  const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i.exec(header)
  return m ? decodeURIComponent(m[1]) : fallback
}

/*****************************************
 * 📌 DESCARGA INDIVIDUAL
 *****************************************/
async function downloadSingle(extension, video) {
  const apiUrl = `/api/download?url=${encodeURIComponent(video.url)}&extension=${extension}&title=${encodeURIComponent(video.title)}`

  console.log("⬇️ Descargando:", video.title)

  const res = await fetch(apiUrl)
  if (!res.ok) throw new Error(`Error descargando ${video.title}`)

  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)

  const contentDisp = res.headers.get("Content-Disposition")
  const ext = extension === "audio" ? "m4a" : "mp4"
  const filename = getFilenameFromDisposition(contentDisp, `${video.title}.${ext}`)

  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

/*****************************************
 * 📌 DESCARGA GENERAL
 *****************************************/
export async function download(extension, target) {
  if (!target) return

  const id = `${extension}-${target.url}`
  loadingButton.value = id

  try {
    if (target.type === "playlist" && Array.isArray(target.videos)) {
      for (const video of target.videos) {
        loadingButton.value = `${extension}-${video.url}`
        await downloadSingle(extension, video)
        await new Promise(r => setTimeout(r, 1500))
      }
      alert("✅ Descarga de playlist completada")
      return
    }
    await downloadSingle(extension, target)

  } catch (err) {
    console.error(err)
    alert("❌ No se pudo descargar este video")
  } finally {
    loadingButton.value = null
  }
}