/** Render the complete page with the same drawing functions used by JPG export. */
export async function createPageThumbnail(snapshot, { loadImage, drawImage, drawText, drawTable }) {
  const height = Math.max(480, ...snapshot.elements.map(element => element.y + element.h));
  const scale = Math.min(240 / 1440, 8192 / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(1440 * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  const images = new Map();
  await Promise.all(snapshot.assets.filter(asset => snapshot.elements.some(element => element.assetId === asset.id)).map(async asset => {
    images.set(asset.id, await loadImage(asset.src));
  }));
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  for (const element of snapshot.elements) {
    if (element.type === 'image') {
      const image = images.get(element.assetId);
      if (image) drawImage(context, image, element, 0, snapshot);
    } else if (element.type === 'text') drawText(context, element, 0);
    else drawTable(context, element, 0, snapshot);
  }
  return canvas.toDataURL('image/jpeg', .74);
}
