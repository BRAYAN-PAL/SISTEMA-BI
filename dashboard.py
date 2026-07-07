import streamlit as st
import pandas as pd
import psycopg2
import os
import matplotlib.pyplot as plt
import seaborn as sns

# Configuración de la página del Dashboard
st.set_page_config(
    page_title="Dashboard BI - Control de Congestión",
    page_icon="📊",
    layout="wide"
)

# ==========================================
# CONEXIÓN A NEON
# ==========================================
# Usa la variable de entorno o el valor directo (el mismo que en server.js)
NEON_CONN = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_lZjfe4O6HUPW@ep-restless-brook-ai7pp00g.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require")

@st.cache_data(ttl=60)
def cargar_datos_kpis():
    """Carga los KPIs desde la tabla FactKPIs"""
    conn = psycopg2.connect(NEON_CONN)
    query = "SELECT nombrekpi, valor, meta, fechacalculo FROM factkpis ORDER BY fechacalculo DESC LIMIT 3;"
    df = pd.read_sql(query, conn)
    conn.close()
    return df

@st.cache_data(ttl=60)
def cargar_datos_productividad():
    """Carga la productividad por distrito"""
    conn = psycopg2.connect(NEON_CONN)
    query = """
        SELECT dg.distrito AS distrito, COUNT(*) AS tramitesatendidos,
               AVG(ft.tiempo_espera_min) AS tiempopromedio
        FROM fact_tramites ft
        JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
        GROUP BY dg.distrito
        ORDER BY tramitesatendidos DESC;
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df

@st.cache_data(ttl=60)
def cargar_datos_congestion():
    """Carga la distribución de niveles de congestión"""
    conn = psycopg2.connect(NEON_CONN)
    query = """
        SELECT dg.distrito, ft.nivel_congestion, COUNT(*) AS cantidad
        FROM fact_tramites ft
        JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
        GROUP BY dg.distrito, ft.nivel_congestion
        ORDER BY dg.distrito, ft.nivel_congestion;
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df

# ==========================================
# INTERFAZ DEL DASHBOARD
# ==========================================
st.title("📊 Sistema de BI - Análisis de Congestión de Trámites")
st.markdown("Dashboard interactivo conectado en tiempo real a **Neon PostgreSQL**.")
st.divider()

# --- SECCIÓN 1: KPIs MÉTRICAS ---
st.subheader("📌 Indicadores Clave de Rendimiento (KPIs)")
try:
    df_kpis = cargar_datos_kpis()
    if not df_kpis.empty:
        col1, col2, col3 = st.columns(3)

        for index, row in df_kpis.iterrows():
            nombre = str(row['nombrekpi']).strip()
            valor = float(row['valor'])
            meta = float(row['meta'])

            # Formatear según el tipo de KPI
            if "Tasa" in nombre or "Porcentaje" in nombre:
                display_value = f"{valor:.2f}%"
                delta_value = f"Meta: {meta:.0f}%"
            elif "Tiempo" in nombre or "Promedio" in nombre:
                display_value = f"{valor:.1f} min"
                delta_value = f"Meta: {meta:.0f} min"
            else:
                display_value = f"{valor:.2f}"
                delta_value = f"Meta: {meta:.2f}"

            # Asignar a columnas de forma circular
            cols = [col1, col2, col3]
            cols[index % 3].metric(label=nombre, value=display_value, delta=delta_value)
    else:
        st.info("No se encontraron KPIs calculados. Ejecuta el proceso ETL primero.")
except Exception as e:
    st.error(f"Error al conectar con los KPIs: {e}")

st.divider()

# --- SECCIÓN 2: PRODUCTIVIDAD POR DISTRITO ---
st.subheader("🏢 Productividad y Volumen de Trámites por Distrito")
col_tabla, col_grafico = st.columns([1, 2])

try:
    df_prod = cargar_datos_productividad()
    if not df_prod.empty:
        with col_tabla:
            st.markdown("#### Datos de Producción")
            df_display = df_prod.copy()
            df_display['tiempopromedio'] = df_display['tiempopromedio'].round(1).astype(str) + ' min'
            st.dataframe(df_display, use_container_width=True, hide_index=True)

        with col_grafico:
            st.markdown("#### Trámites Atendidos por Distrito")
            fig, ax = plt.subplots(figsize=(8, 4))
            sns.barplot(
                x="tramitesatendidos",
                y="distrito",
                data=df_prod,
                palette="Blues_r",
                ax=ax
            )
            ax.set_xlabel("Número de Trámites")
            ax.set_ylabel("Distrito")
            for i, v in enumerate(df_prod['tramitesatendidos']):
                ax.text(v + 0.3, i, str(v), va='center', fontsize=9)
            st.pyplot(fig)
    else:
        st.info("No hay datos en fact_tramites para graficar.")
except Exception as e:
    st.error(f"Error al generar gráficos de productividad: {e}")

st.divider()

# --- SECCIÓN 3: DISTRIBUCIÓN DE CONGESTIÓN ---
st.subheader("🔴 Distribución de Niveles de Congestión por Distrito")

try:
    df_cong = cargar_datos_congestion()
    if not df_cong.empty:
        # Crear tabla pivote
        pivot = df_cong.pivot_table(
            index='distrito',
            columns='nivel_congestion',
            values='cantidad',
            fill_value=0
        )

        col_graf2, col_tab2 = st.columns([2, 1])

        with col_graf2:
            st.markdown("#### Comparativa por Nivel de Congestión")
            fig2, ax2 = plt.subplots(figsize=(8, 4))
            pivot.plot(kind='bar', ax=ax2, colormap='RdYlGn_r', edgecolor='white')
            ax2.set_xlabel("Distrito")
            ax2.set_ylabel("Cantidad de Trámites")
            ax2.legend(title="Nivel Congestión")
            plt.xticks(rotation=30, ha='right')
            plt.tight_layout()
            st.pyplot(fig2)

        with col_tab2:
            st.markdown("#### Datos Detallados")
            st.dataframe(pivot, use_container_width=True)
    else:
        st.info("No hay datos de congestión para mostrar.")
except Exception as e:
    st.error(f"Error al generar gráficos de congestión: {e}")

st.divider()

# --- SECCIÓN 4: ESTADÍSTICAS GENERALES ---
st.subheader("📈 Resumen General")
try:
    conn = psycopg2.connect(NEON_CONN)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM fact_tramites;")
    total_tramites = cur.fetchone()[0]

    cur.execute("SELECT COUNT(DISTINCT id_distrito) FROM fact_tramites;")
    total_distritos = cur.fetchone()[0]

    cur.execute("SELECT AVG(tiempo_espera_min) FROM fact_tramites;")
    tiempo_promedio = cur.fetchone()[0] or 0

    cur.close()
    conn.close()

    col_r1, col_r2, col_r3, col_r4 = st.columns(4)
    col_r1.metric("📋 Total Trámites", f"{total_tramites:,}")
    col_r2.metric("🏙️ Distritos", f"{total_distritos}")
    col_r3.metric("⏱️ Tiempo Promedio", f"{tiempo_promedio:.1f} min")
    col_r4.metric("🟢 Congestión Baja", "Consultar KPIs")

except Exception as e:
    st.error(f"Error al cargar resumen: {e}")
