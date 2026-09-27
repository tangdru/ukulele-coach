// Verifies the "Songs" panel's browsable library list (replaces the old
// search-only <input list>/<datalist>, then a focus-triggered custom
// dropdown -- both left no way to just see what's available without
// typing) and basic playlists: create/rename/delete, add/remove songs,
// and a "Play playlist" sequenced practice session that auto-advances to
// the next song when the current one reaches its natural end (but not on
// a manual Stop), with manual Prev/Next/Exit controls too.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:8934/index.html');

function acceptNextDialogWith(text) {
  return new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      await dialog.accept(text);
      resolve();
    });
  });
}

// The list is visible the instant the panel opens -- no focus/typing
// needed to see what's available.
await page.click('#railUpload');
let items = await page.locator('#songList .song-list-item').evaluateAll((els) => els.map((el) => el.dataset.title));
console.log('Items on open:', items);
if (items.length < 5) throw new Error(`Expected all bundled demo songs listed, got: ${items.join(', ')}`);

// Typing filters the list live.
await page.fill('#songSearch', 'twin');
await page.waitForTimeout(50);
items = await page.locator('#songList .song-list-item').evaluateAll((els) => els.map((el) => el.dataset.title));
if (items.length !== 1 || items[0] !== 'Twinkle Twinkle Little Star') {
  throw new Error(`Expected only "Twinkle Twinkle Little Star", got: ${items.join(', ')}`);
}

// No-match state.
await page.fill('#songSearch', 'zzz_nonexistent_song');
await page.waitForTimeout(50);
const emptyText = await page.textContent('#songList');
if (!emptyText.includes('No matching')) throw new Error(`Expected a "no matches" message, got: "${emptyText}"`);

// Enter loads the first match and closes the panel.
await page.fill('#songSearch', '');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
let title = await page.textContent('#songTitle');
console.log('Loaded via Enter:', title);
if (!(await page.locator('#uploadPanel').isHidden())) throw new Error('Panel should auto-close after loading a song');

// Click-to-select a specific row.
await page.click('#railUpload');
await page.locator('#songList .song-list-item', { hasText: 'Oh! Susanna' }).click();
await page.waitForTimeout(200);
title = await page.textContent('#songTitle');
if (title !== 'Oh! Susanna') throw new Error(`Expected "Oh! Susanna" loaded, got "${title}"`);

// ---------- Add two tiny custom songs to build a fast, deterministic playlist ----------

async function pasteSong(title, body) {
  await page.click('#railUpload');
  await page.click('#togglePasteBtn');
  await page.fill('#pasteText', `{title: ${title}}\n{key: C}\n{tempo: 240}\n\n[C]${body}\n`);
  await page.click('#loadPastedBtn');
  await page.waitForTimeout(150);
}

await pasteSong('Queue Song A', 'First');
await pasteSong('Queue Song B', 'Second');

// ---------- Playlists ----------

await page.click('#railUpload');
const dialogDone1 = acceptNextDialogWith('Practice Set');
await page.click('#newPlaylistBtn');
await dialogDone1;
await page.waitForTimeout(100);
if (!(await page.locator('.playlist-chip', { hasText: 'Practice Set' }).evaluate((el) => el.classList.contains('active')))) {
  throw new Error('New playlist chip should become the active selection');
}
if (!(await page.locator('#playlistActions').isVisible())) throw new Error('Playlist actions (Play/Rename/Delete) should show once a playlist is selected');

// Add the two custom songs to it via each row's toggle button, in order.
await page.locator('#songList .song-list-item', { hasText: 'Queue Song A' }).locator('.song-list-item-toggle').click();
await page.locator('#songList .song-list-item', { hasText: 'Queue Song B' }).locator('.song-list-item-toggle').click();
await page.waitForTimeout(50);
const inPlaylistCount = await page.locator('#songList .song-list-item-toggle.in-playlist').count();
if (inPlaylistCount !== 2) throw new Error(`Expected 2 songs marked as in the playlist, got ${inPlaylistCount}`);

// Toggling again removes, and back on re-adds -- the control is a real
// toggle. Done on song B (not A) so the playlist order used by the
// queue test below (A then B) is unaffected -- a toggled-off-then-back-on
// song is re-appended at the end, which would otherwise reorder it.
await page.locator('#songList .song-list-item', { hasText: 'Queue Song B' }).locator('.song-list-item-toggle').click();
await page.waitForTimeout(50);
if (await page.locator('#songList .song-list-item-toggle.in-playlist').count() !== 1) throw new Error('Toggling off should remove the song from the playlist');
await page.locator('#songList .song-list-item', { hasText: 'Queue Song B' }).locator('.song-list-item-toggle').click();
await page.waitForTimeout(50);
if (await page.locator('#songList .song-list-item-toggle.in-playlist').count() !== 2) throw new Error('Toggling back on should re-add the song');

// ---------- Play playlist: sequenced practice session ----------

