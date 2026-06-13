import { Terminal } from "./player.js";

const cache = new Map();
async function loadScenario(file) {
  if (cache.has(file)) return cache.get(file);
  const res = await fetch(`scenarios/${file}`);
  const data = await res.json();
  cache.set(file, data);
  return data;
}

async function init() {
  let manifest;
  try {
    manifest = await (await fetch("scenarios/index.json")).json();
  } catch {
    return; // static <pre> fallback in the HTML stays visible
  }
  const scenarios = manifest.scenarios ?? [];
  if (scenarios.length === 0) return;

  // Hero: first scenario, autoplay once it scrolls into view.
  const heroEl = document.getElementById("hero-term");
  if (heroEl) {
    const hero = new Terminal(heroEl);
    const first = await loadScenario(scenarios[0].file);
    hero.load(first);
    hero.finish(); // render immediately as the fallback/SSR-ish state
    let played = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !played) {
            played = true;
            hero.play(first);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(heroEl);
  }

  // Gallery: picker + a single terminal that swaps scenarios.
  const galleryEl = document.getElementById("gallery-term");
  const pickerEl = document.getElementById("gallery-picker");
  const taglineEl = document.getElementById("gallery-tagline");
  if (!galleryEl || !pickerEl) return;

  const gallery = new Terminal(galleryEl);
  const buttons = [];

  async function select(index) {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
    const meta = scenarios[index];
    if (taglineEl) taglineEl.textContent = meta.tagline ?? "";
    const data = await loadScenario(meta.file);
    gallery.play(data);
  }

  scenarios.forEach((s, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pick";
    btn.textContent = s.title;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => select(i));
    pickerEl.appendChild(btn);
    buttons.push(btn);
  });

  // Load the first gallery scenario without autoplaying (visitor picks).
  const firstData = await loadScenario(scenarios[0].file);
  buttons[0].setAttribute("aria-pressed", "true");
  if (taglineEl) taglineEl.textContent = scenarios[0].tagline ?? "";
  gallery.load(firstData);
  gallery.finish();
}

init();
