import { getConfig, saveConfig } from '../shared';

const backendUrl = document.getElementById('backendUrl') as HTMLInputElement;
const autoSubmit = document.getElementById('autoSubmit') as HTMLSelectElement;
const msg = document.getElementById('msg')!;

void getConfig().then((config) => {
  backendUrl.value = config.backendUrl;
  autoSubmit.value = String(config.autoSubmit);
});

document.getElementById('save')!.addEventListener('click', async () => {
  try {
    const url = new URL(backendUrl.value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error('Protocole invalide');
    await saveConfig({ backendUrl: url.origin, autoSubmit: autoSubmit.value === 'true' });
    msg.textContent = 'Enregistré';
  } catch (error) {
    msg.textContent = error instanceof Error ? error.message : 'Erreur';
  }
});
