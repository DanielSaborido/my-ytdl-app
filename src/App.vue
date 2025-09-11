<template>
  <div class="container">
    <h1>Descargar de YouTube</h1>
    <div class="input-group">
      <input v-model="url" type="text" placeholder="Pega el enlace de YouTube" />
      <button class="paste-btn" @click="pasteFromClipboard" title="Pegar desde portapapeles">📋</button>
    </div>
    <div class="action-buttons">
      <button @click="analyze">Analizar</button>
      <button @click="clear">Borrar</button>
    </div>
    <div v-if="info && info.type === 'video'" class="info">
      <img :src="info.thumbnail" alt="Miniatura" />
      <h2>{{ info.title }}</h2>
      <div class="buttons">
        <!-- futura adicion <button @click="download('video', info)">Descargar Video</button> -->
        <button @click="download('audio', info)">Descargar Audio</button>
      </div>
    </div>
    <div v-if="info && info.type === 'playlist'" class="playlist">
      <h2>📂 {{ info.title }}</h2>
      <button class="download-all" @click="downloadPlaylist('audio', info)">⬇ Descargar todo en audio (ZIP)</button>
      <!-- futura adicion <button @click="download('video', info)">⬇ Descargar todo en video (ZIP)</button> -->
      <div class="playlist-scroll">
        <ul class="playlist-list">
          <li v-for="video in info.videos" :key="video.url" class="playlist-item">
            <span class="title">{{ video.title }}</span>
            <!-- futura adicion <button @click="download('video', video)">Descargar Video</button> -->
            <button @click="download('audio', video)">Audio</button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    min-height: 100vh;
    gap: 1rem;
    padding: 1.5rem;
    box-sizing: border-box;
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
  }

  h1 {
    font-size: 2rem;
    font-weight: bold;
    text-align: center;
  }

  .input-group {
    display: flex;
    align-items: center;
    width: 100%;
    max-width: 500px;
    border: 1px solid #ccc;
    border-radius: 6px;
    overflow: hidden;
  }

  .input-group input {
    flex: 1;
    padding: 0.75rem;
    border: none;
    outline: none;
    font-size: 1rem;
  }

  .paste-btn {
    background: #e5e7eb;
    border: none;
    padding: 0.75rem 1rem;
    cursor: pointer;
    font-size: 1.2rem;
    flex-shrink: 0;
  }
  .paste-btn:hover {
    background: #d1d5db;
  }

  .action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    width: 100%;
    max-width: 500px;
  }
  .action-buttons button {
    flex: 1 1 120px;
    min-width: 100px;
    text-align: center;
  }
  .action-buttons button:nth-of-type(1) { background-color: #f59e0b; }
  .action-buttons button:nth-of-type(2) { background-color: #ef4444; }

  button {
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 1rem;
  }

  .info {
    border: 1px solid #ccc;
    padding: 1rem;
    border-radius: 6px;
    text-align: center;
    width: 100%;
    max-width: 700px;
    box-sizing: border-box;
  }
  .info img {
    width: 100%;
    height: auto;
    border-radius: 6px;
    max-height: 300px;
    object-fit: cover;
  }

  .playlist {
    border: 1px solid #ccc;
    padding: 1rem;
    border-radius: 6px;
    width: 100%;
    max-width: 700px;
    box-sizing: border-box;
    text-align: left;
  }
  .playlist h2 {
    margin-bottom: 1rem;
  }
  .download-all {
    background-color: #10b981;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 1rem;
  }
  .download-all:hover {
    background-color: #059669;
  }
  .playlist-scroll {
    max-height: 400px;
    overflow-y: auto;
    border-top: 1px solid #eee;
    border-bottom: 1px solid #eee;
  }
  .playlist-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .playlist-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #eee;
    font-size: 0.95rem;
  }
  .playlist-item:last-child {
    border-bottom: none;
  }
  .playlist-item .title {
    flex: 1;
    margin-right: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .playlist-item button {
    background-color: #2563eb;
    border: none;
    border-radius: 4px;
    padding: 0.4rem 0.75rem;
    color: white;
    font-size: 0.85rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .playlist-item button:hover {
    background-color: #1e40af;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .buttons button {
    flex: 1 1 120px;
  }
  .buttons button:nth-of-type(1) { background-color: #2563eb; }
  .buttons button:nth-of-type(2) { background-color: #16a34a; }

  @media (min-width: 600px) {
    .playlist-list {
      grid-template-columns: 1fr 1fr;
    }
    .playlist-item {
      flex-direction: row;
      align-items: center;
    }
  }
</style>

<script setup>
  import { ref } from "vue"

  const url = ref("")
  const info = ref(null)

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      url.value = text
    } catch (err) {
      alert("No se pudo acceder al portapapeles")
    }
  }

  function clear() {
    url.value = ""
    info.value = null
  }

  async function analyze() {
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

  function download(type, video) {
    if (!video?.url) {
      alert("No se encontró el enlace del video")
      return
    }
    window.open(
      `/api/download?url=${encodeURIComponent(video.url)}&type=${type}&title=${encodeURIComponent(video.title)}`
    )
  }

  function downloadPlaylist(type, info) {
    window.open(
      `/api/download-playlist?url=${encodeURIComponent(url.value)}&type=${type}&title=${encodeURIComponent(info.title)}`
    );
  }
</script>
