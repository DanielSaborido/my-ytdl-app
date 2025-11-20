<script setup>
import { url, info, currentPage, pasteFromClipboard, clear, analyze, paginatedVideos, totalPages, download } from "./App.js"
</script>

<style src="./App.css"></style>

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
        <button @click="download('video', info)">Descargar como Video</button>
        <button @click="download('audio', info)">Descargar como Audio</button>
      </div>
    </div>
    <div v-if="info && info.type === 'playlist'" class="playlist-box">
      <h2>Playlist: {{ info.title }}</h2>
      <div class="buttons">
        <button @click="download('video', info)">⬇️ Descargar Playlist Video</button>
        <button @click="download('audio', info)">⬇️ Descargar Playlist Audio</button>
      </div>
      <div class="playlist-scroll">
        <ul class="playlist-list">
          <li v-for="video in paginatedVideos()" :key="video.url" class="playlist-item" >
            <span class="title">{{ video.title }}</span>
            <div class="buttons">
              <button @click="download('video', video)">🎬</button>
              <button @click="download('audio', video)">🎵</button>
            </div>
          </li>
        </ul>
      </div>
      <div class="pagination">
        <button @click="currentPage--" :disabled="currentPage <= 1">◀ Anterior</button>
        <button v-for="page in totalPages()" :key="page" @click="currentPage = page" :class="{ active: currentPage === page }">{{ page }}</button>
        <button @click="currentPage++" :disabled="currentPage >= totalPages()">Siguiente ▶</button>
      </div>
    </div>
  </div>
</template>