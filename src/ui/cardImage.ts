/**
 * cardImage.ts — render the card to a PNG, locally, via canvas.
 * Nothing leaves the device: the blob downloads straight to disk.
 *
 * The card follows the live --font-family and card color tokens, so
 * swapping the typeface changes the printed object too.
 */

type CardData = {
  sentence: string;
  code: string;
  durationLine: string;
  dateLine: string;
  word?: string;
};

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderCardPng(data: CardData): Promise<Blob> {
  const scale = 2;
  const w = 1000;
  const h = 700;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no canvas context'));
  ctx.scale(scale, scale);

  const family = token('--font-family', 'Georgia, serif');
  const paper = token('--card-paper', '#efede6');
  const ink = token('--card-ink', '#1c1c1e');
  const dim = token('--card-dim', '#6b6a64');

  // paper
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.fillStyle = ink;

  // wordmark
  ctx.font = `15px ${family}`;
  ctx.fillStyle = dim;
  drawTracked(ctx, 'soundings', w / 2, 90, 4);

  // the sentence
  ctx.fillStyle = ink;
  ctx.font = `30px ${family}`;
  const lines = wrapLines(ctx, data.sentence, w - 240);
  const lineH = 46;
  let y = h / 2 - ((lines.length - 1) * lineH) / 2 - 60;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }

  // rule
  y += 14;
  ctx.fillStyle = 'rgba(28,28,30,0.25)';
  ctx.fillRect(w / 2 - 35, y, 70, 1);
  y += 56;

  // the score code — the thing that travels
  ctx.fillStyle = ink;
  ctx.font = `26px ${family}`;
  drawTracked(ctx, data.code, w / 2, y, 5);
  y += 44;

  // meta
  ctx.fillStyle = dim;
  ctx.font = `16px ${family}`;
  ctx.fillText(data.durationLine, w / 2, y);
  y += 28;
  ctx.fillText(data.dateLine, w / 2, y);

  if (data.word) {
    y += 40;
    ctx.font = `italic 18px ${family}`;
    ctx.fillStyle = ink;
    ctx.fillText(data.word, w / 2, y);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
}

/** Letter-spaced centered text (canvas has no letter-spacing). */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  tracking: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + tracking;
  });
  ctx.textAlign = prevAlign;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
