const express = require("express");
const sql = require("mssql");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();

// 1. MIDDLEWARES
app.use(express.json({ limit: "50mb" }));
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);

// 2. CARPETAS ML
const ML_DIR = path.join(__dirname, "Clase_ML");
const ML_OUTPUT_DIR = path.join(ML_DIR, "output");
if (!fs.existsSync(ML_OUTPUT_DIR)) {
  fs.mkdirSync(ML_OUTPUT_DIR, { recursive: true });
}

// 3. STATIC — después de definir las rutas
app.use("/graficos", express.static(ML_OUTPUT_DIR));
app.use(express.static(path.join(__dirname, "../Front-End")));

const dbConfig = {
  user: "sa",
  password: "123456",
  server: "localhost",
  database: "DataWarehouse_Tramites",
  options: { encrypt: false, trustServerCertificate: true },
};

// ==========================================
// ENDPOINT: CARGAR EXCEL
// ==========================================
app.post("/api/cargar-excel", async (req, res) => {
  const { tramites } = req.body;
  if (!tramites || !Array.isArray(tramites)) {
    return res
      .status(400)
      .json({ status: "Error", mensaje: "Estructura de datos inválida." });
  }
  try {
    let pool = await sql.connect(dbConfig);
    await pool.request().query("TRUNCATE TABLE staging_tramitacion");
    const table = new sql.Table("staging_tramitacion");
    table.columns.add("id_tramite", sql.Int, { nullable: true });
    table.columns.add("distrito", sql.VarChar(100), { nullable: true });
    table.columns.add("tipo_tramite", sql.VarChar(100), { nullable: true });
    table.columns.add("fecha", sql.Date, { nullable: true });
    table.columns.add("personas_cola", sql.Int, { nullable: true });
    table.columns.add("tiempo_espera_min", sql.Int, { nullable: true });
    table.columns.add("ventanillas", sql.Int, { nullable: true });
    table.columns.add("estado", sql.VarChar(50), { nullable: true });
    table.columns.add("promedio_atencion", sql.Decimal(5, 2), {
      nullable: true,
    });
    table.columns.add("personas_por_ventanilla", sql.Decimal(5, 2), {
      nullable: true,
    });
    table.columns.add("nivel_congestion", sql.VarChar(50), { nullable: true });

    tramites.forEach((t) => {
      const id_tramite = t.id_tramite ? parseInt(t.id_tramite, 10) : null;
      const distrito = t.distrito ? String(t.distrito).trim() : null;
      const tipo_tramite = t.tipo_tramite
        ? String(t.tipo_tramite).trim()
        : null;
      let fecha = null;
      if (t.fecha) {
        const dateObj = new Date(t.fecha);
        if (!isNaN(dateObj.getTime()))
          fecha = dateObj.toISOString().slice(0, 10);
      }
      const personas_cola =
        t.personas_cola && !isNaN(t.personas_cola)
          ? parseInt(t.personas_cola, 10)
          : 0;
      const tiempo_espera_min =
        t.tiempo_espera_min && !isNaN(t.tiempo_espera_min)
          ? parseInt(t.tiempo_espera_min, 10)
          : 0;
      const ventanillas =
        t.ventanillas && !isNaN(t.ventanillas)
          ? parseInt(t.ventanillas, 10)
          : 0;
      const estado = t.estado ? String(t.estado).trim() : null;
      const promedio_atencion =
        t.promedio_atencion && !isNaN(t.promedio_atencion)
          ? parseFloat(t.promedio_atencion)
          : 0.0;
      const personas_por_ventanilla =
        t.personas_por_ventanilla && !isNaN(t.personas_por_ventanilla)
          ? parseFloat(t.personas_por_ventanilla)
          : 0.0;
      const nivel_congestion = t.nivel_congestion
        ? String(t.nivel_congestion).trim()
        : null;
      table.rows.add(
        id_tramite,
        distrito,
        tipo_tramite,
        fecha,
        personas_cola,
        tiempo_espera_min,
        ventanillas,
        estado,
        promedio_atencion,
        personas_por_ventanilla,
        nivel_congestion,
      );
    });

    const request = pool.request();
    await request.bulk(table);
    await request.execute("sp_CargarModeloCopoNieve");
    res.json({
      status: "OK",
      mensaje: "¡Base de datos reescrita exitosamente!",
    });
  } catch (error) {
    console.error("Error crítico en el backend:", error);
    res
      .status(500)
      .json({ status: "Error", mensaje: `Error: ${error.message}` });
  }
});

