// Renders Chrome Web Store screenshots (1280x800) and the small promo tile (440x280) with headless
// Chrome, from the fixture preview server. Run `npm run build` first for the native switcher image.
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = root + 'dist/store-assets/';
mkdirSync(out, {recursive: true});
execFileSync(root + 'build/Neatab.app/Contents/MacOS/Neatab', ['--render-fixture', root + 'build/neatab-switcher-light.png']);
const server = spawn(process.execPath, [root + 'scripts/preview-server.mjs'], {stdio: 'ignore'});
await new Promise(resolve => setTimeout(resolve, 600));
try {
  const capture = (url, file, width, height) => execFileSync(chrome, ['--headless=new', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=2', '--allow-file-access-from-files', `--window-size=${width},${height}`,
    '--virtual-time-budget=4000', `--screenshot=${out}${file}.png`, url], {stdio: 'ignore'});
  // Pages are captured on their own first; headless Chrome clips scaled cross-origin iframes.
  capture('http://127.0.0.1:4177/tabs.html#all', 'raw-all', 900, 705);
  capture('http://127.0.0.1:4177/tabs.html#inactive', 'raw-inactive', 900, 705);
  capture('http://127.0.0.1:4177/popup.html', 'raw-popup', 354, 774);
  const page = pathToFileURL(root + 'store/screens.html').href;
  const shots = [['1-switcher', 'switcher', 1280, 800], ['2-duplicates', 'duplicates', 1280, 800],
    ['3-inactive', 'inactive', 1280, 800], ['4-popup', 'popup', 1280, 800], ['promo-tile-440x280', 'tile', 440, 280]];
  for (const [file, shot, width, height] of shots) {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--allow-file-access-from-files', `--window-size=${width},${height}`, '--virtual-time-budget=4000',
      `--screenshot=${out}${file}.png`, `${page}?shot=${shot}`], {stdio: 'ignore'});
    console.log(`${out}${file}.png`);
  }
} finally { server.kill(); }
