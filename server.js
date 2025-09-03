import express from "express"
import { spawn } from "child_process"
import { createServer as createViteServer } from "vite"

async function start() {
  const app = express()

  // API para descarga de YouTube
  app.get("/api/download", (req, res) => {
    const { url, type } = req.query
    if (!url) return res.status(400).send("Falta la URL")

    const format = type === "audio" ? "bestaudio" : "bestvideo+bestaudio"
    const ext = type === "audio" ? "mp3" : "mp4"

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"video.${ext}\"`
    )

    const child = spawn("yt-dlp", ["-f", format, "-o", "-", url])

    child.stdout.pipe(res)

    child.stderr.on("data", (data) => {
      console.error("yt-dlp error:", data.toString())
    })

    child.on("close", (code) => {
      if (code !== 0) console.error(`yt-dlp salió con código ${code}`)
    })
  })

  // Crear servidor Vite en modo middleware
  const vite = await createViteServer({
    server: { middlewareMode: true }
  })

  app.use(vite.middlewares)

  const PORT = 5173
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
  })
}

start()