// ==========================================
// ENDPOINT: OBTENER ESQUEMA
// ==========================================
app.get("/api/obtener-esquema", async (req, res) => {
  try {
    let pool = await sql.connect(dbConfig);
    const query = `
      SELECT TABLE_NAME, COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME IN ('fact_tramites', 'dim_tramite', 'dim_tipo_tramite', 'dim_geografia', 'dim_estado', 'dim_tiempo')
      ORDER BY TABLE_NAME, ORDINAL_POSITION;
    `;
    const result = await pool.request().query(query);
    const esquema = {};
    result.recordset.forEach((row) => {
      if (!esquema[row.TABLE_NAME]) esquema[row.TABLE_NAME] = [];
      esquema[row.TABLE_NAME].push(row.COLUMN_NAME);
    });
    res.json({ status: "OK", datos: esquema });
  } catch (error) {
    res.status(500).json({ status: "Error", mensaje: error.message });
  }
});

// ==========================================
// ENDPOINT: ENTRENAMIENTO IA
// ==========================================
app.post("/api/ia/entrenar", async (req, res) => {
  let responseSent = false;
  const safeError = (status, mensaje) => {
    if (!responseSent) {
      responseSent = true;
      res.status(status).json({ status: "Error", mensaje });
    }
  };

  try {
    console.log("[IA] Solicitud de entrenamiento recibida.");
    const { dataset } = req.body || {};
    const csvPath = path.join(ML_OUTPUT_DIR, "dataset.csv");

    if (
      dataset &&
      Array.isArray(dataset.headers) &&
      Array.isArray(dataset.rows)
    ) {
      const headers = dataset.headers.map((h) =>
        String(h).trim().toLowerCase(),
      );
      const rows = dataset.rows.map((row) => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] !== undefined ? row[index] : null;
        });
        return obj;
      });
      if (!rows.length)
        return safeError(
          400,
          "El archivo cargado no contiene filas para entrenar.",
        );
      writeCsv(rows, csvPath);
      console.log(`[IA] Filas cargadas desde Proceso: ${rows.length}`);
    } else {
      const pool = await sql.connect(dbConfig);
      const query = `
        SELECT dtm.id_tramite, dtt.tipo_tramite, dg.distrito, de.estado, ft.fecha,
          ft.personas_cola, ft.tiempo_espera_min, ft.ventanillas,
          ft.promedio_atencion, ft.personas_por_ventanilla, ft.nivel_congestion
        FROM fact_tramites ft
        JOIN dim_tramite dtm ON ft.sk_tramite = dtm.sk_tramite
        JOIN dim_tipo_tramite dtt ON dtm.id_tipo_tramite = dtt.id_tipo_tramite
        JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
        JOIN dim_estado de ON ft.id_estado = de.id_estado
      `;
      const result = await pool.request().query(query);
      if (!result.recordset.length)
        return safeError(400, "No hay datos en fact_tramites para entrenar.");
      writeCsv(result.recordset, csvPath);
      console.log(
        `[IA] Filas exportadas desde SQL: ${result.recordset.length}`,
      );
    }

    const scriptPath = path.join(ML_DIR, "train_congestion.py");
    const pythonCmd = process.env.PYTHON_CMD || "python";
    console.log(`[IA] Ejecutando: ${pythonCmd} ${scriptPath}`);

    const proc = spawn(pythonCmd, [scriptPath, csvPath, ML_OUTPUT_DIR], {
      cwd: ML_DIR,
    });

    proc.stdout.on("data", (data) =>
      console.log(`[IA][PY] ${data.toString().trim()}`),
    );

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      console.error(`[IA][PY-ERR] ${data.toString().trim()}`);
    });

    proc.on("close", (code) => {
      if (responseSent) return;
      const metricsPath = path.join(ML_OUTPUT_DIR, "metrics.json");
      if (code !== 0 && !fs.existsSync(metricsPath))
        return safeError(500, stderr || "Fallo al ejecutar el entrenamiento.");
      if (!fs.existsSync(metricsPath))
        return safeError(500, "No se generó metrics.json.");

      let metrics;
      try {
        metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      } catch (e) {
        return safeError(500, "Error al leer metrics.json: " + e.message);
      }

      const treePath = path.join(ML_OUTPUT_DIR, "arbol_decision.png");
      const matrixPath = path.join(ML_OUTPUT_DIR, "matriz_confusion.png");
      const distPath = path.join(ML_OUTPUT_DIR, "congestion_por_distrito.png");

      const images = {
        tree: fs.existsSync(treePath) ? "/graficos/arbol_decision.png" : null,
        confusion: fs.existsSync(matrixPath)
          ? "/graficos/matriz_confusion.png"
          : null,
        distribution: fs.existsSync(distPath)
          ? "/graficos/congestion_por_distrito.png"
          : null,
      };

      console.log("[IA] Archivos generados:", {
        tree: fs.existsSync(treePath),
        confusion: fs.existsSync(matrixPath),
        distribution: fs.existsSync(distPath),
      });
      console.log("[IA] Entrenamiento completado. Respondiendo al frontend.");
      responseSent = true;
      res.json({ status: "OK", metrics, images });
    });

    proc.on("error", (err) =>
      safeError(500, `No se pudo iniciar Python: ${err.message}`),
    );
  } catch (error) {
    console.error("Error al ejecutar la capa IA:", error);
    safeError(500, error.message);
  }
});

