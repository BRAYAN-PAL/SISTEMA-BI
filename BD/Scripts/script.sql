-- =====================================================
-- 1. CREACIÓN DE LA BASE DE DATOS
-- Base de datos principal del Data Warehouse.
-- =====================================================

CREATE DATABASE DataWarehouse_Tramites;
GO

USE DataWarehouse_Tramites;
GO


-- =====================================================
-- 2. DIMENSIONES DEL MODELO COPO DE NIEVE
-- Tablas descriptivas para el análisis de trámites.
-- =====================================================

-- Subdimensión que almacena los tipos de trámite.
CREATE TABLE dim_tipo_tramite (
    id_tipo_tramite INT IDENTITY(1,1) PRIMARY KEY,
    tipo_tramite VARCHAR(100) NOT NULL UNIQUE
);

-- Dimensión principal de trámites.
CREATE TABLE dim_tramite (
    sk_tramite INT IDENTITY(1,1) PRIMARY KEY,
    id_tramite INT NOT NULL UNIQUE,
    id_tipo_tramite INT FOREIGN KEY REFERENCES dim_tipo_tramite(id_tipo_tramite)
);

-- Dimensión geográfica.
CREATE TABLE dim_geografia (
    id_distrito INT IDENTITY(1,1) PRIMARY KEY,
    distrito VARCHAR(100) NOT NULL UNIQUE
);

-- Dimensión de estados.
CREATE TABLE dim_estado (
    id_estado INT IDENTITY(1,1) PRIMARY KEY,
    estado VARCHAR(50) NOT NULL UNIQUE
);

-- Dimensión temporal.
CREATE TABLE dim_tiempo (
    fecha DATE PRIMARY KEY,
    anio INT,
    mes INT,
    dia INT,
    dia_semana VARCHAR(20)
);


-- =====================================================
-- 3. TABLA DE HECHOS
-- Almacena las métricas e indicadores principales.
-- =====================================================

CREATE TABLE fact_tramites (
    id_fact INT IDENTITY(1,1) PRIMARY KEY,

    -- Llaves foráneas
    sk_tramite INT FOREIGN KEY REFERENCES dim_tramite(sk_tramite),
    id_distrito INT FOREIGN KEY REFERENCES dim_geografia(id_distrito),
    fecha DATE FOREIGN KEY REFERENCES dim_tiempo(fecha),
    id_estado INT FOREIGN KEY REFERENCES dim_estado(id_estado),

    -- Métricas
    personas_cola INT,
    tiempo_espera_min INT,
    ventanillas INT,
    promedio_atencion DECIMAL(5,2),
    personas_por_ventanilla DECIMAL(5,2),
    nivel_congestion VARCHAR(50)
);
GO


-- =====================================================
-- 4. TABLA STAGING
-- Área temporal para importar datos desde Excel.
-- =====================================================

CREATE TABLE staging_tramitacion (
    id_tramite INT,
    distrito VARCHAR(100),
    tipo_tramite VARCHAR(100),
    fecha DATE,
    personas_cola INT,
    tiempo_espera_min INT,
    ventanillas INT,
    estado VARCHAR(50),
    promedio_atencion DECIMAL(5,2),
    personas_por_ventanilla DECIMAL(5,2),
    nivel_congestion VARCHAR(50)
);
GO


-- =====================================================
-- 5. PROCEDIMIENTO ETL
-- Carga los datos desde staging al modelo analítico.
-- =====================================================

