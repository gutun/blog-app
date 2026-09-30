/**
 * 图片处理：手机上拍的照片动辄 3–8MB，直接 base64 提交既慢又占仓库，
 * 所以统一压缩到长边 ≤ 1600px、JPEG 质量 0.82 后再上传。
 */

export interface PreparedImage {
  /** 不带扩展名的文件名，例如 diary20260927-1 */
  baseName: string
  bytes: ArrayBuffer
  mime: string
  extension: string
  /** 压缩后的字节数 */
  size: number
  width: number
  height: number
}

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82
/** 超过这个大小就继续降质量，避免正文里塞进过大的图 */
const TARGET_BYTES = 1_200_000

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return map[mime] ?? 'jpg'
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败，换一张试试'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
      mime,
      quality,
    )
  })
}

export function timestampName(date = new Date(), suffix = ''): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return suffix ? `${stamp}-${suffix}` : stamp
}

/**
 * 压缩图片。
 * GIF 与 SVG 保持原样（动图/矢量图重编码会损失内容），其它格式统一转 JPEG。
 */
export async function prepareImage(file: File, nameHint?: string): Promise<PreparedImage> {
  const passThrough =
    file.type === 'image/gif' || file.type === 'image/svg+xml' || file.type === 'image/webp'
  const baseName = sanitizeBaseName(nameHint ?? timestampName())

  if (passThrough) {
    const bytes = await file.arrayBuffer()
    return {
      baseName,
      bytes,
      mime: file.type,
      extension: extensionFor(file.type),
      size: file.size,
      width: 0,
      height: 0,
    }
  }

  const img = await loadImage(file)
  let { width, height } = img
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas，无法压缩图片')
  // JPEG 无透明通道，先铺白底，避免 PNG 透明区域变黑
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  let quality = JPEG_QUALITY
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  while (blob.size > TARGET_BYTES && quality > 0.5) {
    quality -= 0.1
    blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  }

  return {
    baseName,
    bytes: await blob.arrayBuffer(),
    mime: 'image/jpeg',
    extension: 'jpg',
    size: blob.size,
    width,
    height,
  }
}

export function sanitizeBaseName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u3400-\u9fff.-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned || timestampName()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
