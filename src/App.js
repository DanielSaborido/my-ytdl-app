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
    console.log(info.value)
  } catch (err) {
    console.error(err)
    alert("No se pudo analizar el enlace")
  }
}

export function download(type, video) {
  if (!video?.url) {
    alert("No se encontró el enlace del video")
    return
  }
  window.open(
    `/api/download?url=${encodeURIComponent(video.url)}&type=${type}&title=${encodeURIComponent(video.title)}`
  )
}

export function downloadPlaylist(type, info) {
  window.open(
    `/api/download-playlist?url=${encodeURIComponent(url.value)}&type=${type}&title=${encodeURIComponent(info.title)}`
  )
}