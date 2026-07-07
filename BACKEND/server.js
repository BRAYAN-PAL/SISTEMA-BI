const express = require("express");
const { Pool } = require("pg"); // Cambiado mssql por pg (PostgreSQL)
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();

// ==========================================
// CONFIGURACIÓN
// ==========================================

const PORT = 3000;
const ML_DIR = path.join(__dirname, "..", "ML");
const ML_OUTPUT_DIR = path.join(ML_DIR, "output");

// Configuración para Supabase (Usa la URI de conexión que te da Supabase)
const dbConfig = {
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:tu_password_aqui@db.your-supabase-id.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false } // Requerido para conexiones seguras con Supabase en la nube
};

const pool = new Pool(dbConfig);

// ==========================================
// FUNCIÓN PARA INICIALIZAR BD AUTOMÁTICAMENTE
// ==========================================

async function inicializarBaseDeDatos() {
  const client = await pool.connect();
  try {
    console.log("[BD] Inicializando esquema de base de datos...");

    await client.query(`CREATE TABLE IF NOT EXISTS dim_tipo_tramite (
      id_tipo_tramite SERIAL PRIMARY KEY, tipo_tramite VARCHAR(100) NOT NULL UNIQUE
    );`);
    await client.query(`CREATE TABLE IF NOT EXISTS dim_tramite (
      sk_tramite SERIAL PRIMARY KEY, id_tramite INT NOT NULL UNIQUE,
      id_tipo_tramite INT REFERENCES dim_tipo_tramite(id_tipo_tramite)
    );`);
    await client.query(`CREATE TABLE IF NOT EXISTS dim_geografia (
      id_distrito SERIAL PRIMARY KEY, distrito VARCHAR(100) NOT NULL UNIQUE
    );`);
    await client.query(`CREATE TABLE IF NOT EXISTS dim_estado (
      id_estado SERIAL PRIMARY KEY, estado VARCHAR(50) NOT NULL UNIQUE
    );`);
    await client.query(`CREATE TABLE IF NOT EXISTS dim_tiempo (
      fecha DATE PRIMARY KEY, anio INT, mes INT, dia INT, dia_semana VARCHAR(20)
    );`);
    await client.query(`CREATE TABLE IF NOT EXISTS fact_tramites (
      id_fact SERIAL PRIMARY KEY,
      sk_tramite INT REFERENCES dim_tramite(sk_tramite),
      id_distrito INT REFERENCES dim_geografia(id_distrito),
      fecha DATE REFERENCES dim_tiempo(fecha),
      id_estado INT REFERENCES dim_estado(id_estado),
      personas_cola INT, tiempo_espera_min INT, ventanillas INT,
      promedio_atencion DECIMAL(5,2), personas_por_ventanilla DECIMAL(5,2),
      nivel_congestion VARCHAR(50)
    );`);
    await client.query(`CREATE TABLE IF NOT EXISTS staging_tramitacion (
      id_tramite INT, distrito VARCHAR(100), tipo_tramite VARCHAR(100),
      fecha DATE, personas_cola INT, tiempo_espera_min INT, ventanillas INT,
      estado VARCHAR(50), promedio_atencion DECIMAL(5,2),
      personas_por_ventanilla DECIMAL(5,2), nivel_congestion VARCHAR(50)
    );`);

    // Función ETL equivalente al SP de SQL Server
    await client.query(`
      CREATE OR REPLACE FUNCTION sp_CargarModeloCopoNieve()
      RETURNS VOID LANGUAGE plpgsql AS $$
      BEGIN
        SET CONSTRAINTS ALL DEFERRED;
        DELETE FROM fact_tramites; DELETE FROM dim_tramite;
        DELETE FROM dim_tipo_tramite; DELETE FROM dim_geografia;
        DELETE FROM dim_estado; DELETE FROM dim_tiempo;
        PERFORM setval('dim_tipo_tramite_id_tipo_tramite_seq', 1, false);
        PERFORM setval('dim_tramite_sk_tramite_seq', 1, false);
        PERFORM setval('dim_geografia_id_distrito_seq', 1, false);
        PERFORM setval('dim_estado_id_estado_seq', 1, false);
        PERFORM setval('fact_tramites_id_fact_seq', 1, false);
        SET CONSTRAINTS ALL IMMEDIATE;

        INSERT INTO dim_tipo_tramite (tipo_tramite)
        SELECT DISTINCT tipo_tramite FROM staging_tramitacion WHERE tipo_tramite IS NOT NULL;
        INSERT INTO dim_tramite (id_tramite, id_tipo_tramite)
        SELECT DISTINCT st.id_tramite, dtt.id_tipo_tramite
        FROM staging_tramitacion st JOIN dim_tipo_tramite dtt ON st.tipo_tramite = dtt.tipo_tramite
        WHERE st.id_tramite IS NOT NULL;
        INSERT INTO dim_geografia (distrito)
        SELECT DISTINCT distrito FROM staging_tramitacion WHERE distrito IS NOT NULL;
        INSERT INTO dim_estado (estado)
        SELECT DISTINCT estado FROM staging_tramitacion WHERE estado IS NOT NULL;
        INSERT INTO dim_tiempo (fecha, anio, mes, dia, dia_semana)
        SELECT DISTINCT fecha, EXTRACT(YEAR FROM fecha)::INT, EXTRACT(MONTH FROM fecha)::INT,
          EXTRACT(DAY FROM fecha)::INT, TO_CHAR(fecha, 'FMDay')
        FROM staging_tramitacion WHERE fecha IS NOT NULL;
        INSERT INTO fact_tramites (sk_tramite, id_distrito, fecha, id_estado,
          personas_cola, tiempo_espera_min, ventanillas,
          promedio_atencion, personas_por_ventanilla, nivel_congestion)
        SELECT dt.sk_tramite, dg.id_distrito, dtm.fecha, de.id_estado,
          st.personas_cola, st.tiempo_espera_min, st.ventanillas,
          st.promedio_atencion, st.personas_por_ventanilla, st.nivel_congestion
        FROM staging_tramitacion st
        JOIN dim_tramite dt ON st.id_tramite = dt.id_tramite
        JOIN dim_geografia dg ON st.distrito = dg.distrito
        JOIN dim_estado de ON st.estado = de.estado
        JOIN dim_tiempo dtm ON st.fecha = dtm.fecha;
        TRUNCATE TABLE staging_tramitacion;
      END;
      $$;
    `);
    console.log("[BD] Esquema de base de datos inicializado correctamente.");
  } catch (error) {
    console.error("[BD] Error al inicializar esquema:", error.message);
  } finally {
    client.release();
  }
}

