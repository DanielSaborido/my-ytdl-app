<script setup>
import { url, info, loadingButton, currentPage, pasteFromClipboard, clear, analyze, paginatedVideos, totalPages, download, t } from "./App.js"
</script>

<style src="./App.css"></style>

<template>
  <div class="container">
    <h1>{{ t.title }}</h1>
    <div class="input-group">
      <input v-model="url" type="text" :placeholder="t.placeholder" />
      <button class="paste-btn" @click="pasteFromClipboard" :title="t.paste">📋</button>
    </div>
    <div class="action-buttons">
      <button 
        @click="analyze"
        :disabled="loadingButton === 'analyze'"
      >
        <span v-if="loadingButton !== 'analyze'">{{ t.analyze }}</span>
        <span v-else class="loader"></span>
      </button>
      <button @click="clear">{{ t.clear }}</button>
    </div>
    <div v-if="info && info.type === 'video'" class="info">
      <img :src="info.thumbnail" alt="Miniatura" />
      <h2>{{ info.title }}</h2>
      <div class="buttons">
        <button 
          @click="download('video', info)" 
          :disabled="loadingButton === `video-${info.url}`"
        >
          <span v-if="loadingButton !== `video-${info.url}`">{{ t.downloadVideo }}</span>
          <span v-else class="loader"></span>
        </button>
        <button 
          @click="download('audio', info)" 
          :disabled="loadingButton === `audio-${info.url}`"
        >
          <span v-if="loadingButton !== `audio-${info.url}`">{{ t.downloadAudio }}</span>
          <span v-else class="loader"></span>
        </button>
      </div>
    </div>
    <div v-if="info && info.type === 'playlist'" class="playlist-box">
      <h2>{{ t.playlist }}: {{ info.title }}</h2>
      <div class="buttons">
        <button @click="download('video', info)">{{ t.downloadPlaylistVideo }}</button>
        <button @click="download('audio', info)">{{ t.downloadPlaylistAudio }}</button>
      </div>
      <div class="playlist-scroll">
        <ul class="playlist-list">
          <li v-for="video in paginatedVideos()" :key="video.url" class="playlist-item">
            <div class="title-progress">
              <span class="title">{{ video.title }}</span>
              <div class="progress-bar" v-if="video.status === 'downloading'">
                <div 
                  class="progress-fill" 
                  :style="{ width: (video.progress || 0) + '%' }"
                ></div>
              </div>
            </div>
            <div class="buttons">
              <button 
                @click="download('video', video)" 
                :disabled="loadingButton === `video-${video.url}`"
              >
                <span v-if="loadingButton !== `video-${video.url}`">🎬</span>
                <span v-else class="loader"></span>
              </button>
              <button 
                @click="download('audio', video)" 
                :disabled="loadingButton === `audio-${video.url}`"
              >
                <span v-if="loadingButton !== `audio-${video.url}`">🎵</span>
                <span v-else class="loader"></span>
              </button>
            </div>
          </li>
        </ul>
      </div>
      <div class="pagination">
        <button @click="currentPage--" :disabled="currentPage <= 1">{{ t.previous }}</button>
        <button v-for="page in totalPages()" :key="page" @click="currentPage = page" :class="{ active: currentPage === page }">{{ page }}</button>
        <button @click="currentPage++" :disabled="currentPage >= totalPages()">{{ t.next }}</button>
      </div>
    </div>
  </div>
</template>