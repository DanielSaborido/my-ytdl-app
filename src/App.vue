<script setup>
import { url, info, pasteFromClipboard, clear, analyze, download } from "./App.js"
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
    <div v-if="info && info.type === 'playlist'" class="playlist">
      <h2>📂 {{ info.title }}</h2>
      <div class="buttons">
        <button @click="download('video', info)">Descargar Playlist como Video</button>
        <button @click="download('audio', info)">Descargar Playlist como Audio</button>
      </div>
      <div class="playlist-scroll">
        <ul class="playlist-list">
          <li v-for="video in info.videos" :key="video.url" class="playlist-item">
            <span class="title">{{ video.title }}</span>
            <button @click="download('video', video)">🎬</button>
            <button @click="download('audio', video)">🎵</button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>