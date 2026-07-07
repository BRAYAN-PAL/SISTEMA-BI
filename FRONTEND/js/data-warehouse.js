const schema = document.querySelector(".schema");
const clearData = document.getElementById("clearData");

// Mantener tu evento original para borrar datos locales
if (clearData) {
  clearData.addEventListener("click", () => {
    localStorage.removeItem("stagingDataList");
    localStorage.removeItem("stagingActiveId");
    alert("Datos locales limpiados correctamente.");
    window.location.reload();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!schema) return;

  try {
    // 1. Extraer el diccionario de datos real de SQL Server
    const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3000"
      : `${window.location.protocol}//${window.location.host}`;
    const respuesta = await fetch(`${API_BASE}/api/obtener-esquema`);
    const resultado = await respuesta.json();

    if (resultado.status !== "OK") {
      throw new Error(resultado.mensaje);
    }

    const datosEsquema = resultado.datos;

    // Limpiamos el contenedor para redibujar el diagrama físico
    schema.innerHTML = "";
    
    // Forzar contenedor con posicionamiento relativo para el mapa de conexiones
    schema.style.position = "relative";
    schema.style.minHeight = "650px";
    schema.style.width = "100%";

    // =========================================================================
    // MODIFICACIÓN DE COORDENADAS: Se sumaron píxeles en el eje X (hacia la derecha) 
    // a todas las tablas para desplazar el diagrama completo de forma uniforme.
    // =========================================================================
    const diseñoCopoNieve = [
      { nombre: 'fact_tramites', clase: 'card--fact', id: 'factTramites', x: 680, y: 220 }, // CENTRO (Antes 380)
      { nombre: 'dim_tramite', clase: 'card--dim', id: 'dimTramite', x: 680, y: 30 },       // ARRIBA (Antes 380)
      { nombre: 'dim_tipo_tramite', clase: 'card--dim', id: 'dimTipoTramite', x: 680, y: -130 }, // ARRIBA - Extensión (Antes 380)
      { nombre: 'dim_geografia', clase: 'card--dim', id: 'dimGeografia', x: 350, y: 240 },   // IZQUIERDA (Antes 50)
      { nombre: 'dim_estado', clase: 'card--dim', id: 'dimEstado', x: 1000, y: 150 },       // DERECHA SUPERIOR (Antes 700)
      { nombre: 'dim_tiempo', clase: 'card--dim', id: 'dimTiempo', x: 1000, y: 340 }        // DERECHA INFERIOR (Antes 700)
    ];

    // 3. Renderizar las tarjetas en sus posiciones relacionales exactas
    diseñoCopoNieve.forEach(tabla => {
      const columnas = datosEsquema[tabla.nombre] || ["(Sin columnas)"];

      const article = document.createElement("article");
      article.className = `card ${tabla.clase}`;
      article.id = tabla.id;
      
      // Aplicamos estilos de posicionamiento absoluto como un plano cartesiano (Diagrama de SSMS)
      article.style.position = "absolute";
      article.style.left = `${tabla.x}px`;
      article.style.top = `${tabla.y}px`;
      article.style.width = "240px";
      article.style.zIndex = "10";

      const titleDiv = document.createElement("div");
      titleDiv.className = "card__title";
      titleDiv.style.fontWeight = "bold";
      titleDiv.style.textAlign = "center";
      titleDiv.textContent = tabla.nombre;
      article.appendChild(titleDiv);

      const ul = document.createElement("ul");
      ul.style.listStyle = "none";
      ul.style.padding = "5px 10px";
      ul.style.margin = "0";

      columnas.forEach(columna => {
        const li = document.createElement("li");
        li.style.padding = "3px 0";
        li.style.fontSize = "13px";
        
        // Corrección estética para cambiar visualmente 'anio' por 'año'
        let nombreColumnaVisual = columna;
        if (columna === 'anio') {
          nombreColumnaVisual = 'año';
        }

        // Formatear visualmente llaves primarias y foráneas usando el nombre corregido
        if (columna.startsWith("id_") || columna.startsWith("sk_") || columna === "fecha") {
          li.innerHTML = `🔑 <span style="color: #f1c40f; font-weight: 600;">${nombreColumnaVisual}</span>`;
        } else {
          li.innerHTML = `🔹 ${nombreColumnaVisual}`;
        }
        ul.appendChild(li);
      });
      
      article.appendChild(ul);
      schema.appendChild(article);
    });

    // 4. Crear un lienzo SVG transparente por debajo para dibujar las líneas de unión (Foreign Keys)
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.zIndex = "1";
    svg.style.pointerEvents = "none"; // Evita que bloquee clics en las tarjetas

    // Definición de las líneas que conectan tus llaves foráneas reales
    const relaciones = [
      { de: 'factTramites', a: 'dimTramite' },
      { de: 'dimTramite', a: 'dimTipoTramite' }, 
      { de: 'factTramites', a: 'dimGeografia' },
      { de: 'factTramites', a: 'dimEstado' },
      { de: 'factTramites', a: 'dimTiempo' }
    ];

    // Calcular y dibujar las conexiones en caliente basados en las nuevas coordenadas desplazadas
    setTimeout(() => {
      relaciones.forEach(rel => {
        const elDe = document.getElementById(rel.de);
        const elA = document.getElementById(rel.a);

        if (elDe && elA) {
          const x1 = elDe.offsetLeft + (elDe.offsetWidth / 2);
          const y1 = elDe.offsetTop + (elDe.offsetHeight / 2);
          const x2 = elA.offsetLeft + (elA.offsetWidth / 2);
          const y2 = elA.offsetTop + (elA.offsetHeight / 2);

          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", x1);
          line.setAttribute("y1", y1);
          line.setAttribute("x2", x2);
          line.setAttribute("y2", y2);
          
          line.setAttribute("stroke", "rgba(46, 196, 182, 0.6)"); 
          line.setAttribute("stroke-width", "2");
          line.setAttribute("stroke-dasharray", "4,4"); // Estilo punteado SQL
          
          svg.appendChild(line);
        }
      });
    }, 50);

    schema.appendChild(svg);

    // Activamos tu animación de carga CSS original
    schema.classList.add("is-loaded");

  } catch (error) {
    console.error("Error al renderizar el esquema dinámico:", error);
    schema.innerHTML = `
      <div style="color: #ff4d4d; padding: 20px; background: rgba(255,0,0,0.1); border-radius: 8px; width:100%; text-align:center;">
        <strong>Error al mapear el diagrama físico:</strong> ${error.message}
      </div>
    `;
    schema.classList.add("is-loaded");
  }
});