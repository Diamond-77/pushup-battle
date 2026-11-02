import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // build stamp shown on the Edit profile page, so you can tell which version a phone is running
  define: { __BUILD__: JSON.stringify((((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VERCEL_GIT_COMMIT_SHA) ?? "local").slice(0, 7)) },
})
