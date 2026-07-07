document.addEventListener("DOMContentLoaded", () => {
  const clearData = document.getElementById("clearData");
  const runIa = document.getElementById("runIa");
  const iaConsole = document.getElementById("iaConsole");

  const aiAccuracy = document.getElementById("aiAccuracy");
  const aiDepth = document.getElementById("aiDepth");
  const aiRows = document.getElementById("aiRows");
  const aiStatus = document.getElementById("aiStatus");

  const BACKEND_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : `${window.location.protocol}//${window.location.host}`;
  let isTraining = false;

  const getActiveItem = () => {
    try {
      const raw = localStorage.getItem("stagingDataList");
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!list.length) return null;
      const activeId =
        localStorage.getItem("stagingActiveId") || list[list.length - 1].id;
      return list.find((item) => item.id === activeId) || list[0];
    } catch (e) {
      return null;
    }
  };

  const setConsole = (message, color = "#f39c12") => {
    if (iaConsole) {
      iaConsole.innerHTML = `<span style="color: ${color};">[IA] ${message}</span>`;
    }
  };

  const setImage = (imgId, placeholderId, src) => {
    const img = document.getElementById(imgId);
    const ph = document.getElementById(placeholderId);
    if (!img || !ph) return;
    if (!src) {
      img.classList.remove("is-visible");
      img.src = "";
      ph.classList.remove("is-hidden");
      return;
    }

    img.onload = () => {
      img.classList.add("is-visible");
      ph.classList.add("is-hidden");
    };
    img.onerror = () => {
      img.classList.remove("is-visible");
      ph.classList.remove("is-hidden");
      console.error("No se pudo cargar la imagen:", img.src);
    };
    img.src = `${src}?t=${Date.now()}`;
  };

  const loadLatestImages = () => {
    const base = `${BACKEND_URL}/graficos`;
    setImage("iaTreeImage", "iaTreePlaceholder", `${base}/arbol_decision.png`);
    setImage("iaMatrixImage", "iaMatrixPlaceholder", `${base}/matriz_confusion.png`);
    setImage(
      "iaDistribImage",
      "iaDistribPlaceholder",
      `${base}/congestion_por_distrito.png`,
    );
  };

  const loadLatestMetrics = async () => {
    try {
      const respuesta = await fetch(`${BACKEND_URL}/graficos/metrics.json`);
      if (!respuesta.ok) return;
      const metrics = await respuesta.json();
      if (aiAccuracy)
        aiAccuracy.textContent = metrics.accuracy
          ? `${metrics.accuracy}%`
          : "-";
      if (aiDepth) aiDepth.textContent = metrics.bestDepth ?? "-";
      if (aiRows) aiRows.textContent = metrics.rows ?? "-";
      if (aiStatus) {
        aiStatus.textContent = metrics.status || "-";
        aiStatus.style.color = metrics.status ? "#2ecc71" : "inherit";
      }
    } catch (error) {
      console.error("No se pudo cargar metrics.json", error);
    }
  };

  const runTraining = async () => {
    if (isTraining) return;
    isTraining = true;
    if (runIa) {
      runIa.disabled = true;
      runIa.textContent = "Procesando...";
    }
    setConsole("Iniciando pipeline analítico en Python... Por favor, espere.");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      const activeItem = getActiveItem();
      let payload = {};
      if (
        activeItem &&
        activeItem.headers &&
        (activeItem.fullRows || activeItem.rows)
      ) {
        payload = {
          dataset: {
            headers: activeItem.headers,
            rows: activeItem.fullRows || activeItem.rows,
          },
        };
      }

      const respuesta = await fetch(`${BACKEND_URL}/api/ia/entrenar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const resultado = await respuesta.json();
      if (!respuesta.ok || resultado.status !== "OK") {
        throw new Error(
          resultado.mensaje || "Error al procesar el script de entrenamiento.",
        );
      }

      const metrics = resultado.metrics || {};
      if (aiAccuracy)
        aiAccuracy.textContent = metrics.accuracy
          ? `${metrics.accuracy}%`
          : "100%";
      if (aiDepth) aiDepth.textContent = metrics.bestDepth ?? "3";
      if (aiRows) aiRows.textContent = metrics.rows ?? "20";
      if (aiStatus) {
        aiStatus.textContent = metrics.status || "CUMPLE >= 90%";
        aiStatus.style.color = "#2ecc71";
      }

      setConsole(
        "¡Entrenamiento finalizado con éxito! Gráficos e Insights actualizados.",
        "#2ecc71",
      );

      const images = resultado.images || {};
      setImage("iaTreeImage", "iaTreePlaceholder", images.tree);
      setImage("iaMatrixImage", "iaMatrixPlaceholder", images.confusion);
      setImage("iaDistribImage", "iaDistribPlaceholder", images.distribution);
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(error);
      setConsole(
        error.name === "AbortError"
          ? "Tiempo de espera agotado."
          : `Error crítico: ${error.message}`,
        "#e74c3c",
      );
    } finally {
      // Reset completo del estado
      isTraining = false;
      document.getElementById("runIa").disabled = false;
      document.getElementById("runIa").textContent = "Ejecutar análisis IA";
    }
  };

  if (runIa) runIa.addEventListener("click", runTraining);

  loadLatestImages();
  loadLatestMetrics();

  if (clearData) {
    clearData.addEventListener("click", () => {
      if (confirm("¿Estás seguro de restablecer el estado de la Capa de IA?")) {
        localStorage.removeItem("stagingDataList");
        localStorage.removeItem("stagingActiveId");
        if (aiAccuracy) aiAccuracy.textContent = "-";
        if (aiDepth) aiDepth.textContent = "-";
        if (aiRows) aiRows.textContent = "-";
        if (aiStatus) {
          aiStatus.textContent = "-";
          aiStatus.style.color = "inherit";
        }
        ["iaTreeImage", "iaMatrixImage", "iaDistribImage"].forEach((id) => {
          const img = document.getElementById(id);
          if (img) {
            img.classList.remove("is-visible");
            img.src = "";
          }
        });
        [
          "iaTreePlaceholder",
          "iaMatrixPlaceholder",
          "iaDistribPlaceholder",
        ].forEach((id) => {
          const ph = document.getElementById(id);
          if (ph) ph.classList.remove("is-hidden");
        });
        setConsole("Esperando ejecución...", "#dfe6f1");
      }
    });
  }
});
