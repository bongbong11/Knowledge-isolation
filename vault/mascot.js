const MASCOT_URL = new URL('../assets/mascot-secret-agent.png', import.meta.url).href;

export function createMascotIcon() {
  const image = document.createElement('img');
  image.className = 'kv-mascot';
  image.src = MASCOT_URL;
  image.alt = '';
  image.width = 18;
  image.height = 18;
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  image.addEventListener('error', () => { image.hidden = true; }, { once: true });
  return image;
}
