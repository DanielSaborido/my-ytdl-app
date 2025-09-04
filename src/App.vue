<template>
  <div class="p-6 max-w-md mx-auto space-y-4">
    <h1 class="text-xl font-bold">Descargar de YouTube</h1>
    <input
      v-model="url"
      type="text"
      placeholder="Pega el enlace de YouTube"
      class="w-full border p-2 rounded"
    />
    <button
      @click="analyze"
      class="bg-yellow-600 text-white px-4 py-2 rounded w-full"
    >
      Analizar
    </button>
    <div v-if="info" class="space-y-3 border rounded p-3 shadow">
      <img :src="info.thumbnail" alt="Miniatura" class="rounded w-full" />
      <h2 class="font-semibold text-lg">{{ info.title }}</h2>

      <div class="flex gap-2">
        <button
          @click="download('video')"
          class="bg-blue-600 text-white px-4 py-2 rounded flex-1"
        >
          Descargar Video
        </button>
        <button
          @click="download('audio')"
          class="bg-green-600 text-white px-4 py-2 rounded flex-1"
        >
          Descargar Audio
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue"

const url = ref("")
const info = ref(null)

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
