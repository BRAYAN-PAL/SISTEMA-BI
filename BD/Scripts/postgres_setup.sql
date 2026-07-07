-- =====================================================
-- SCRIPT DE CONFIGURACIÓN PARA SUPABASE (PostgreSQL)
-- =====================================================
-- Ejecuta esto en el SQL Editor de Supabase
-- =====================================================

-- =====================================================
-- 1. DIMENSIONES DEL MODELO COPO DE NIEVE
-- =====================================================

CREATE TABLE IF NOT EXISTS dim_tipo_tramite (
    id_tipo_tramite SERIAL PRIMARY KEY,
    tipo_tramite VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS dim_tramite (
    sk_tramite SERIAL PRIMARY KEY,
    id_tramite INT NOT NULL UNIQUE,
    id_tipo_tramite INT REFERENCES dim_tipo_tramite(id_tipo_tramite)
);

CREATE TABLE IF NOT EXISTS dim_geografia (
    id_distrito SERIAL PRIMARY KEY,
    distrito VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS dim_estado (
    id_estado SERIAL PRIMARY KEY,
    estado VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS dim_tiempo (
    fecha DATE PRIMARY KEY,
    anio INT,
    mes INT,
    dia INT,
    dia_semana VARCHAR(20)
);

-- =====================================================
-- 2. TABLA DE HECHOS
-- =====================================================

CREATE TABLE IF NOT EXISTS fact_tramites (
    id_fact SERIAL PRIMARY KEY,
    sk_tramite INT REFERENCES dim_tramite(sk_tramite),
    id_distrito INT REFERENCES dim_geografia(id_distrito),
    fecha DATE REFERENCES dim_tiempo(fecha),
    id_estado INT REFERENCES dim_estado(id_estado),
    personas_cola INT,
    tiempo_espera_min INT,
    ventanillas INT,
    promedio_atencion DECIMAL(5,2),
    personas_por_ventanilla DECIMAL(5,2),
    nivel_congestion VARCHAR(50)
);

-- =====================================================
-- 3. TABLA STAGING
-- =====================================================

CREATE TABLE IF NOT EXISTS staging_tramitacion (
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

-- =====================================================
-- 4. FUNCIÓN ETL (equivalente al SP de SQL Server)
-- =====================================================

CREATE OR REPLACE FUNCTION sp_CargarModeloCopoNieve()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Limpiar tablas (desactivar FK checks temporalmente)
    SET CONSTRAINTS ALL DEFERRED;

    DELETE FROM fact_tramites;
    DELETE FROM dim_tramite;
    DELETE FROM dim_tipo_tramite;
    DELETE FROM dim_geografia;
    DELETE FROM dim_estado;
    DELETE FROM dim_tiempo;

    -- Resetear secuencias
    PERFORM setval('dim_tipo_tramite_id_tipo_tramite_seq', 1, false);
    PERFORM setval('dim_tramite_sk_tramite_seq', 1, false);
    PERFORM setval('dim_geografia_id_distrito_seq', 1, false);
    PERFORM setval('dim_estado_id_estado_seq', 1, false);
    PERFORM setval('fact_tramites_id_fact_seq', 1, false);

    SET CONSTRAINTS ALL IMMEDIATE;

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
    INNER JOIN dim_tipo_tramite dtt ON st.tipo_tramite = dtt.tipo_tramite
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
    INSERT INTO dim_tiempo (fecha, anio, mes, dia, dia_semana)
    SELECT DISTINCT
        fecha,
        EXTRACT(YEAR FROM fecha)::INT,
        EXTRACT(MONTH FROM fecha)::INT,
        EXTRACT(DAY FROM fecha)::INT,
        TO_CHAR(fecha, 'FMDay')
    FROM staging_tramitacion
    WHERE fecha IS NOT NULL;

    -- Cargar tabla de hechos
    INSERT INTO fact_tramites (
        sk_tramite, id_distrito, fecha, id_estado,
        personas_cola, tiempo_espera_min, ventanillas,
        promedio_atencion, personas_por_ventanilla, nivel_congestion
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
    INNER JOIN dim_tramite dt ON st.id_tramite = dt.id_tramite
    INNER JOIN dim_geografia dg ON st.distrito = dg.distrito
    INNER JOIN dim_estado de ON st.estado = de.estado
    INNER JOIN dim_tiempo dtm ON st.fecha = dtm.fecha;

    -- Limpiar staging
    TRUNCATE TABLE staging_tramitacion;
END;
$$;
