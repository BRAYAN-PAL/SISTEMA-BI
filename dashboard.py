import streamlit as st
import pandas as pd
import psycopg2
import os
import matplotlib.pyplot as plt
import seaborn as sns

# ==========================================
# CONFIGURACIÓN DE LA PÁGINA
# ==========================================
st.set_page_config(
    page_title="Dashboard BI - Control de Congestión",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ==========================================
# CONEXIÓN A NEON POSTGRESQL
# ==========================================
# Usa variable de entorno o la URL directa de Neon
NEON_CONN = os.getenv(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_lZjfe4O6HUPW@ep-restless-brook-ai7pp00g.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
)

@st.cache_data(ttl=60)
def cargar_datos_kpis():
    """Obtiene los últimos KPIs calculados desde el Data Warehouse"""
    conn = psycopg2.connect(NEON_CONN)
    query = """
        SELECT nombrekpi, valor, meta, fechacalculo
        FROM factkpis
        ORDER BY fechacalculo DESC
        LIMIT 3;
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df

@st.cache_data(ttl=60)
def cargar_datos_productividad():
    """Obtiene el consolidado de trámites por distrito"""
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
    """Obtiene la distribución de congestión por distrito"""
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
# ESTRUCTURA DE LA INTERFAZ (UI)
# ==========================================

# Encabezado principal
st.title("📊 Sistema de BI - Análisis de Congestión de Trámites")
st.markdown("Dashboard interactivo conectado en tiempo real al almacén de datos en **Neon PostgreSQL**.")

st.divider()

# --- SECCIÓN 1: TARJETAS DE KPIs ---
st.subheader("📌 Indicadores Clave de Rendimiento (KPIs)")

try:
    df_kpis = cargar_datos_kpis()
    
    if not df_kpis.empty:
        col1, col2, col3 = st.columns(3)
        
        # Mapeo dinámico basándose en los registros devueltos
        for index, row in df_kpis.iterrows():
            nombre = str(row['nombrekpi']).strip()
            valor = float(row['valor'])
            meta = float(row['meta'])
            
            # Formatear la salida visual según la naturaleza del KPI
            if "Tasa" in nombre:
                display_value = f"{valor:.2f}%"
                delta_value = f"Meta: {meta}%"
            else:
                display_value = f"{valor:.1f} min"
                delta_value = f"Meta: {meta} min"
            
            # Repartir en las 3 columnas disponibles
            if index == 0:
                with col1:
                    st.metric(label=nombre, value=display_value, delta=delta_value)
            elif index == 1:
                with col2:
                    st.metric(label=nombre, value=display_value, delta=delta_value)
            elif index == 2:
                with col3:
                    st.metric(label=nombre, value=display_value, delta=delta_value)
    else:
        st.info("⚠️ No se encontraron KPIs calculados en la tabla 'factkpis'. Procesa datos desde el Excel primero.")

except Exception as e:
    st.error(f"❌ Error al conectar o leer las métricas de Neon: {e}")

st.divider()

# --- SECCIÓN 2: GRÁFICOS ANALÍTICOS Y TABLAS ---
st.subheader("🏢 Productividad y Volumen de Trámites por Distrito")

col_tabla, col_grafico = st.columns([1, 2])

try:
    df_prod = cargar_datos_productividad()
    
    if not df_prod.empty:
        # Columna Izquierda: Vista en Tabla de Datos Estructurada
        with col_tabla:
            st.markdown("#### 📋 Consolidado de Datos")
            st.dataframe(
                df_prod, 
                use_container_width=True, 
                hide_index=True,
                column_config={
                    "distrito": "Distrito Geográfico",
                    "tramitesatendidos": "Total Trámites"
                }
            )
            
        # Columna Derecha: Gráfico de barras usando Seaborn / Matplotlib
        with col_grafico:
            st.markdown("#### 📉 Gráfico Estadístico de Demanda")
            
            # Configurar el lienzo estético del gráfico
            fig, ax = plt.subplots(figsize=(8, 4.2))
            sns.set_theme(style="whitegrid")
            
            sns.barplot(
                x="tramitesatendidos", 
                y="distrito", 
                data=df_prod, 
                palette="viridis", 
                ax=ax,
                hue="distrito",
                legend=False
            )
            
            # Configuración de etiquetas y diseño limpio
            ax.set_xlabel("Número Absoluto de Trámites", fontsize=10)
            ax.set_ylabel("Distrito", fontsize=10)
            ax.tick_params(labelsize=9)
            plt.tight_layout()
            
            # Renderizar el gráfico en la interfaz de Streamlit
            st.pyplot(fig)
    else:
        st.info("⚠️ La tabla 'fact_tramites' está vacía. Inyecta datos para activar los análisis gráficos.")

except Exception as e:
    st.error(f"❌ Error al generar los componentes gráficos: {e}")

# --- PIE DE PÁGINA ---
st.markdown("""
    <br><hr style='border-top: 1px solid #ccc;'>
    <p style='text-align: center; color: #888; font-size: 12px;'>
        Sistema Inteligente BI © 2026 - Universidad César Vallejo
    </p>
""", unsafe_allow_html=True)
