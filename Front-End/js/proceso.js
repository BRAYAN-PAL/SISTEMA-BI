const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileTag = document.getElementById("fileTag");
const previewTable = document.getElementById("previewTable");
const previewTabs = document.getElementById("previewTabs");
const progressRing = document.getElementById("progressRing");
const progressValue = document.getElementById("progressValue");
const progressLabel = document.getElementById("progressLabel");
const headerBar = document.getElementById("headerBar");
const headerPercent = document.getElementById("headerPercent");
const statusUpload = document.getElementById("statusUpload");
const statusUploadText = document.getElementById("statusUploadText");
const statusSchema = document.getElementById("statusSchema");
const statusSchemaText = document.getElementById("statusSchemaText");
const clearData = document.getElementById("clearData");

const MAX_ROWS = 10;
const PROGRESS_MAX_DEG = 360;
let progressTimer = null;
const STORAGE_KEY = "stagingDataList";
const ACTIVE_KEY = "stagingActiveId";

const setFileLabel = (file) => {
  if (!file || !fileTag) return;
  fileTag.textContent = `Carga activa: ${file.name}`;
};

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

const setStatusLoading = () => {
  if (progressLabel) progressLabel.textContent = "Cargando...";
  if (statusUploadText) statusUploadText.textContent = "Subiendo datos...";
  if (statusSchemaText) statusSchemaText.textContent = "En espera de los datos.";
  if (statusUpload) {
    statusUpload.classList.remove("status__item--ok");
  }
  if (statusSchema) {
    statusSchema.classList.remove("status__item--ok");
  }
};

const setStatusComplete = () => {
  if (progressLabel) progressLabel.textContent = "Carga lista";
  if (statusUploadText) statusUploadText.textContent = "Datos cargados correctamente.";
  if (statusSchemaText) statusSchemaText.textContent = "Esquema extraido.";
  if (statusUpload) {
    statusUpload.classList.add("status__item--ok");
  }
  if (statusSchema) {
    statusSchema.classList.add("status__item--ok");
  }
};

const startProgressSimulation = () => {
  if (progressTimer) {
    clearInterval(progressTimer);
  }
  let progress = 0;
  setProgress(progress);
  setStatusLoading();

  progressTimer = setInterval(() => {
    const bump = Math.random() * 8 + 3;
    progress = Math.min(100, progress + bump);
    setProgress(progress);

    if (progress >= 100) {
      clearInterval(progressTimer);
      progressTimer = null;
      setStatusComplete();
    }
  }, 180);
};

const getStoredData = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const getActiveId = () => {
  return localStorage.getItem(ACTIVE_KEY);
};

const setActiveId = (id) => {
  if (!id) return;
  localStorage.setItem(ACTIVE_KEY, id);
};

const saveStoredData = (list) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn("No se pudo guardar en localStorage.");
  }
};

const clearPreview = () => {
  if (!previewTable) return;
  previewTable.innerHTML = "";
};

const renderTable = (headers, rows) => {
  if (!previewTable) return;
  previewTable.innerHTML = "";

  const headRow = document.createElement("div");
  headRow.className = "row row--head";
  headers.forEach((header) => {
    const cell = document.createElement("span");
    cell.textContent = header || "(Sin nombre)";
    headRow.appendChild(cell);
  });
  previewTable.appendChild(headRow);

  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    headers.forEach((header, index) => {
      const cell = document.createElement("span");
      const value = row[index];
      cell.textContent = value !== undefined && value !== null ? String(value) : "-";
      rowEl.appendChild(cell);
    });
    previewTable.appendChild(rowEl);
  });
};

const renderMessage = (message) => {
  if (!previewTable) return;
  previewTable.innerHTML = "";
  const messageRow = document.createElement("div");
  messageRow.className = "row";
  const cell = document.createElement("span");
  cell.textContent = message;
  cell.style.gridColumn = "1 / -1";
  messageRow.appendChild(cell);
  previewTable.appendChild(messageRow);
};

const parseCsv = (text) => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], fullRows: [], totalRows: 0 };
  const headers = lines[0].split(",").map((item) => item.trim());
  const totalRows = Math.max(0, lines.length - 1);
  const fullRows = lines.slice(1).map((line) => line.split(",").map((item) => item.trim()));
  const rows = fullRows.slice(0, MAX_ROWS);
  return { headers, rows, fullRows, totalRows };
};

const parseJson = (text) => {
  const data = JSON.parse(text);
  const rowsArray = Array.isArray(data) ? data : [data];
  if (rowsArray.length === 0) return { headers: [], rows: [], fullRows: [], totalRows: 0 };
  const headers = Object.keys(rowsArray[0]);
  const fullRows = rowsArray.map((item) => headers.map((key) => item[key]));
  const rows = fullRows.slice(0, MAX_ROWS);
  return { headers, rows, fullRows, totalRows: rowsArray.length };
};

