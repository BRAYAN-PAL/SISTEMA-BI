const progressRing = document.getElementById("progressRing");
const progressValue = document.getElementById("progressValue");
const progressLabel = document.getElementById("progressLabel");
const headerBar = document.getElementById("headerBar");
const headerPercent = document.getElementById("headerPercent");
const consoleBody = document.getElementById("consoleBody");
const fileWeight = document.getElementById("fileWeight");
const fileWeightHint = document.getElementById("fileWeightHint");
const errorRate = document.getElementById("errorRate");
const errorHint = document.getElementById("errorHint");
const clearData = document.getElementById("clearData");
const loadDb = document.getElementById("loadDb");

const PROGRESS_MAX_DEG = 360;
let progressTimer = null;
let isPrepared = false;
let isLoading = false;
const STORAGE_KEY = "stagingDataList";
const ACTIVE_KEY = "stagingActiveId";

// DETECTA AUTOMÁTICAMENTE LA URL: Si la web corre en Render, usa Render. Si corre en local, usa localhost.
const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3000"
  : `${window.location.protocol}//${window.location.host}`;

const prepLines = [
  "Extrayendo datos...",
  "Transformando datos...",
  "Limpiando datos...",
];

const loadLines = [
  "Cargando a la base de datos...",
  "Generacion de scripts completada.",
  "Proceso exitoso.",
];

const setProgress = (value) => {
  const safeValue = Math.min(100, Math.max(0, Math.round(value)));
  const degrees = (safeValue / 100) * PROGRESS_MAX_DEG;

  if (progressRing) {
    progressRing.style.setProperty("--progress", String(degrees));
  }
  if (progressValue) {
    progressValue.textContent = `${safeValue}%`;
  }
  if (headerBar) {
    headerBar.style.width = `${safeValue}%`;
  }
  if (headerPercent) {
    headerPercent.textContent = `${safeValue}%`;
  }
};

const setStatus = (label) => {
  if (progressLabel) {
    progressLabel.textContent = label;
  }
};

const updateLoadButton = (isReady) => {
  if (!loadDb) return;
  loadDb.disabled = !isReady;
  loadDb.classList.toggle("btn--glow", Boolean(isReady));
  if (!isReady) {
    loadDb.textContent = "Cargar a la base de datos";
  }
};

const appendLine = (text, cssClass) => {
  if (!consoleBody) return;
  const line = document.createElement("div");
  line.className = "console__line";
  if (cssClass) {
    line.classList.add(`console__line--${cssClass}`);
  }
  line.textContent = text;
  consoleBody.appendChild(line);
  consoleBody.scrollTop = consoleBody.scrollHeight;
};

const appendSuccessBar = () => {
  if (!consoleBody) return;
  const wrapper = document.createElement("div");
  wrapper.className = "console__success";
  const bar = document.createElement("div");
  bar.className = "console__success-bar";
  wrapper.appendChild(bar);
  consoleBody.appendChild(wrapper);
  consoleBody.scrollTop = consoleBody.scrollHeight;
};

const getStoredData = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const getActiveId = () => localStorage.getItem(ACTIVE_KEY);

const getActiveItem = () => {
  const list = getStoredData();
  if (!list.length) return null;
  const activeId = getActiveId() || list[list.length - 1].id;
  return list.find((item) => item.id === activeId) || list[0];
};

const computeFileWeight = (list) => {
  if (!list.length) return { totalGb: 0, hint: "Sin archivos cargados" };
  const approxRows = list.reduce((sum, item) => sum + (item.totalRows || 0), 0);
  const approxGb = Math.max(0.1, approxRows / 800000).toFixed(2);
  return {
    totalGb: approxGb,
    hint: `${list.length} dataset(s) procesados`,
  };
};

const updateStatusCards = () => {
  const list = getStoredData();
  const { totalGb, hint } = computeFileWeight(list);
  if (fileWeight) fileWeight.textContent = `${totalGb} GB`;
  if (fileWeightHint) fileWeightHint.textContent = hint;

  if (errorRate) errorRate.textContent = list.length ? "0" : "-";
  if (errorHint) errorHint.textContent = list.length ? "Sin errores detectados" : "Sin datos para validar";
};

const updateLoadAvailability = () => {
  const activeItem = getActiveItem();
  const isReady = Boolean(activeItem && activeItem.validated && !isLoading);
  updateLoadButton(isReady);
};

