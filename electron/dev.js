// 开发启动器：先用 Vite Node API 启动开发服务器，再拉起 Electron
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createServer } from 'vite'
import electronPath from 'electron'

async function start() {
  const server = await createServer({ configFile: 'vite.config.js' })
  await server.listen()

  const url = server.resolvedUrls?.local?.[0]
  if (!url) {
    throw new Error('Vite 开发服务器启动失败，未获取到本地地址')
  }
  server.printUrls()

  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  })

  const shutdown = () => {
    server.close().finally(() => process.exit(0))
  }

  child.on('close', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
