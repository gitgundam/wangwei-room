import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace } from 'three'

/** Original pixel art, calculated entirely from shapes; no image inputs or URLs. */
export function createArtwork(kind: 'desktop' | 'frame') {
  const width = kind === 'desktop' ? 512 : 256
  const height = kind === 'desktop' ? 288 : 320
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height
      let rgb: number[]
      if (kind === 'frame') {
        rgb = [237, 228, 207]
        if (Math.hypot((u - 0.66) * 0.8, v - 0.70) < 0.13) rgb = [204, 166, 94]
        if (v < 0.38 + 0.09 * Math.sin(u * 5 + 1)) rgb = [151, 172, 145]
        if (v < 0.22 + 0.08 * Math.cos(u * 6 + 1)) rgb = [65, 104, 84]
      } else {
        rgb = [25 + 12 * v, 57 + 23 * u, 59 + 18 * v]
        if (Math.hypot((u - 0.82) * 1.77, v - 0.33) < 0.33) rgb = [56, 98, 88]
        if (u > 0.16 && u < 0.85 && v > 0.24 && v < 0.84) {
          rgb = [227, 231, 218]
          if (v > 0.76) rgb = [195, 207, 192]
          else if (u < 0.32) rgb = [208, 218, 199]
          else if (v > 0.31 && v < 0.69 && Math.floor(v * 42) % 3 === 0 && u < 0.68 + 0.10 * Math.sin(Math.floor(v * 42))) rgb = [77, 116, 93]
        }
        for (const [cx, r, g, b] of [[0.20, 193, 121, 108], [0.225, 214, 184, 107], [0.25, 125, 159, 116]]) {
          if (Math.hypot((u - cx!) * 1.77, v - 0.80) < 0.014) rgb = [r!, g!, b!]
        }
        if (v > 0.085 && v < 0.155 && u > 0.28 && u < 0.73) {
          rgb = [144, 167, 151]
          if (v > 0.10 && v < 0.14 && Math.floor(u * 32) % 2 === 0) rgb = [228, 232, 219]
        }
      }
      const offset = (y * width + x) * 4
      data[offset] = rgb[0]!
      data[offset + 1] = rgb[1]!
      data[offset + 2] = rgb[2]!
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat)
  texture.name = `原创几何图案 · ${kind}`
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