localStorage.setItem("stagingActiveId", localStorage.getItem("stagingActiveId") || "");

const runPrepSimulation = () => {
  if (!loadDb) return;
  isPrepared = false;
  setProgress(0);
  setStatus("Procesando...");
  loadDb.disabled = true;
  loadDb.classList.remove("btn--glow");
  loadDb.textContent = "Preparando ETL...";

  let lineIndex = 0;

  if (progressTimer) {
    clearInterval(progressTimer);
  }

  progressTimer = setInterval(() => {
    appendLine(prepLines[lineIndex]);
    lineIndex += 1;
    const progress = Math.min(60, Math.round((lineIndex / prepLines.length) * 60));
    setProgress(progress);

    if (lineIndex >= prepLines.length) {
      clearInterval(progressTimer);
      progressTimer = null;
      isPrepared = true;
      setStatus("En espera");
      loadDb.textContent = "Cargar a la base de datos";
      loadDb.disabled = false;
      loadDb.classList.add("btn--glow");
    }
  }, 360);
};

// ─── Función de envío adaptada a Supabase y Render ─────────────────────────
const uploadToDatabase = async (activeItem) => {
  const sourceRows = activeItem.fullRows || activeItem.rows || [];
  
  // Normalización estricta de las cabeceras a minúsculas para coincidir con PostgreSQL
  const estructuradoJSON = sourceRows.map((row) => {
    const obj = {};
    activeItem.headers.forEach((header, index) => {
      // Reemplaza espacios por guiones bajos si tu excel viene separado, y convierte a minúsculas
      const key = String(header).trim().toLowerCase().replace(/\s+/g, '_');
      obj[key] = row[index] !== undefined ? row[index] : null;
    });
    return obj;
  });

  try {
    // Reemplazada la URL estática por API_BASE_URL dinámica
    const respuesta = await fetch(`${API_BASE_URL}/api/cargar-excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tramites: estructuradoJSON })
    });

    const resultado = await respuesta.json();

    if (respuesta.ok && resultado.status === "OK") {
      alert(resultado.mensaje);
      return true;
    }
    throw new Error(resultado.mensaje || "Error en el servidor de base de datos.");
  } catch (error) {
    console.error("Error al inyectar a Supabase:", error);
    alert(`Error en la carga: ${error.message}`);
    return false;
  }
};

if (loadDb) {
  loadDb.addEventListener("click", async () => {
    if (loadDb.disabled) return;

    const activeItem = getActiveItem();

    if (!activeItem || !activeItem.rows || activeItem.rows.length === 0) {
      alert("No hay datos validos para subir.");
      return;
    }

    if (!isPrepared) {
      runPrepSimulation();
      return;
    }

    isLoading = true;
    updateLoadAvailability();
    setStatus("Cargando...");
    loadDb.textContent = "Conectando y cargando BBDD...";
    loadDb.classList.remove("btn--glow");

    let lineIndex = 0;
    const timer = setInterval(() => {
      const isLast = lineIndex === loadLines.length - 1;
      appendLine(loadLines[lineIndex], isLast ? "ok" : null);
      lineIndex += 1;
      const progress = Math.min(100, 60 + Math.round((lineIndex / loadLines.length) * 40));
      setProgress(progress);
      if (lineIndex >= loadLines.length) {
        clearInterval(timer);
      }
    }, 320);

    const delay = loadLines.length * 320 + 80;
    setTimeout(async () => {
      const success = await uploadToDatabase(activeItem);
      if (success) {
        appendSuccessBar();
        setStatus("Carga completa");
        loadDb.textContent = "✓ Carga completada";
      } else {
        setStatus("Error en carga");
        loadDb.textContent = "Error al cargar. Reintentar";
        loadDb.disabled = false;
        loadDb.classList.add("btn--glow");
      }
      isLoading = false;
      updateLoadAvailability();
    }, delay);
  });
}

updateStatusCards();
updateLoadAvailability();

const resetStoredData = () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("stagingActiveId");
  if (consoleBody) consoleBody.innerHTML = "";
  isPrepared = false;
  isLoading = false;
  setProgress(0);
  setStatus("En espera");
  updateLoadButton(false);
  updateStatusCards();
};

if (clearData) {
  clearData.addEventListener("click", resetStoredData);
}