// Dependency-free terminal playback widget. Replays a recorded skeem scenario
// (see site/public/scenarios/*.json) with a typing effect, click-to-skip, a
// JSON colorizer, foldable output, and reduced-motion support. The output is
// real captured CLI output — nothing is synthesized at render time.

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Tokenizing JSON colorizer, operating per line (captured JSON has no
// newline-spanning strings). Keys, strings, numbers, booleans, null get spans.
function colorizeLine(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") j += 2;
        else if (line[j] === '"') { j += 1; break; }
        else j += 1;
      }
      const str = line.slice(i, j);
      const isKey = /^\s*:/.test(line.slice(j));
      out += `<span class="${isKey ? "j-key" : "j-str"}">${esc(str)}</span>`;
      i = j;
    } else if (/[-0-9]/.test(ch) && /[\s:[\],]/.test(line[i - 1] ?? " ")) {
      let j = i;
      while (j < line.length && /[0-9.eE+-]/.test(line[j])) j += 1;
      out += `<span class="j-num">${esc(line.slice(i, j))}</span>`;
      i = j;
    } else if (/^(true|false|null)/.test(line.slice(i))) {
      const kw = /^(true|false|null)/.exec(line.slice(i))[1];
      out += `<span class="${kw === "null" ? "j-null" : "j-bool"}">${kw}</span>`;
      i += kw.length;
    } else {
      out += esc(ch);
      i += 1;
    }
  }
  return out;
}

function renderOutput(step) {
  const lines = step.output.split("\n");
  const colorize = step.outputFormat === "json";
  const hl = step.highlight ?? [];
  const html = lines
    .map((line) => {
      const marked = hl.some((h) => line.includes(h));
      const body = colorize ? colorizeLine(line) : esc(line);
      return `<span class="line${marked ? " hl" : ""}">${body || "&nbsp;"}</span>`;
    })
    .join("\n");

  const fold = step.foldAfter && lines.length > step.foldAfter + 2;
  if (!fold) return `<div class="out">${html}</div>`;
  const head = lines.slice(0, step.foldAfter);
  const rest = lines.length - step.foldAfter;
  const headHtml = head
    .map((line) => {
      const marked = hl.some((h) => line.includes(h));
      const body = colorize ? colorizeLine(line) : esc(line);
      return `<span class="line${marked ? " hl" : ""}">${body || "&nbsp;"}</span>`;
    })
    .join("\n");
  return `<div class="out folded"><div class="out-head">${headHtml}</div><button class="unfold">… show ${rest} more lines</button><div class="out-rest" hidden>${html}</div></div>`;
}

export class Terminal {
  constructor(container) {
    this.container = container;
    this.scenario = null;
    this.timer = null;
    this._build();
  }

  _build() {
    this.container.classList.add("term");
    this.container.innerHTML = `
      <div class="term-bar">
        <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span class="term-title">skeem demo</span>
        <span class="term-actions">
          <button class="t-skip" type="button">Skip</button>
          <button class="t-replay" type="button" hidden>Replay</button>
        </span>
      </div>
      <div class="term-body" role="log" aria-label="terminal transcript" tabindex="0"></div>
      <div class="term-foot"></div>`;
    this.body = this.container.querySelector(".term-body");
    this.foot = this.container.querySelector(".term-foot");
    this.container.querySelector(".t-skip").addEventListener("click", (e) => { e.stopPropagation(); this.finish(); });
    this.container.querySelector(".t-replay").addEventListener("click", (e) => { e.stopPropagation(); this.play(this.scenario); });
    // Click in the transcript skips the current step.
    this.body.addEventListener("click", (e) => {
      if (e.target.closest(".copy") || e.target.closest(".unfold")) return;
      this._skipStep();
    });
  }

  load(scenario) {
    this.scenario = scenario;
    this._reset();
    const captured = scenario.capturedAt ? new Date(scenario.capturedAt).toISOString().slice(0, 10) : "";
    const live = scenario.env?.liveApis?.length ? ` · live: ${scenario.env.liveApis.join(", ")}` : "";
    this.foot.innerHTML = `<span class="rec">●</span> Recorded real output — skeem v${esc(scenario.skeemVersion ?? "")}${captured ? `, ${captured}` : ""}. Every command is copy-pasteable.${esc(live)}`;
  }