// ==========================================
// MIDDLEWARES
// ==========================================

app.use(express.json({ limit: "50mb" }));
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500", "http://localhost:3000"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

// ==========================================
// STATIC FILES
// ==========================================

if (!fs.existsSync(ML_OUTPUT_DIR)) {
  fs.mkdirSync(ML_OUTPUT_DIR, { recursive: true });
}

app.use("/graficos", express.static(ML_OUTPUT_DIR));
app.use(express.static(path.join(__dirname, "../FRONTEND")));

// ==========================================
// RUTAS
// ==========================================

app.get("/", (req, res) => res.redirect("/html/index.html"));

app.get("/html/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../FRONTEND/html/index.html"));
});

// ─── Cargar Excel (Adaptado a PostgreSQL / Supabase) ─────────────────────────
app.post("/api/cargar-excel", async (req, res) => {
  const { tramites } = req.body;

  if (!tramites || !Array.isArray(tramites)) {
    return res.status(400).json({ status: "Error", mensaje: "Estructura de datos inválida." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // 1. Limpiar tabla staging
    await client.query("TRUNCATE TABLE staging_tramitacion");

    // 2. Inserción masiva compatible con PostgreSQL mediante bloques parametrizados
    if (tramites.length > 0) {
      const insertQuery = `
        INSERT INTO staging_tramitacion (
          id_tramite, distrito, tipo_tramite, fecha, personas_cola, 
          tiempo_espera_min, ventanillas, estado, promedio_atencion, 
          personas_por_ventanilla, nivel_congestion
        ) VALUES ${tramites.map((_, i) => `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, $${i * 11 + 11})`).join(",")}
      `;

      const values = [];
      tramites.forEach((t) => {
        values.push(
          t.id_tramite ? parseInt(t.id_tramite, 10) : null,
          t.distrito ? String(t.distrito).trim() : null,
          t.tipo_tramite ? String(t.tipo_tramite).trim() : null,
          t.fecha ? new Date(t.fecha).toISOString().slice(0, 10) : null,
          t.personas_cola && !isNaN(t.personas_cola) ? parseInt(t.personas_cola, 10) : 0,
          t.tiempo_espera_min && !isNaN(t.tiempo_espera_min) ? parseInt(t.tiempo_espera_min, 10) : 0,
          t.ventanillas && !isNaN(t.ventanillas) ? parseInt(t.ventanillas, 10) : 0,
          t.estado ? String(t.estado).trim() : null,
          t.promedio_atencion && !isNaN(t.promedio_atencion) ? parseFloat(t.promedio_atencion) : 0.0,
          t.personas_por_ventanilla && !isNaN(t.personas_por_ventanilla) ? parseFloat(t.personas_por_ventanilla) : 0.0,
          t.nivel_congestion ? String(t.nivel_congestion).trim() : null
        );
      });

      await client.query(insertQuery, values);
    }

    // 3. Ejecutar función/procedimiento en Postgres (Asegúrate de migrar tu SP a Supabase como Función)
    await client.query("SELECT sp_CargarModeloCopoNieve()");

    await client.query("COMMIT");
    res.json({ status: "OK", mensaje: "¡Base de datos reescrita exitosamente!" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error crítico en el backend:", error);
    res.status(500).json({ status: "Error", mensaje: `Error: ${error.message}` });
  } finally {
    client.release();
  }
});

// ─── Obtener esquema (Adaptado a PostgreSQL) ──────────────────────
app.get("/api/obtener-esquema", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name IN ('fact_tramites', 'dim_tramite', 'dim_tipo_tramite', 'dim_geografia', 'dim_estado', 'dim_tiempo')
      ORDER BY table_name, ordinal_position;
    `);

    const esquema = {};
    result.rows.forEach((row) => {
      // PostgreSQL retorna en minúsculas por defecto
      const tableName = row.table_name;
      const columnName = row.column_name;
      if (!esquema[tableName]) esquema[tableName] = [];
      esquema[tableName].push(columnName);
    });

    res.json({ status: "OK", datos: esquema });
  } catch (error) {
    res.status(500).json({ status: "Error", mensaje: error.message });
  }
});

// ─── Entrenamiento IA (Adaptado a PostgreSQL) ─────────────────────
app.post("/api/ia/entrenar", async (req, res) => {
  let responseSent = false;
  const safeError = (status, mensaje) => {
    if (!responseSent) { responseSent = true; res.status(status).json({ status: "Error", mensaje }); }
  };

  try {
    console.log("[IA] Solicitud de entrenamiento recibida.");
    const { dataset } = req.body || {};
    const csvPath = path.join(ML_OUTPUT_DIR, "dataset.csv");

    if (dataset && Array.isArray(dataset.headers) && Array.isArray(dataset.rows)) {
      const headers = dataset.headers.map((h) => String(h).trim().toLowerCase());
      const rows = dataset.rows.map((row) => {
        const obj = {};
        headers.forEach((header, index) => { obj[header] = row[index] !== undefined ? row[index] : null; });
        return obj;
      });
      if (!rows.length) return safeError(400, "El archivo cargado no contiene filas para entrenar.");
      writeCsv(rows, csvPath);
      console.log(`[IA] Filas cargadas desde Proceso: ${rows.length}`);
    } else {
      const result = await pool.query(`
        SELECT dtm.id_tramite, dtt.tipo_tramite, dg.distrito, de.estado, ft.fecha,
          ft.personas_cola, ft.tiempo_espera_min, ft.ventanillas,
          ft.promedio_atencion, ft.personas_por_ventanilla, ft.nivel_congestion
        FROM fact_tramites ft
        JOIN dim_tramite dtm ON ft.sk_tramite = dtm.sk_tramite
        JOIN dim_tipo_tramite dtt ON dtm.id_tipo_tramite = dtt.id_tipo_tramite
        JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
        JOIN dim_estado de ON ft.id_estado = de.id_estado
      `);
      if (!result.rows.length) return safeError(400, "No hay datos en fact_tramites para entrenar.");
      writeCsv(result.rows, csvPath);
      console.log(`[IA] Filas exportadas desde Supabase: ${result.rows.length}`);
    }

    const scriptPath = path.join(ML_DIR, "train_congestion.py");
    const pythonCmd = process.env.PYTHON_CMD || "python";
    console.log(`[IA] Ejecutando: ${pythonCmd} ${scriptPath}`);

    const proc = spawn(pythonCmd, [scriptPath, csvPath, ML_OUTPUT_DIR], { cwd: ML_DIR });

    proc.stdout.on("data", (data) => console.log(`[IA][PY] ${data.toString().trim()}`));
    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data.toString(); console.error(`[IA][PY-ERR] ${data.toString().trim()}`); });

    proc.on("close", (code) => {
      if (responseSent) return;
      const metricsPath = path.join(ML_OUTPUT_DIR, "metrics.json");

      if (code !== 0 && !fs.existsSync(metricsPath)) return safeError(500, stderr || "Fallo al ejecutar el entrenamiento.");
      if (!fs.existsSync(metricsPath)) return safeError(500, "No se generó metrics.json.");

      let metrics;
      try { metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8")); }
      catch (e) { return safeError(500, "Error al leer metrics.json: " + e.message); }

      const treePath = path.join(ML_OUTPUT_DIR, "arbol_decision.png");
      const matrixPath = path.join(ML_OUTPUT_DIR, "matriz_confusion.png");
      const distPath = path.join(ML_OUTPUT_DIR, "congestion_por_distrito.png");

      responseSent = true;
      res.json({
        status: "OK",
        metrics,
        images: {
          tree: fs.existsSync(treePath) ? "/graficos/arbol_decision.png" : null,
          confusion: fs.existsSync(matrixPath) ? "/graficos/matriz_confusion.png" : null,
          distribution: fs.existsSync(distPath) ? "/graficos/congestion_por_distrito.png" : null,
        }
      });
    });

    proc.on("error", (err) => safeError(500, `No se pudo iniciar Python: ${err.message}`));
  } catch (error) {
    console.error("Error al ejecutar la capa IA:", error);
    safeError(500, error.message);
  }
});

// ─── KPIs Semántica (Adaptado a PostgreSQL) ──────────────────────
app.post("/api/semantica/calcular", async (req, res) => {
  console.log("[Semántica] Solicitud de cálculo de KPIs recibida.");
  try {
    // Crear tabla si no existe usando sintaxis estándar de Postgres
    await pool.query(`
      CREATE TABLE IF NOT EXISTS FactKPIs(
        KPIKey SERIAL PRIMARY KEY,
        NombreKPI VARCHAR(100),
        Valor DECIMAL(10,2),
        Meta DECIMAL(10,2),
        FechaCalculo TIMESTAMP DEFAULT NOW()
      );
    `);

    const totalRes = await pool.query("SELECT COUNT(*) AS total FROM fact_tramites;");
    const total = parseInt(totalRes.rows[0]?.total || 0, 10);
    if (!total) return res.status(400).json({ status: "ERROR", mensaje: "No hay registros en fact_tramites." });

    const atendidasRes = await pool.query(
      "SELECT COUNT(*) AS atendidas FROM fact_tramites WHERE UPPER(nivel_congestion) IN ('BAJA', 'MEDIA');"
    );
    const canceladasRes = await pool.query(
      "SELECT COUNT(*) AS canceladas FROM fact_tramites WHERE UPPER(nivel_congestion) = 'ALTA';"
    );
    const tiempoRes = await pool.query(
      "SELECT AVG(tiempo_espera_min::numeric) AS avgtiempo FROM fact_tramites;"
    );

    const asistenciaVal = (parseInt(atendidasRes.rows[0]?.atendidas || 0, 10) * 100.0) / total;
    const cancelacionVal = (parseInt(canceladasRes.rows[0]?.canceladas || 0, 10) * 100.0) / total;
    const tiempoVal = parseFloat(tiempoRes.rows[0]?.avgtiempo || 0);

    await pool.query(`
      INSERT INTO FactKPIs (NombreKPI, Valor, Meta, FechaCalculo)
      VALUES
        ('Tasa Asistencia', ${asistenciaVal}, 85, NOW()),
        ('Tasa Cancelacion', ${cancelacionVal}, 10, NOW()),
        ('Tiempo Promedio', ${tiempoVal}, 30, NOW());
    `);

    const qProductividad = await pool.query(`
      SELECT dg.distrito AS Distrito, COUNT(*) AS TramitesAtendidos,
        COUNT(*)::numeric AS KPI_Productividad
      FROM fact_tramites ft
      JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
      GROUP BY dg.distrito
      ORDER BY KPI_Productividad DESC
      LIMIT 5;
    `);

    console.log("[Semántica] KPIs calculados y centralizados en FactKPIs con éxito.");
    res.json({
      status: "OK",
      mensaje: "KPIs orquestados y grabados en el Data Warehouse.",
      data: {
        asistencia: asistenciaVal,
        cancelacion: cancelacionVal,
        tiempoPromedio: tiempoVal,
        productividad: qProductividad.rows,
      }
    });
  } catch (err) {
    console.error("[Semántica] Error en base de datos:", err.message);
    res.status(500).json({ status: "ERROR", mensaje: err.message });
  }
});

// ─── Descargar PBIX ───────────────────────
app.get("/api/bi/diagrama", (req, res) => {
  const pbixPath = path.join(__dirname, "..", "BI", "PROYECT.PBIX");
  if (!fs.existsSync(pbixPath)) {
    return res.status(404).json({ status: "ERROR", mensaje: "PBIX no encontrado." });
  }
  res.download(pbixPath, "PROYECT.PBIX");
});

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

const toCsvValue = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const writeCsv = (rows, filePath) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(headers.map((key) => toCsvValue(row[key])).join(",")));
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
};

// ==========================================
// INICIO DEL SERVIDOR
// ==========================================

inicializarBaseDeDatos().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
    console.log(`Frontend disponible en http://localhost:${PORT}/html/capa-ia.html`);
    console.log(`Gráficos servidos desde: ${ML_OUTPUT_DIR}`);
  });
}).catch((err) => {
  console.error("[BD] Error fatal al inicializar BD:", err);
  app.listen(PORT, () => {
    console.log(`Servidor iniciado (sin BD): http://localhost:${PORT}`);
  });
});