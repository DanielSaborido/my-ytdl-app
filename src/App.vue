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
    <div v-if="info" class="info">
      <img :src="info.thumbnail" alt="Miniatura" />
      <h2>{{ info.title }}</h2>
      <div class="buttons">
        <!-- futura adicion <button @click="download('video')">Descargar Video</button> -->
        <button @click="download('audio')">Descargar Audio</button>
      </div>
    </div>
  </div>
</template>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 1rem;
    padding: 1.5rem;
    box-sizing: border-box;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: bold;
    text-align: center;
  }

  .input-group {
    display: flex;
    align-items: center;
    width: 300px;
    border: 1px solid #ccc;
    border-radius: 6px;
    overflow: hidden;
  }

  .input-group input {
    flex: 1;
    padding: 0.5rem;
    border: none;
    outline: none;
  }

  .paste-btn {
    background: #e5e7eb;
    border: none;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    font-size: 1.2rem;
  }
  .paste-btn:hover {
    background: #d1d5db;
  }

  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
  }
  .action-buttons button:nth-of-type(1) { background-color: #f59e0b; }
  .action-buttons button:nth-of-type(2) { background-color: #ef4444; }
  .buttons button:nth-of-type(1) { background-color: #2563eb; }
  .buttons button:nth-of-type(2) { background-color: #16a34a; }

  .info {
    border: 1px solid #ccc;
    padding: 1rem;
    border-radius: 6px;
    text-align: center;
    max-width: 350px;
  }

  .info img {
    width: 100%;
    border-radius: 6px;
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .buttons button {
    flex: 1;
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
    } catch (err) {
      console.error(err)
      alert("No se pudo analizar el enlace")
    }
  }

  function download(type) {
    if (!url.value) {
      alert("Pega un enlace válido de YouTube")
      return
    }
    window.open(`/api/download?url=${encodeURIComponent(url.value)}&type=${type}&title=${encodeURIComponent(info.value.title)}`)
  }
</script>
