const exportBtn = document.getElementById("exportBtn");
const revalidateBtn = document.getElementById("revalidateBtn");
const validationTable = document.getElementById("validationTable");
const tableFooter = document.getElementById("tableFooter");
const tableLoading = document.getElementById("tableLoading");
const metricColumns = document.getElementById("metricColumns");
const metricRows = document.getElementById("metricRows");
const metricScore = document.getElementById("metricScore");
const stagingTabs = document.getElementById("stagingTabs");

const MAX_ROWS = 10;
const STORAGE_KEY = "stagingDataList";
const ACTIVE_KEY = "stagingActiveId";

const getStoredData = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const saveStoredData = (list) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn("No se pudo guardar en localStorage.");
  }
};

const getActiveId = () => localStorage.getItem(ACTIVE_KEY);

const setActiveId = (id) => {
  if (!id) return;
  localStorage.setItem(ACTIVE_KEY, id);
};

const formatNumber = (value) => {
  return new Intl.NumberFormat("es-ES").format(value || 0);
};

const getValidationScore = (rows, forceValid = false) => {
  if (!rows || rows.length === 0) return 0;
  if (forceValid) return 100;
  const pendingCount = rows.filter((_, index) => index % 4 === 1).length;
  const validCount = rows.length - pendingCount;
  return Math.round((validCount / rows.length) * 100);
};

const renderMetrics = (data, forceValid = false) => {
  const columns = data?.headers?.length || 0;
  const totalRows = data?.totalRows || 0;
  const rows = data?.rows || [];
  const score = totalRows > 0 ? getValidationScore(rows, forceValid) : 0;

  if (metricColumns) {
    metricColumns.innerHTML = `${columns} <span>columnas</span>`;
  }
  if (metricRows) {
    metricRows.innerHTML = `${formatNumber(totalRows)} <span>filas</span>`;
  }
  if (metricScore) {
    metricScore.innerHTML = `${score}% <span>${score ? "OK" : "En espera"}</span>`;
  }
};

const renderTabs = (list, activeId) => {
  if (!stagingTabs) return;
  stagingTabs.innerHTML = "";
  if (!list || list.length === 0) return;

  list.forEach((item) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = item.id === activeId ? "tab tab--active" : "tab";
    tab.textContent = item.fileName;
    tab.addEventListener("click", () => {
      setActiveId(item.id);
      renderTabs(list, item.id);
      renderMetrics(item, item.validated);
      renderTable(item, item.validated);
    });
    stagingTabs.appendChild(tab);
  });
};

const renderTable = (data, forceValid = false) => {
  if (!validationTable) return;
  validationTable.innerHTML = "";

  if (!data || !data.headers || !data.headers.length) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "table__row";
    const cell = document.createElement("span");
    cell.textContent = "Sin datos para validar. Carga un archivo primero.";
    cell.style.gridColumn = "1 / -1";
    emptyRow.appendChild(cell);
    validationTable.appendChild(emptyRow);
    if (tableFooter) tableFooter.textContent = "Mostrando 0 de 0 registros";
    return;
  }

  const headers = [...data.headers, "Estado"];
  const headRow = document.createElement("div");
  headRow.className = "table__row table__row--head";
  headers.forEach((header) => {
    const cell = document.createElement("span");
    cell.textContent = header || "(Sin nombre)";
    headRow.appendChild(cell);
  });
  validationTable.appendChild(headRow);

  const rows = (data.rows || []).slice(0, MAX_ROWS);
  rows.forEach((row, index) => {
    const rowEl = document.createElement("div");
    rowEl.className = "table__row";
    data.headers.forEach((header, colIndex) => {
      const cell = document.createElement("span");
      const value = row[colIndex];
      cell.textContent = value !== undefined && value !== null ? String(value) : "-";
      rowEl.appendChild(cell);
    });

    const statusCell = document.createElement("span");
    const isPending = !forceValid && index % 4 === 1;
    statusCell.className = isPending ? "tag tag--warn" : "tag tag--ok";
    statusCell.textContent = isPending ? "Pendiente" : "Valido";
    rowEl.appendChild(statusCell);
    validationTable.appendChild(rowEl);
  });

  if (tableFooter) {
    tableFooter.textContent = `Mostrando ${rows.length} de ${formatNumber(data.totalRows || rows.length)} registros`;
  }
};

const setLoading = (isLoading) => {
  if (!tableLoading) return;
  tableLoading.classList.toggle("is-visible", isLoading);
};

const simulateRevalidate = () => {
  setLoading(true);
  setTimeout(() => {
    setLoading(false);
    const list = getStoredData() || [];
    const activeId = getActiveId() || (list[0] && list[0].id);
    const activeItem = list.find((item) => item.id === activeId);
    if (activeItem) {
      activeItem.validated = true;
      saveStoredData(list);
      renderMetrics(activeItem, true);
      renderTable(activeItem, true);
      renderTabs(list, activeItem.id);
    }
  }, 900);
};

const exportCsv = (data) => {
  if (!data || !data.headers || !data.headers.length) return;
  const rows = data.rows || [];
  const csvLines = [
    data.headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "validacion_datos.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const init = () => {
  const list = getStoredData() || [];
  if (!list.length) {
    renderMetrics(null);
    renderTable(null);
    return;
  }
  const activeId = getActiveId() || list[list.length - 1].id;
  const activeItem = list.find((item) => item.id === activeId) || list[0];
  renderTabs(list, activeItem.id);
  renderMetrics(activeItem, activeItem.validated);
  renderTable(activeItem, activeItem.validated);
};

if (revalidateBtn) {
  revalidateBtn.addEventListener("click", simulateRevalidate);
}

if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    const list = getStoredData() || [];
    const activeId = getActiveId() || (list[0] && list[0].id);
    const activeItem = list.find((item) => item.id === activeId);
    exportCsv(activeItem);
  });
}

init();