ALTER PROCEDURE sp_CargarModeloCopoNieve
AS
BEGIN
    SET NOCOUNT ON;

    -- Desactivar restricciones temporalmente
    ALTER TABLE fact_tramites NOCHECK CONSTRAINT ALL;
    ALTER TABLE dim_tramite NOCHECK CONSTRAINT ALL;

    -- Limpiar tablas
    DELETE FROM fact_tramites;
    DELETE FROM dim_tramite;
    DELETE FROM dim_tipo_tramite;
    DELETE FROM dim_geografia;
    DELETE FROM dim_estado;
    DELETE FROM dim_tiempo;

    -- Reiniciar contadores IDENTITY
    DBCC CHECKIDENT ('dim_tipo_tramite', RESEED, 0);
    DBCC CHECKIDENT ('dim_tramite', RESEED, 0);
    DBCC CHECKIDENT ('dim_geografia', RESEED, 0);
    DBCC CHECKIDENT ('dim_estado', RESEED, 0);
    DBCC CHECKIDENT ('fact_tramites', RESEED, 0);

    -- Reactivar restricciones
    ALTER TABLE fact_tramites CHECK CONSTRAINT ALL;
    ALTER TABLE dim_tramite CHECK CONSTRAINT ALL;

    -- Cargar tipos de trámite
    INSERT INTO dim_tipo_tramite (tipo_tramite)
    SELECT DISTINCT tipo_tramite
    FROM staging_tramitacion
    WHERE tipo_tramite IS NOT NULL;

    -- Cargar dimensión trámite
    INSERT INTO dim_tramite (id_tramite, id_tipo_tramite)
    SELECT DISTINCT
        st.id_tramite,
        dtt.id_tipo_tramite
    FROM staging_tramitacion st
    INNER JOIN dim_tipo_tramite dtt
        ON st.tipo_tramite = dtt.tipo_tramite
    WHERE st.id_tramite IS NOT NULL;

    -- Cargar dimensión geográfica
    INSERT INTO dim_geografia (distrito)
    SELECT DISTINCT distrito
    FROM staging_tramitacion
    WHERE distrito IS NOT NULL;

    -- Cargar dimensión estado
    INSERT INTO dim_estado (estado)
    SELECT DISTINCT estado
    FROM staging_tramitacion
    WHERE estado IS NOT NULL;

    -- Cargar dimensión tiempo
    INSERT INTO dim_tiempo (
        fecha,
        anio,
        mes,
        dia,
        dia_semana
    )
    SELECT DISTINCT
        fecha,
        DATEPART(YEAR, fecha),
        DATEPART(MONTH, fecha),
        DATEPART(DAY, fecha),
        DATENAME(WEEKDAY, fecha)
    FROM staging_tramitacion
    WHERE fecha IS NOT NULL;

    -- Cargar tabla de hechos
    INSERT INTO fact_tramites (
        sk_tramite,
        id_distrito,
        fecha,
        id_estado,
        personas_cola,
        tiempo_espera_min,
        ventanillas,
        promedio_atencion,
        personas_por_ventanilla,
        nivel_congestion
    )
    SELECT
        dt.sk_tramite,
        dg.id_distrito,
        dtm.fecha,
        de.id_estado,
        st.personas_cola,
        st.tiempo_espera_min,
        st.ventanillas,
        st.promedio_atencion,
        st.personas_por_ventanilla,
        st.nivel_congestion
    FROM staging_tramitacion st
    INNER JOIN dim_tramite dt
        ON st.id_tramite = dt.id_tramite
    INNER JOIN dim_geografia dg
        ON st.distrito = dg.distrito
    INNER JOIN dim_estado de
        ON st.estado = de.estado
    INNER JOIN dim_tiempo dtm
        ON st.fecha = dtm.fecha;

    -- Limpiar staging
    TRUNCATE TABLE staging_tramitacion;
END;
GO


-- =====================================================
-- ESTRUCTURA DEL MODELO
-- =====================================================
--
-- dim_tipo_tramite
--         │
--         ▼
--   dim_tramite
--         │
--         ▼
--   fact_tramites
--      /   |   \
--     /    |    \
--    ▼     ▼     ▼
-- dim_geografia
-- dim_estado
-- dim_tiempo
--
-- Modelo: Copo de Nieve (Snowflake Schema)
-- Herramienta de análisis: Power BI
-- Objetivo: Analizar la congestión de trámites
-- administrativos mediante indicadores y dashboards.
-- =====================================================