await page.fill('#tempoInput', '240'); // fast, so the first song reaches its natural end quickly
await page.click('#playPlaylistBtn');
await page.waitForTimeout(200);
if (!(await page.locator('#uploadPanel').isHidden())) throw new Error('Play playlist should close the panel and start playing the first song');
title = await page.textContent('#songTitle');
console.log('Queue started on:', title);
if (title !== 'Queue Song A') throw new Error(`Expected "Queue Song A" loaded first, got "${title}"`);
let queueText = await page.textContent('#queueStatusText');
console.log('Queue status:', queueText);
if (!queueText.includes('Practice Set') || !queueText.includes('1/2')) throw new Error(`Expected queue status "Practice Set ... 1/2", got "${queueText}"`);

// Start Learn (metronome) mode and let the 1-line song play to its
// natural end -- it should auto-advance to the next song in the queue
// and keep the same mode running, without the player doing anything.
// Polled rather than a fixed wait: Queue Song B is just as short, so a
// wait long enough to be safe would risk *also* catching B's own natural
// end (which empties the queue and stops), masking the auto-resumed mode
// this is actually checking for.
await page.click('#modeMetronomeBtn');
await page.waitForFunction(() => document.getElementById('songTitle').textContent === 'Queue Song B', { timeout: 8000 });
title = await page.textContent('#songTitle');
console.log('After auto-advance:', title);
if (title !== 'Queue Song B') throw new Error(`Expected the queue to auto-advance to "Queue Song B", got "${title}"`);
queueText = await page.textContent('#queueStatusText');
if (!queueText.includes('2/2')) throw new Error(`Expected queue status to show 2/2, got "${queueText}"`);
if (!(await page.locator('#modeMetronomeBtn').evaluate((el) => el.classList.contains('active')))) {
  throw new Error('Learn mode should still be running (auto-resumed) on the next queued song');
}

// Manual Prev/Next/Exit controls.
await page.click('#queuePrevBtn');
await page.waitForTimeout(200);
title = await page.textContent('#songTitle');
if (title !== 'Queue Song A') throw new Error(`Prev should go back to "Queue Song A", got "${title}"`);
await page.click('#queueNextBtn');
await page.waitForTimeout(200);
title = await page.textContent('#songTitle');
if (title !== 'Queue Song B') throw new Error(`Next should go forward to "Queue Song B", got "${title}"`);
await page.click('#queueExitBtn');
if (!(await page.locator('#queueStatus').isHidden())) throw new Error('Exit should hide the queue status bar');

// A manual Stop ends the queue too, but doesn't auto-advance to a next song.
await page.click('#railUpload');
await page.click('#playPlaylistBtn');
await page.waitForTimeout(150);
await page.click('#stopBtn');
if (!(await page.locator('#queueStatus').isHidden())) throw new Error('Manual Stop should end the playlist queue');
title = await page.textContent('#songTitle');
if (title !== 'Queue Song A') throw new Error('Manual Stop should not have advanced to a different song');

// Picking a song manually (outside the queue) ends the queue too.
await page.click('#railUpload');
await page.click('#playPlaylistBtn');
await page.waitForTimeout(150);
await page.click('#railUpload');
await page.locator('#songList .song-list-item', { hasText: 'Oh! Susanna' }).click();
await page.waitForTimeout(150);
if (!(await page.locator('#queueStatus').isHidden())) throw new Error('Manually picking a different song should end the playlist queue');

// ---------- Rename and delete ----------

await page.click('#railUpload');
await page.locator('.playlist-chip', { hasText: 'Practice Set' }).click();
const dialogDone2 = acceptNextDialogWith('Renamed Set');
await page.click('#renamePlaylistBtn');
await dialogDone2;
await page.waitForTimeout(100);
if (!(await page.locator('.playlist-chip', { hasText: 'Renamed Set' }).isVisible())) throw new Error('Playlist should be renamed');

const dialogDone3 = acceptNextDialogWith('');
await page.click('#deletePlaylistBtn');
await dialogDone3;
await page.waitForTimeout(100);
if (await page.locator('.playlist-chip', { hasText: 'Renamed Set' }).count() !== 0) throw new Error('Deleted playlist chip should be gone');
if (!(await page.locator('.playlist-chip.active', { hasText: 'All Songs' }).isVisible())) throw new Error('Deleting the active playlist should fall back to All Songs');
if (!(await page.locator('#playlistActions').isHidden())) throw new Error('Playlist actions should hide once back on All Songs');

// Deleting a playlist must not delete its songs.
items = await page.locator('#songList .song-list-item').evaluateAll((els) => els.map((el) => el.dataset.title));
if (!items.includes('Queue Song A') || !items.includes('Queue Song B')) {
  throw new Error('Deleting a playlist should not delete the songs that were in it');
}

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
await browser.close();
console.log('OK: the song library is browsable without typing, filters as you type, and playlists support create/rename/delete, add/remove songs, and a sequenced Play-playlist session with auto-advance plus manual Prev/Next/Exit');
