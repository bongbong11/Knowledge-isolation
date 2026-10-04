import { createMascotIcon } from './mascot.js';
import { requestVaultOpen } from './access.js';

export function mountVaultLauncher() {
  if (document.getElementById('kv-wand-button')) return;
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return;
  const launcher = document.createElement('div');
  launcher.id = 'kv-wand-button';
  launcher.className = 'list-group-item flex-container flexGap5 interactable';
  launcher.setAttribute('role', 'button'); launcher.tabIndex = 0;
  launcher.setAttribute('aria-label', '정보금고 열기');
  const label = document.createElement('span'); label.textContent = '정보금고';
  launcher.append(createMascotIcon(), label);
  launcher.addEventListener('click', () => requestVaultOpen());
  launcher.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); requestVaultOpen(); }
  });
  const sceneReader = document.getElementById('scene-reader-wand');
  if (sceneReader?.parentElement === menu) sceneReader.after(launcher);
  else menu.append(launcher);
}