// ==========================================
// FUNCIONES AUXILIARES CSV
// ==========================================
const toCsvValue = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const writeCsv = (rows, filePath) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  rows.forEach((row) =>
    lines.push(headers.map((key) => toCsvValue(row[key])).join(",")),
  );
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
};

app.post("/api/semantica/calcular", async (req, res) => {
  console.log("[Semántica] Solicitud de cálculo de KPIs recibida.");

  try {
    const pool = await sql.connect(dbConfig);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FactKPIs')
      BEGIN
        CREATE TABLE FactKPIs(
          KPIKey INT IDENTITY(1,1) PRIMARY KEY,
          NombreKPI VARCHAR(100),
          Valor DECIMAL(10,2),
          Meta DECIMAL(10,2),
          FechaCalculo DATETIME
        );
      END
    `);

    const totalRes = await pool.request().query(
      "SELECT COUNT(*) AS total FROM fact_tramites;",
    );
    const total = totalRes.recordset[0]?.total || 0;
    if (!total) {
      return res.status(400).json({
        status: "ERROR",
        mensaje: "No hay registros en fact_tramites.",
      });
    }

    const atendidasRes = await pool.request().query(`
      SELECT COUNT(*) AS atendidas
      FROM fact_tramites
      WHERE UPPER(nivel_congestion) IN ('BAJA', 'MEDIA');
    `);
    const canceladasRes = await pool.request().query(`
      SELECT COUNT(*) AS canceladas
      FROM fact_tramites
      WHERE UPPER(nivel_congestion) = 'ALTA';
    `);
    const tiempoRes = await pool.request().query(
      "SELECT AVG(CAST(tiempo_espera_min AS DECIMAL(10,2))) AS avgTiempo FROM fact_tramites;",
    );

    const asistenciaVal = total
      ? (atendidasRes.recordset[0]?.atendidas || 0) * 100.0 / total
      : 0;
    const cancelacionVal = total
      ? (canceladasRes.recordset[0]?.canceladas || 0) * 100.0 / total
      : 0;
    const tiempoVal = tiempoRes.recordset[0]?.avgTiempo || 0;

    await pool.request().query(`
      INSERT INTO FactKPIs (NombreKPI, Valor, Meta, FechaCalculo)
      VALUES
        ('Tasa Asistencia', ${asistenciaVal}, 85, GETDATE()),
        ('Tasa Cancelacion', ${cancelacionVal}, 10, GETDATE()),
        ('Tiempo Promedio', ${tiempoVal}, 30, GETDATE());
    `);

    const qProductividad = await pool.request().query(`
      SELECT TOP 5
        dg.distrito AS Distrito,
        COUNT(*) AS TramitesAtendidos,
        CAST(COUNT(*) * 1.0 AS DECIMAL(10,2)) AS KPI_Productividad
      FROM fact_tramites ft
      JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
      GROUP BY dg.distrito
      ORDER BY KPI_Productividad DESC;
    `);

    console.log(
      "[Semántica] KPIs calculados y centralizados en FactKPIs con éxito.",
    );

    res.json({
      status: "OK",
      mensaje: "KPIs orquestados y grabados en el Data Warehouse.",
      data: {
        asistencia: asistenciaVal,
        cancelacion: cancelacionVal,
        tiempoPromedio: tiempoVal,
        productividad: qProductividad.recordset,
      },
    });
  } catch (err) {
    console.error("[Semántica] Error en base de datos:", err.message);
    res.status(500).json({ status: "ERROR", mensaje: err.message });
  }
});

// ==========================================
// ENDPOINT: DESCARGAR DIAGRAMA BI
// ==========================================
app.get("/api/bi/diagrama", (req, res) => {
  const pbixPath = path.join(__dirname, "..", "PROYECT.PBIX");
  if (!fs.existsSync(pbixPath)) {
    return res.status(404).json({ status: "ERROR", mensaje: "PBIX no encontrado." });
  }
  res.download(pbixPath, "PROYECT.PBIX");
});

// ==========================================
// INICIO
// ==========================================
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
  console.log(
    `Frontend disponible en http://localhost:${PORT}/html/capa-ia.html`,
  );
  console.log(`Gráficos servidos desde: ${ML_OUTPUT_DIR}`);
});
