export interface CDMFields {
  // Header / metadata
  ccsds_cdm_vers?: string;
  creation_date?: string;
  originator?: string;
  message_for?: string;
  message_id?: string;

  // TCA / approach
  tca?: string;
  miss_distance?: string;
  relative_speed?: string;

  // Collision probability
  collision_probability?: string;
  collision_probability_method?: string;

  // Object 1
  object1_name?: string;
  object1_object_designator?: string;
  object1_maneuverable?: string;

  // Object 2
  object2_name?: string;
  object2_object_designator?: string;
  object2_maneuverable?: string;

  // Position covariance (Object 1, RTN frame)
  object1_cr_r?: string;
  object1_ct_r?: string;
  object1_ct_t?: string;
  object1_cn_r?: string;
  object1_cn_t?: string;
  object1_cn_n?: string;

  // Position covariance (Object 2, RTN frame)
  object2_cr_r?: string;
  object2_ct_r?: string;
  object2_ct_t?: string;
  object2_cn_r?: string;
  object2_cn_t?: string;
  object2_cn_n?: string;

  [key: string]: string | undefined;
}

/**
 * Parse a key-value CDM text file (KVN format).
 * Lines are of the form:  KEY = VALUE  or  COMMENT = ...
 */
function parseKVN(text: string): CDMFields {
  const fields: CDMFields = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("COMMENT")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase().replace(/\s+/g, "_");
    const value = line.slice(eqIdx + 1).trim();
    fields[key] = value;
  }
  return fields;
}

/**
 * Parse an XML CDM file.
 */
function parseXML(text: string): CDMFields {
  const fields: CDMFields = {};
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("XML parse error — check your CDM file.");
  }

  function extractAll(el: Element, prefix = ""): void {
    for (const child of Array.from(el.children)) {
      const key = (prefix ? `${prefix}_${child.tagName}` : child.tagName)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_");
      if (child.children.length === 0) {
        fields[key] = child.textContent?.trim() ?? "";
      } else {
        extractAll(child, child.tagName.toLowerCase());
      }
    }
  }

  const root = doc.documentElement;
  extractAll(root);
  return fields;
}

export function parseCDM(text: string): CDMFields {
  const trimmed = text.trim();
  if (trimmed.startsWith("<") || trimmed.startsWith("<?xml")) {
    return parseXML(trimmed);
  }
  return parseKVN(trimmed);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Rendering helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatPc(value: string): { display: string; ratio: number; cssClass: string } {
  const num = parseFloat(value);
  if (isNaN(num)) return { display: value, ratio: 0, cssClass: "low" };

  let display: string;
  if (num < 1e-6) {
    display = `${(num / 1e-6).toFixed(2)} × 10⁻⁶`;
  } else if (num < 1e-4) {
    display = `${(num / 1e-4).toFixed(2)} × 10⁻⁴`;
  } else {
    display = num.toExponential(2);
  }

  // Map Pc to a 0–1 scale on a log basis (1e-7 → 0, 1e-2 → 1)
  const logVal = Math.log10(Math.max(num, 1e-10));
  const ratio = Math.min(1, Math.max(0, (logVal + 10) / 8));
  const cssClass = num >= 1e-4 ? "high" : num >= 1e-5 ? "medium" : "low";
  return { display, ratio, cssClass };
}

function buildEllipsoidCanvas(rr: number, tt: number, nn: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = "ellipsoid-canvas";
  canvas.width = 300;
  canvas.height = 180;
  const ctx = canvas.getContext("2d")!;

  // Dark background
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Normalise semi-axes to canvas scale
  const maxVal = Math.max(rr, tt, nn, 1e-10);
  const scale = Math.min(cx, cy) * 0.8;
  const rx = (rr / maxVal) * scale;
  const ry = (nn / maxVal) * scale;
  const rtScale = (tt / maxVal) * scale;

  // Draw radial axis label
  ctx.strokeStyle = "#30363d";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx - scale, cy);
  ctx.lineTo(cx + scale, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - scale);
  ctx.lineTo(cx, cy + scale);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw projected ellipse (Radial × Normal plane)
  ctx.strokeStyle = "#58a6ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, 2 * Math.PI);
  ctx.stroke();

  // Draw along-track circle (simplified)
  ctx.strokeStyle = "rgba(88, 166, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rtScale, 2), Math.max(ry, 2), 0.4, 0, 2 * Math.PI);
  ctx.stroke();

  // Labels
  ctx.fillStyle = "#8b949e";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("R", cx + scale + 10, cy + 4);
  ctx.fillText("N", cx + 4, cy - scale - 6);
  ctx.fillText("T (3D)", cx, cy + scale + 16);

  // Centre dot
  ctx.fillStyle = "#f85149";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
  ctx.fill();

  return canvas;
}

