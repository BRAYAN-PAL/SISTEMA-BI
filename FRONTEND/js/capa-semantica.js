document.addEventListener("DOMContentLoaded", () => {
  const btnCalcularKpis = document.getElementById("btnCalcularKpis");
  const semanticConsole = document.getElementById("semanticConsole");

  // Elementos de la interfaz
  const kpiAtencion = document.getElementById("kpiAtencion");
  const kpiCongestion = document.getElementById("kpiCongestion");
  const kpiTiempo = document.getElementById("kpiTiempo");
  const kpiFecha = document.getElementById("kpiFecha");
  const tablaProductividad = document.getElementById("tablaProductividad");
  const openBi = document.getElementById("openBi");
  const finishProject = document.getElementById("finishProject");

  const BACKEND_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : `${window.location.protocol}//${window.location.host}`;

  const formatPercent = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : "0.00";
  };

  const formatNumber = (value, digits = 2) => {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(digits) : "0.00";
  };

  const setConsole = (message, color = "#f39c12") => {
    if (semanticConsole) {
      semanticConsole.innerHTML = `<span style="color: ${color};">[SEMÁNTICA] ${message}</span>`;
    }
  };

  const calcularKpis = async () => {
    if (btnCalcularKpis) {
      btnCalcularKpis.disabled = true;
      btnCalcularKpis.textContent = "Procesando SQL...";
    }
    setConsole(
      "Conectando con el Data Warehouse SQL Server... Ejecutando consultas analíticas.",
    );

    try {
      const respuesta = await fetch(`${BACKEND_URL}/api/semantica/calcular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const contentType = respuesta.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const rawText = await respuesta.text();
        throw new Error(rawText.slice(0, 200) || "Respuesta invalida del servidor.");
      }

      const resultado = await respuesta.json();

      if (!respuesta.ok || resultado.status !== "OK") {
        throw new Error(
          resultado.mensaje || "Error al calcular los KPIs de negocio.",
        );
      }

      // 1. Pintar los KPIs calculados en tiempo real
      if (kpiAtencion)
        kpiAtencion.textContent = `${formatPercent(resultado.data.asistencia)}%`;
      if (kpiCongestion)
        kpiCongestion.textContent = `${formatPercent(resultado.data.cancelacion)}%`;
      if (kpiTiempo)
        kpiTiempo.textContent = `${formatNumber(resultado.data.tiempoPromedio)} min`;
      if (kpiFecha) {
        const d = new Date();
        kpiFecha.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }

      // 2. Pintar la tabla de productividad por distrito
      if (tablaProductividad && resultado.data.productividad) {
        if (resultado.data.productividad.length === 0) {
          tablaProductividad.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:10px;">No se encontraron registros activos</td></tr>`;
        } else {
          tablaProductividad.innerHTML = resultado.data.productividad
            .map(
              (m) => `
            <tr style="border-bottom: 1px solid var(--soft);">
              <td style="padding: 8px; font-weight:600;">${m.Distrito || m.distrito || "-"}</td>
              <td style="padding: 8px; text-align: center; color: var(--blue); font-weight:700;">${m.TramitesAtendidos ?? m.Tramites ?? m.tramitesatendidos ?? 0}</td>
              <td style="padding: 8px; text-align: right; color: var(--muted); font-family:monospace;">${formatNumber(m.KPI_Productividad)}</td>
            </tr>
          `,
            )
            .join("");
        }
      }

      setConsole(
        "¡Éxito! KPIs almacenados en FactKPIs y matriz de productividad cargada correctamente.",
        "#2ecc71",
      );
    } catch (error) {
      console.error(error);
      setConsole(`Error en la consulta semántica: ${error.message}`, "#e74c3c");
    } finally {
      if (btnCalcularKpis) {
        btnCalcularKpis.disabled = false;
        btnCalcularKpis.textContent = "Calcular y Centralizar KPIs";
      }
    }
  };

  if (btnCalcularKpis) {
    btnCalcularKpis.addEventListener("click", calcularKpis);
  }

    if (openBi) {
    openBi.addEventListener("click", () => {
      setConsole("Abriendo Dashboard BI en Streamlit...", "#2ecc71");
      window.open("https://sistema-bi-reyzccyhbw35ooddidfemt.streamlit.app/", "_blank");
    });
  }

  if (finishProject) {
    finishProject.addEventListener("click", () => {
      alert("¡Proyecto Data Engine completado con éxito!");
      localStorage.removeItem("stagingDataList");
      localStorage.removeItem("stagingActiveId");
      window.location.href = "../index.html";
    });
  }
});