  _reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.body.innerHTML = "";
    this._done = false;
    this.container.querySelector(".t-replay").hidden = true;
    this.container.querySelector(".t-skip").hidden = false;
  }

  play(scenario) {
    if (scenario && scenario !== this.scenario) this.load(scenario);
    else this._reset();
    this._stepIndex = 0;
    this._playStep();
  }

  _playStep() {
    if (!this.scenario || this._stepIndex >= this.scenario.steps.length) return this._complete();
    const step = this.scenario.steps[this._stepIndex];
    const el = document.createElement("div");
    el.className = "step";
    if (step.comment) el.innerHTML += `<div class="comment">${esc(step.comment)}</div>`;
    const promptId = `cmd-${this._stepIndex}`;
    el.innerHTML += `<div class="prompt"><span class="sigil">$</span> <span class="cmd" id="${promptId}"></span><button class="copy" type="button" title="Copy command" aria-label="Copy command">⧉</button></div>`;
    this.body.appendChild(el);
    this._scroll();

    const cmdEl = el.querySelector(".cmd");
    const copyBtn = el.querySelector(".copy");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(step.command).then(() => {
        copyBtn.textContent = "✓";
        setTimeout(() => (copyBtn.textContent = "⧉"), 1200);
      });
    });

    this._curStep = { step, el, cmdEl, typed: false };
    this._typeCommand(step.command, cmdEl, () => this._emitOutput(step, el));
  }

  _typeCommand(text, el, done) {
    if (REDUCED_MOTION) { el.textContent = text; return done(); }
    let i = 0;
    const tick = () => {
      el.textContent = text.slice(0, i);
      if (i >= text.length) return done();
      i += 1;
      this.timer = setTimeout(tick, 14 + Math.random() * 22);
    };
    tick();
  }

  _emitOutput(step, el) {
    if (step.output && step.output.length) {
      const wrap = document.createElement("div");
      wrap.innerHTML = renderOutput(step);
      const outNode = wrap.firstElementChild;
      if (step.exitCode && step.exitCode !== 0) {
        const marker = document.createElement("div");
        marker.className = "exit";
        marker.textContent = `✘ exit ${step.exitCode}`;
        el.appendChild(marker);
      }
      el.appendChild(outNode);
      const unfold = outNode.querySelector(".unfold");
      if (unfold) {
        unfold.addEventListener("click", (e) => {
          e.stopPropagation();
          outNode.querySelector(".out-head").hidden = true;
          outNode.querySelector(".out-rest").hidden = false;
          unfold.remove();
          this._scroll();
        });
      }
    }
    if (step.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = step.note;
      el.appendChild(note);
    }
    this._scroll();
    this._curStep = null;
    this._stepIndex += 1;
    const delay = REDUCED_MOTION ? 0 : Math.min(step.durationMs ?? 400, 900) + 350;
    this.timer = setTimeout(() => this._playStep(), delay);
  }

  // Finish the in-flight step instantly, then continue.
  _skipStep() {
    if (this._done) return;
    if (!this._curStep) return;
    clearTimeout(this.timer);
    const { step, el, cmdEl } = this._curStep;
    cmdEl.textContent = step.command;
    this._emitOutput(step, el);
  }

  // Render everything remaining instantly.
  finish() {
    if (!this.scenario || this._done) return;
    clearTimeout(this.timer);
    if (this._curStep) {
      const { step, el, cmdEl } = this._curStep;
      cmdEl.textContent = step.command;
      this._renderOutputInstant(step, el);
      this._curStep = null;
      this._stepIndex += 1;
    }
    while (this._stepIndex < this.scenario.steps.length) {
      const step = this.scenario.steps[this._stepIndex];
      const el = document.createElement("div");
      el.className = "step";
      if (step.comment) el.innerHTML += `<div class="comment">${esc(step.comment)}</div>`;
      el.innerHTML += `<div class="prompt"><span class="sigil">$</span> <span class="cmd">${esc(step.command)}</span><button class="copy" type="button" title="Copy command">⧉</button></div>`;
      this.body.appendChild(el);
      el.querySelector(".copy").addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(step.command);
      });
      this._renderOutputInstant(step, el);
      this._stepIndex += 1;
    }
    this._complete();
  }

  _renderOutputInstant(step, el) {
    if (step.exitCode && step.exitCode !== 0) {
      const marker = document.createElement("div");
      marker.className = "exit";
      marker.textContent = `✘ exit ${step.exitCode}`;
      el.appendChild(marker);
    }
    if (step.output && step.output.length) {
      const wrap = document.createElement("div");
      wrap.innerHTML = renderOutput(step);
      const outNode = wrap.firstElementChild;
      const unfold = outNode.querySelector(".unfold");
      if (unfold) {
        unfold.addEventListener("click", (e) => {
          e.stopPropagation();
          outNode.querySelector(".out-head").hidden = true;
          outNode.querySelector(".out-rest").hidden = false;
          unfold.remove();
        });
      }
      el.appendChild(outNode);
    }
    if (step.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = step.note;
      el.appendChild(note);
    }
    this._scroll();
  }

  _complete() {
    this._done = true;
    this.container.querySelector(".t-skip").hidden = true;
    this.container.querySelector(".t-replay").hidden = false;
    this._scroll();
  }

  _scroll() {
    this.body.scrollTop = this.body.scrollHeight;
  }
}
