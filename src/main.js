// App entry. Screen flow (record/upload -> classify -> generate -> play)
// gets wired up in later phases; for now this just proves the build works.
const app = document.querySelector('#app');

app.innerHTML = `
  <main class="splash">
    <h1>Sound Merge</h1>
    <p>Drop a sound. Watch it glow up. Merge it into a sigma.</p>
  </main>
`;