const parseExcel = (data) => {
  if (!window.XLSX) return null;
  const workbook = window.XLSX.read(data, { type: "array", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  if (!rows.length) return { headers: [], rows: [], fullRows: [], totalRows: 0 };
  const headers = rows[0];
  const fullRows = rows.slice(1).map((row) => {
    return headers.map((header, index) => {
      const value = row[index];
      const headerKey = String(header || "").trim().toLowerCase();
      if (headerKey === "fecha" && typeof value === "number" && window.XLSX?.SSF) {
        const parsed = window.XLSX.SSF.parse_date_code(value);
        if (parsed) {
          const yyyy = String(parsed.y).padStart(4, "0");
          const mm = String(parsed.m).padStart(2, "0");
          const dd = String(parsed.d).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        }
      }
      if (headerKey === "fecha" && value instanceof Date) {
        return value.toISOString().slice(0, 10);
      }
      return value;
    });
  });
  const bodyRows = fullRows.slice(0, MAX_ROWS);
  return { headers, rows: bodyRows, fullRows, totalRows: Math.max(0, rows.length - 1) };
};

const renderTabs = (list, activeId) => {
  if (!previewTabs) return;
  previewTabs.innerHTML = "";

  if (!list || list.length === 0) return;

  list.forEach((item) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = item.id === activeId ? "tab tab--active" : "tab";
    tab.textContent = item.fileName;
    tab.addEventListener("click", () => {
      setActiveId(item.id);
      renderTabs(list, item.id);
      renderTable(item.headers, item.rows || []);
      if (fileTag) {
        fileTag.textContent = `Carga activa: ${item.fileName}`;
      }
    });
    previewTabs.appendChild(tab);
  });
};

const storeStagingData = (payload) => {
  const list = getStoredData() || [];
  list.push(payload);
  saveStoredData(list);
  setActiveId(payload.id);
  renderTabs(list, payload.id);
};

const readFileAsText = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};

const readFileAsArrayBuffer = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

const parseFile = async (file) => {
  const extension = file.name.split(".").pop().toLowerCase();
  if (["xlsx", "xls"].includes(extension)) {
    const buffer = await readFileAsArrayBuffer(file);
    return parseExcel(buffer);
  }
  if (extension === "csv") {
    const text = await readFileAsText(file);
    return parseCsv(text);
  }
  if (extension === "json") {
    const text = await readFileAsText(file);
    return parseJson(text);
  }
  return null;
};

const handleFiles = async (fileList) => {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  startProgressSimulation();

  for (const file of files) {
    try {
      const result = await parseFile(file);
      if (!result || !result.headers.length) {
        renderMessage(`No se encontraron datos para ${file.name}.`);
        continue;
      }
      const payload = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        headers: result.headers,
        rows: result.rows,
        fullRows: result.fullRows || result.rows,
        totalRows: result.totalRows ?? result.rows.length,
        fileName: file.name,
        validated: false,
      };
      storeStagingData(payload);
      renderTable(result.headers, result.rows);
      setFileLabel(file);
    } catch (error) {
      renderMessage(`No se pudo leer ${file.name}.`);
    }
  }
};

setProgress(0);

const restorePreview = () => {
  const list = getStoredData() || [];
  if (!list.length) return;
  const activeId = getActiveId() || list[list.length - 1].id;
  const activeItem = list.find((item) => item.id === activeId) || list[0];
  renderTabs(list, activeItem.id);
  renderTable(activeItem.headers, activeItem.rows || []);
  if (activeItem.fileName) {
    fileTag.textContent = `Carga activa: ${activeItem.fileName}`;
  }
  setProgress(100);
  setStatusComplete();
};

const resetStoredData = () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  clearPreview();
  if (previewTabs) previewTabs.innerHTML = "";
  if (fileTag) fileTag.textContent = "Carga activa: -";
  setProgress(0);
  if (progressLabel) progressLabel.textContent = "En espera";
  if (statusUploadText) statusUploadText.textContent = "Esperando archivo para iniciar.";
  if (statusSchemaText) statusSchemaText.textContent = "Pendiente de la carga completa.";
};

restorePreview();

if (clearData) {
  clearData.addEventListener("click", resetStoredData);
}

if (fileInput) {
  fileInput.addEventListener("change", (event) => {
    const files = event.target.files;
    handleFiles(files);
  });
}

if (dropZone) {
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-dragging");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    const files = event.dataTransfer && event.dataTransfer.files;
    handleFiles(files);
  });
}
