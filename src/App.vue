<script setup>
import { url, info, pasteFromClipboard, clear, analyze, download, downloadPlaylist } from "./App.js"
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