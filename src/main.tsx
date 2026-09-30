import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// KaTeX 样式随应用一起打包（体积 20 多 KB），保证公式预览开箱可用；
// 字体仍走 CDN，并由 Service Worker 缓存以便离线。
import 'katex/dist/katex.min.css'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 不存在')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
