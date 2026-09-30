/// <reference types="vite/client" />
// 注意：不再引用 vite-plugin-pwa/client —— Service Worker 的注册由
// src/lib/use-service-worker.ts 自己实现（见该文件顶部说明），
// 因此也不需要 virtual:pwa-register 的类型。
