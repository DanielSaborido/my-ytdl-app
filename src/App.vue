<template>
  <div class="p-6 max-w-md mx-auto space-y-4">
    <h1 class="text-xl font-bold">Descargar de YouTube</h1>
    <input
      v-model="url"
      type="text"
      placeholder="Pega el enlace de YouTube"
      class="w-full border p-2 rounded"
    />
    <div class="flex gap-2">
      <button
        @click="download('video')"
        class="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Descargar Video
      </button>
      <button
        @click="download('audio')"
        class="bg-green-600 text-white px-4 py-2 rounded"
      >
        Descargar Audio
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue"

const url = ref("")

function download(type) {
  if (!url.value) {
    alert("Pega un enlace válido de YouTube")
    return
  }
  window.open(`/api/download?url=${encodeURIComponent(url.value)}&type=${type}`)
}
</script>
