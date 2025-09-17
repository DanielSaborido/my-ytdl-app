import { ref } from "vue"

export const url = ref("")
export const info = ref(null)

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
}

export async function analyze() {
  if (!url.value) {
    alert("Pega un enlace válido de YouTube")
    return
  }
  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url.value)}`)
    if (!res.ok) throw new Error("Error analizando enlace")
    info.value = await res.json()
  } catch (err) {
    console.error(err)
    alert("No se pudo analizar el enlace")
  }
}

function getFilenameFromDisposition(header, fallback = "download.mp4") {
  if (!header) return fallback
  const match = /filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i.exec(header)
  return match ? decodeURIComponent(match[1]) : fallback
}

export async function download(extension, info) {
  if (!url.value) {
    alert("No se encontró el enlace del video o playlist")
    return
  }
  try {
    const apiUrl = info.type === "video"
      ? `/api/download?url=${encodeURIComponent(info.url)}&extension=${extension}&title=${encodeURIComponent(info.title)}`
      : `/api/download-playlist?url=${encodeURIComponent(info.url)}&extension=${extension}&title=${encodeURIComponent(info.title)}`
    const res = await fetch(apiUrl)
    if (!res.ok) throw new Error("Error en la descarga")

    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const contentDisp = res.headers.get("Content-Disposition")
    const filename = getFilenameFromDisposition(contentDisp, `${info.title}.mp4`)

    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    console.error(err)
    alert("No se pudo descargar el archivo")
  }
}