const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const FIRST_IMAGE = 'data:image/png;base64,Zmlyc3Q=';
const SECOND_IMAGE = 'data:image/jpeg;base64,c2Vjb25k';

async function openApp(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    const snapshot = { val: () => null };
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return {
          ref() {
            return {
              once: () => Promise.resolve(snapshot),
              on: () => {},
              off: () => {},
              set: () => Promise.resolve(),
              update: () => Promise.resolve()
            };
          }
        };
      }
    };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
}

test('admin can attach and paste a separate image for each worksheet question', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    stationCount = 3;
    buildStationsUI({
      1: {
        id: 1,
        name: 'Lembaran Bergambar',
        location: 'Kelas',
        password: '12345',
        gameType: 'lembaran_kerja',
        gameDataRaw: '{"questions":[{"answer":"A"}]}'
      }
    });
    show('view-admin');
    selectAdminTab('setup');
  });

  const editor = page.locator('#worksheet_editor_1');
  await editor.locator('.worksheet-image-input').setInputFiles({
    name: 'soalan-1.png',
    mimeType: 'image/png',
    buffer: TINY_PNG
  });
  await expect(editor.locator('.worksheet-image-preview')).toBeVisible();
  await expect(editor.locator('.worksheet-image-status')).toContainText('Gambar sedia');

  await editor.getByRole('button', { name: 'Tambah Soalan' }).click();
  await page.evaluate(pngBase64 => {
    const bytes = Uint8Array.from(atob(pngBase64), character => character.charCodeAt(0));
    const file = new File([bytes], 'soalan-2.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }]
      }
    });
    document.querySelectorAll('#worksheet_editor_1 .worksheet-image-paste')[1].dispatchEvent(event);
  }, TINY_PNG.toString('base64'));

  await expect(editor.locator('.worksheet-image-preview')).toHaveCount(2);
  await expect(editor.locator('.worksheet-image-preview').nth(1)).toBeVisible();
  const questions = await page.evaluate(() => getWorksheetQuestionsFromEditor(1));
  expect(questions).toHaveLength(2);
  expect(questions[0].image).toMatch(/^data:image\/jpeg;base64,/);
  expect(questions[1].image).toMatch(/^data:image\/jpeg;base64,/);
});

test('student sees the matching image while answering each worksheet question', async ({ page }) => {
  await openApp(page);
  await page.evaluate(({ firstImage, secondImage }) => {
    window._testMode = true;
    startGame('worksheet-test', {
      id: 'worksheet-test',
      name: 'Lembaran Bergambar',
      gameType: 'lembaran_kerja',
      gameDataRaw: JSON.stringify({
        questions: [
          { answer: 'satu', image: firstImage },
          { answer: 'dua', image: secondImage }
        ]
      }),
      timeLimitMin: 10
    });
  }, { firstImage: FIRST_IMAGE, secondImage: SECOND_IMAGE });

  const image = page.locator('.worksheet-question-image');
  await expect(image).toHaveAttribute('src', FIRST_IMAGE);
  await expect(image).toHaveAttribute('alt', 'Gambar Soalan 1');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('worksheetAnswer');
  await page.locator('#worksheetAnswer').fill('satu');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();
  await expect(image).toHaveAttribute('src', SECOND_IMAGE);
  await expect(image).toHaveAttribute('alt', 'Gambar Soalan 2');
  await expect(page.locator('#gameCard')).toContainText('Soalan 2 daripada 2');
});

test('worksheet parser keeps safe raster images and drops unsafe image values', async ({ page }) => {
  await openApp(page);
  const parsed = await page.evaluate(({ safeImage }) => ({
    safe: worksheetQuestionsFromRaw(JSON.stringify({
      questions: [{ answer: 'A', image: safeImage }]
    })),
    unsafe: worksheetQuestionsFromRaw(JSON.stringify({
      questions: [{ answer: 'B', image: 'javascript:alert(1)' }]
    }))
  }), { safeImage: FIRST_IMAGE });

  expect(parsed.safe).toEqual([{ answer: 'A', image: FIRST_IMAGE }]);
  expect(parsed.unsafe).toEqual([{ answer: 'B', image: '' }]);
});
