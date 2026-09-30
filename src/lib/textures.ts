// Textures are painted once into canvases and used as plain PNG tiles. SVG noise
// filters looked the same but the browser recomputed them on every zoom frame.

function tile(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return `url("${c.toDataURL('image/png')}")`;
}

function grain(r: number, g: number, b: number, maxAlpha: number) {
  return (ctx: CanvasRenderingContext2D, s: number) => {
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 0.7 + Math.random() * 0.6;
      img.data[i] = r * k;
      img.data[i + 1] = g * k;
      img.data[i + 2] = b * k;
      img.data[i + 3] = Math.random() * maxAlpha;
    }
    ctx.putImageData(img, 0, 0);
  };
}

/** Cork: thousands of little granules in mixed browns, wrapped so the tile is seamless. */
function cork(ctx: CanvasRenderingContext2D, s: number) {
  ctx.fillStyle = '#c38b53';
  ctx.fillRect(0, 0, s, s);
  const shades = ['#a86e3a', '#8f5a2c', '#d5a066', '#b87b44', '#e2b27a', '#9c6533', '#cf975c', '#7a4a22'];
  const granule = (x: number, y: number, rx: number, ry: number, rot: number, color: string, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (const dx of [-s, 0, s])
      for (const dy of [-s, 0, s]) {
        const px = x + dx;
        const py = y + dy;
        if (px < -6 || px > s + 6 || py < -6 || py > s + 6) continue;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
  };
  for (let i = 0; i < 3400; i++) {
    const rx = 0.7 + Math.random() * 2.6;
    granule(Math.random() * s, Math.random() * s, rx, rx * (0.45 + Math.random() * 0.6), Math.random() * Math.PI, shades[(Math.random() * shades.length) | 0], 0.35 + Math.random() * 0.5);
  }
  for (let i = 0; i < 700; i++) granule(Math.random() * s, Math.random() * s, 0.5 + Math.random() * 0.9, 0.5 + Math.random() * 0.7, 0, '#4a2810', 0.35 + Math.random() * 0.4);
  ctx.globalAlpha = 1;
}

export function installTextures() {
  const root = document.documentElement.style;
  root.setProperty('--paper-noise', tile(128, grain(110, 85, 60, 20)));
  root.setProperty('--noise', tile(160, grain(80, 50, 25, 46)));
  root.setProperty('--cork', tile(320, cork));
}