export function renderCDMResult(fields: CDMFields): HTMLElement {
  const container = document.createElement("div");
  container.className = "cdm-field-grid";

  // ── Collision Probability ──────────────────────────────────────────────────
  const rawPc =
    fields.collision_probability ??
    fields["object1_collision_probability"] ??
    fields["pc"] ??
    "";
  if (rawPc) {
    const { display, ratio, cssClass } = formatPc(rawPc);
    const card = document.createElement("div");
    card.className = "cdm-field-card";
    card.innerHTML = `
      <h3>Collision Probability (Pc)</h3>
      <div class="pc-meter">
        <div class="pc-value" style="color:${cssClass === "high" ? "#f85149" : cssClass === "medium" ? "#d29922" : "#3fb950"}">${display}</div>
        <div class="pc-bar-track">
          <div class="pc-bar-fill" style="width:${(ratio * 100).toFixed(1)}%;background:${cssClass === "high" ? "#f85149" : cssClass === "medium" ? "#d29922" : "#3fb950"}"></div>
        </div>
        <div style="font-size:0.7rem;color:#8b949e;">Scale: 10⁻¹⁰ → 10⁻² (log)</div>
      </div>
    `;
    container.appendChild(card);
  }

  // ── Approach Info ──────────────────────────────────────────────────────────
  {
    const card = document.createElement("div");
    card.className = "cdm-field-card";
    const rows = [
      ["Time of Closest Approach", fields.tca ?? fields.time_of_closest_approach ?? "—"],
      ["Miss Distance", (fields.miss_distance ? `${fields.miss_distance} m` : "—")],
      ["Relative Speed", (fields.relative_speed ? `${fields.relative_speed} m/s` : "—")],
      ["Pc Method", fields.collision_probability_method ?? "—"],
    ];
    card.innerHTML = `
      <h3>Approach Parameters</h3>
      ${rows.map(([label, val]) => `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:0.75rem;color:#8b949e;">${label}</span>
          <span style="font-size:0.8rem;font-weight:600;">${val}</span>
        </div>
      `).join("")}
    `;
    container.appendChild(card);
  }

  // ── Object Info ────────────────────────────────────────────────────────────
  for (const obj of [1, 2] as const) {
    const prefix = `object${obj}`;
    const name = fields[`${prefix}_name`] ?? fields[`${prefix}_object`] ?? `Object ${obj}`;
    const desig = fields[`${prefix}_object_designator`] ?? "—";
    const maneuver = fields[`${prefix}_maneuverable`] ?? "—";
    const card = document.createElement("div");
    card.className = "cdm-field-card";
    card.innerHTML = `
      <h3>Object ${obj}: ${name}</h3>
      <div style="font-size:0.8rem;display:flex;flex-direction:column;gap:6px;">
        <div><span style="color:#8b949e;">Designator: </span><strong>${desig}</strong></div>
        <div><span style="color:#8b949e;">Maneuverable: </span><strong>${maneuver}</strong></div>
      </div>
    `;
    container.appendChild(card);
  }

  // ── Position Covariance Ellipsoid (Object 1) ───────────────────────────────
  const rr1 = parseFloat(fields["object1_cr_r"] ?? "0") || 0;
  const tt1 = parseFloat(fields["object1_ct_t"] ?? "0") || 0;
  const nn1 = parseFloat(fields["object1_cn_n"] ?? "0") || 0;

  if (rr1 || tt1 || nn1) {
    const card = document.createElement("div");
    card.className = "cdm-field-card";
    const title = document.createElement("h3");
    title.textContent = "Object 1 — Position Error Ellipsoid (RTN)";
    card.appendChild(title);
    const labels = document.createElement("div");
    labels.style.cssText = "font-size:0.75rem;color:#8b949e;margin-bottom:8px;display:flex;gap:16px;";
    labels.innerHTML = `
      <span>σR = ${Math.sqrt(Math.abs(rr1)).toExponential(2)} m</span>
      <span>σT = ${Math.sqrt(Math.abs(tt1)).toExponential(2)} m</span>
      <span>σN = ${Math.sqrt(Math.abs(nn1)).toExponential(2)} m</span>
    `;
    card.appendChild(labels);
    card.appendChild(buildEllipsoidCanvas(
      Math.sqrt(Math.abs(rr1)),
      Math.sqrt(Math.abs(tt1)),
      Math.sqrt(Math.abs(nn1))
    ));
    container.appendChild(card);
  }

  // ── Raw Fields ─────────────────────────────────────────────────────────────
  {
    const card = document.createElement("div");
    card.className = "cdm-field-card";
    card.innerHTML = `<h3>All Parsed Fields</h3>`;
    const pre = document.createElement("pre");
    pre.style.cssText =
      "font-size:0.7rem;overflow:auto;max-height:200px;color:#8b949e;white-space:pre-wrap;";
    pre.textContent = Object.entries(fields)
      .map(([k, v]) => `${k.padEnd(40)} = ${v}`)
      .join("\n");
    card.appendChild(pre);
    container.appendChild(card);
  }

  return container;
}
