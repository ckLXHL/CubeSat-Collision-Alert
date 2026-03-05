import { initDashboard } from "./dashboard.js";
import { loadTOCAView } from "./toca.js";
import { parseCDM, renderCDMResult, CDMFields } from "./cdm-parser.js";
import { ConjunctionEvent } from "./api.js";

// ──────────────────────────────────────────────────────────────────────────────
//  Tab navigation
// ──────────────────────────────────────────────────────────────────────────────

function setupTabs(): void {
  const btns = document.querySelectorAll<HTMLButtonElement>(".tab-btn");
  const panels = document.querySelectorAll<HTMLDivElement>(".tab-panel");

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      btns.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${target}`)?.classList.add("active");
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  CDM Translator wiring
// ──────────────────────────────────────────────────────────────────────────────

function setupCDMTranslator(): void {
  const dropZone = document.getElementById("cdm-drop-zone") as HTMLDivElement;
  const fileInput = document.getElementById("cdm-file-input") as HTMLInputElement;
  const textInput = document.getElementById("cdm-text-input") as HTMLTextAreaElement;
  const parseBtn = document.getElementById("parse-btn") as HTMLButtonElement;
  const resultEl = document.getElementById("cdm-result") as HTMLDivElement;
  const fieldsEl = document.getElementById("cdm-fields") as HTMLDivElement;

  function displayCDM(text: string): void {
    try {
      const fields: CDMFields = parseCDM(text);
      const rendered = renderCDMResult(fields);
      fieldsEl.innerHTML = "";
      fieldsEl.appendChild(rendered);
      resultEl.style.display = "block";
    } catch (err) {
      fieldsEl.innerHTML = `<div class="error-msg">Parse error: ${(err as Error).message}</div>`;
      resultEl.style.display = "block";
    }
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => displayCDM(reader.result as string);
    reader.readAsText(file);
  });

  parseBtn.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text) return;
    displayCDM(text);
  });

  // Drag-and-drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => displayCDM(reader.result as string);
    reader.readAsText(file);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  Application entry point
// ──────────────────────────────────────────────────────────────────────────────

function onConjunctionSelected(evt: ConjunctionEvent): void {
  // Load TOCA view (may be deferred until user switches to TOCA tab)
  loadTOCAView(evt);
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupCDMTranslator();
  initDashboard(onConjunctionSelected);
});
