import { fetchConjunctions, ConjunctionEvent } from "./api.js";

const ALERT_DISTANCE_KM = 10;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toUTCString().replace("GMT", "UTC");
}

function pcToString(pc: number): string {
  if (pc < 1e-6) return `${(pc * 1e6).toFixed(2)} × 10⁻⁶`;
  if (pc < 1e-3) return `${(pc * 1e4).toFixed(2)} × 10⁻⁴`;
  return pc.toFixed(6);
}

function getRiskLevel(evt: ConjunctionEvent): "high" | "medium" | "low" {
  if (evt.min_distance_km < ALERT_DISTANCE_KM && evt.pc >= 1e-4) return "high";
  if (evt.min_distance_km < ALERT_DISTANCE_KM) return "medium";
  return "low";
}

function getPcClass(pc: number): string {
  if (pc >= 1e-4) return "high";
  if (pc >= 1e-5) return "medium";
  return "low";
}

function createCard(evt: ConjunctionEvent): HTMLElement {
  const risk = getRiskLevel(evt);
  const card = document.createElement("div");
  card.className = `conjunction-card ${risk}-risk`;
  card.dataset.id = evt.id;

  const distClass = evt.min_distance_km < ALERT_DISTANCE_KM ? "critical" : "warning";

  card.innerHTML = `
    <div class="sat-names">
      <div class="sat-name">🛰 ${evt.sat1.name}</div>
      <div class="sat-id">NORAD ${evt.sat1.norad_id}</div>
      <div style="margin:4px 0;color:#30363d;">↕</div>
      <div class="sat-name">🛰 ${evt.sat2.name}</div>
      <div class="sat-id">NORAD ${evt.sat2.norad_id}</div>
    </div>
    <div class="conjunction-meta">
      <div class="toca-time">TOCA: ${formatDate(evt.toca)}</div>
      <div class="distance ${distClass}">${evt.min_distance_km.toFixed(2)} km</div>
      <div class="confidence-tag">Confidence: ${evt.data_confidence}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
      <span class="pc-badge ${getPcClass(evt.pc)}">Pc ${pcToString(evt.pc)}</span>
      <button class="btn" style="font-size:0.75rem;padding:4px 10px;margin-top:0;" data-view-toca="${evt.id}">
        🌍 View TOCA
      </button>
    </div>
  `;

  return card;
}

export async function initDashboard(
  onSelectConjunction: (evt: ConjunctionEvent) => void
): Promise<void> {
  const listEl = document.getElementById("conjunction-list") as HTMLDivElement;
  const lastUpdatedEl = document.getElementById("last-updated") as HTMLSpanElement;
  const freshnessBanner = document.getElementById("freshness-banner") as HTMLDivElement;

  try {
    const data = await fetchConjunctions();

    lastUpdatedEl.textContent = `Last updated: ${formatDate(data.updated_at)}`;

    // Check TLE data freshness (>24 h old → warn)
    const ageMs = Date.now() - new Date(data.updated_at).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      freshnessBanner.classList.add("visible");
    }

    if (data.conjunctions.length === 0) {
      listEl.innerHTML = `<div class="loading">No high-risk conjunctions detected in the next 72 hours. ✅</div>`;
      return;
    }

    listEl.innerHTML = "";

    // Sort by distance ascending (closest first)
    const sorted = [...data.conjunctions].sort(
      (a, b) => a.min_distance_km - b.min_distance_km
    );

    for (const evt of sorted) {
      const card = createCard(evt);
      card.addEventListener("click", () => onSelectConjunction(evt));
      const tocaBtn = card.querySelector<HTMLButtonElement>(`[data-view-toca="${evt.id}"]`);
      if (tocaBtn) {
        tocaBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectConjunction(evt);
          // Switch to TOCA tab
          document
            .querySelector<HTMLButtonElement>('[data-tab="toca"]')
            ?.click();
        });
      }
      listEl.appendChild(card);
    }
  } catch (err) {
    listEl.innerHTML = `<div class="error-msg">Failed to load conjunction data: ${(err as Error).message}</div>`;
    lastUpdatedEl.textContent = "—";
  }
}
