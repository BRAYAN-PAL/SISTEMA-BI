from pathlib import Path
import os

import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
import pandas as pd
import psycopg2
import seaborn as sns
import streamlit as st


st.set_page_config(
    page_title="Plataforma Integral de Analítica Universitaria",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)


BASE_DIR = Path(__file__).resolve().parent
CSV_FALLBACK = BASE_DIR / "ML" / "output" / "dataset.csv"
DATABASE_URL = os.getenv("DATABASE_URL")


def _load_database_dataframe() -> pd.DataFrame:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL no configurada")

    query = """
        SELECT
            ft.fecha,
            dg.distrito,
            dtt.tipo_tramite,
            de.estado,
            ft.personas_cola,
            ft.tiempo_espera_min,
            ft.ventanillas,
            ft.promedio_atencion,
            ft.personas_por_ventanilla,
            ft.nivel_congestion
        FROM fact_tramites ft
        INNER JOIN dim_tramite dt ON ft.sk_tramite = dt.sk_tramite
        INNER JOIN dim_tipo_tramite dtt ON dt.id_tipo_tramite = dtt.id_tipo_tramite
        INNER JOIN dim_geografia dg ON ft.id_distrito = dg.id_distrito
        INNER JOIN dim_estado de ON ft.id_estado = de.id_estado
        ORDER BY ft.fecha DESC, dg.distrito;
    """

    conn = psycopg2.connect(DATABASE_URL)
    try:
        df = pd.read_sql(query, conn)
    finally:
        conn.close()

    return df


def _load_csv_dataframe() -> pd.DataFrame:
    if not CSV_FALLBACK.exists():
        raise FileNotFoundError(f"No se encontró el archivo {CSV_FALLBACK}")
    return pd.read_csv(CSV_FALLBACK)


def _normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    frame = df.copy()
    if "fecha" in frame.columns:
        frame["fecha"] = pd.to_datetime(frame["fecha"], errors="coerce")

    numeric_columns = [
        "personas_cola",
        "tiempo_espera_min",
        "ventanillas",
        "promedio_atencion",
        "personas_por_ventanilla",
    ]
    for column in numeric_columns:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")

    for column in ["distrito", "tipo_tramite", "estado", "nivel_congestion"]:
        if column in frame.columns:
            frame[column] = frame[column].astype(str).fillna("Sin dato")

    frame = frame.dropna(subset=["fecha", "distrito", "tipo_tramite"])
    frame["fecha"] = frame["fecha"].dt.date
    return frame


@st.cache_data(ttl=60)
def load_dashboard_data() -> tuple[pd.DataFrame, str]:
    try:
        df = _load_database_dataframe()
        source = "PostgreSQL"
    except Exception:
        df = _load_csv_dataframe()
        source = "CSV local"

    return _normalize_dataframe(df), source


def format_short_number(value: float) -> str:
    if pd.isna(value):
        return "0"
    value = float(value)
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.1f} M".replace(".0", "")
    if abs(value) >= 1_000:
        return f"{value / 1_000:.0f} mil"
    if value.is_integer():
        return f"{int(value)}"
    return f"{value:.1f}".replace(".", ",")


def format_decimal(value: float) -> str:
    if pd.isna(value):
        return "0,0"
    return f"{float(value):.1f}".replace(".", ",")


def render_metric_card(title: str, value: str, subtitle: str = "") -> str:
    subtitle_html = f"<div class='metric-subtitle'>{subtitle}</div>" if subtitle else ""
    return f"""
        <div class="metric-card">
            <div class="metric-title">{title}</div>
            <div class="metric-value">{value}</div>
            {subtitle_html}
        </div>
    """


def reset_filters(default_date_range: tuple, min_date, max_date) -> None:
    st.session_state.date_range = default_date_range
    st.session_state.district_filter = "Todas"
    st.session_state.type_filter = "Todas"
    st.session_state.state_filter = "Todas"
    st.session_state.congestion_filter = "Todas"


def apply_filters(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    date_series = pd.to_datetime(df["fecha"], errors="coerce").dropna().sort_values()
    min_date = date_series.iloc[0].date() if not date_series.empty else pd.Timestamp.today().date()
    max_date = date_series.iloc[-1].date() if not date_series.empty else pd.Timestamp.today().date()

    if "date_range" not in st.session_state:
        st.session_state.date_range = (min_date, max_date)
    if "district_filter" not in st.session_state:
        st.session_state.district_filter = "Todas"
    if "type_filter" not in st.session_state:
        st.session_state.type_filter = "Todas"
    if "state_filter" not in st.session_state:
        st.session_state.state_filter = "Todas"
    if "congestion_filter" not in st.session_state:
        st.session_state.congestion_filter = "Todas"

    with st.sidebar:
        st.markdown("<div class='sidebar-title'>FILTROS</div>", unsafe_allow_html=True)

        date_range = st.date_input(
            "FECHA",
            value=st.session_state.date_range,
            min_value=min_date,
            max_value=max_date,
            key="date_range",
        )

        district_options = ["Todas"] + sorted(df["distrito"].dropna().astype(str).unique().tolist())
        type_options = ["Todas"] + sorted(df["tipo_tramite"].dropna().astype(str).unique().tolist())
        state_options = ["Todas"] + sorted(df["estado"].dropna().astype(str).unique().tolist())
        congestion_options = ["Todas"] + sorted(df["nivel_congestion"].dropna().astype(str).unique().tolist())

        district = st.selectbox("DISTRITO", district_options, key="district_filter")
        tramite_type = st.selectbox("TRÁMITE", type_options, key="type_filter")
        state = st.selectbox("ESTADO", state_options, key="state_filter")
        congestion = st.selectbox("CONGESTIÓN", congestion_options, key="congestion_filter")

        if st.button(
            "LIMPIAR FILTROS",
            use_container_width=True,
            on_click=reset_filters,
            args=((min_date, max_date), min_date, max_date),
        ):
            pass

    filtered = df.copy()
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_date, end_date = date_range
        filtered = filtered[
            (pd.to_datetime(filtered["fecha"], errors="coerce").dt.date >= start_date)
            & (pd.to_datetime(filtered["fecha"], errors="coerce").dt.date <= end_date)
        ]

    if district != "Todas":
        filtered = filtered[filtered["distrito"] == district]
    if tramite_type != "Todas":
        filtered = filtered[filtered["tipo_tramite"] == tramite_type]
    if state != "Todas":
        filtered = filtered[filtered["estado"] == state]
    if congestion != "Todas":
        filtered = filtered[filtered["nivel_congestion"] == congestion]

    return filtered


def build_line_chart(df: pd.DataFrame):
    trend = (
        df.assign(fecha=pd.to_datetime(df["fecha"], errors="coerce"))
        .groupby("fecha")
        .size()
        .sort_index()
    )

    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    sns.set_theme(style="whitegrid")
    ax.bar(trend.index.astype(str), trend.values, color="#0b2f5b")
    ax.set_title("Tendencia Diaria de Trámites", fontsize=13, fontweight="bold")
    ax.set_xlabel("Año")
    ax.set_ylabel("Total Trámites")
    ax.tick_params(axis="x", rotation=0)
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.tight_layout()
    return fig


def build_donut_chart(df: pd.DataFrame):
    counts = df["tipo_tramite"].value_counts()
    colors = ["#1e88ff", "#2146c7", "#f3722c", "#7b1fa2", "#e056b5", "#7e57c2"]

    fig, ax = plt.subplots(figsize=(7.3, 3.8))
    wedges, _, autotexts = ax.pie(
        counts.values,
        colors=colors[: len(counts)],
        startangle=90,
        counterclock=False,
        autopct=lambda pct: f"{pct:.0f}%" if pct >= 4 else "",
        pctdistance=1.18,
        labeldistance=1.3,
        wedgeprops={"width": 0.42, "edgecolor": "white"},
    )
    ax.set_title("Distribución por Tipo", fontsize=13, fontweight="bold")
    ax.legend(
        wedges,
        [f"{label}" for label in counts.index],
        title="tipo_tramite",
        loc="center left",
        bbox_to_anchor=(1.02, 0.5),
        frameon=False,
    )
    ax.set(aspect="equal")
    plt.setp(autotexts, size=9, color="#303030")
    plt.tight_layout()
    return fig


def build_horizontal_bar(df: pd.DataFrame):
    district_counts = df["distrito"].value_counts().head(8).sort_values()
    fig, ax = plt.subplots(figsize=(6.2, 4.4))
    ax.barh(district_counts.index, district_counts.values, color="#1e88ff")
    ax.set_title("Total Tramites por distrito", fontsize=13, fontweight="bold")
    ax.set_xlabel("Total Trámites")
    ax.set_ylabel("distrito")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    plt.tight_layout()
    return fig


def prepare_ranking(df: pd.DataFrame) -> pd.DataFrame:
    ranking = (
        df.groupby("distrito", as_index=False)
        .agg(
            total_personas_cola=("personas_cola", "sum"),
            promedio_espera=("tiempo_espera_min", "mean"),
        )
        .sort_values(["total_personas_cola", "promedio_espera"], ascending=[False, False])
    )

    ranking["nivel_congestion_texto"] = ranking["promedio_espera"].apply(
        lambda value: "ALTO" if value >= 30 else ("MEDIO" if value >= 15 else "BAJO")
    )
    ranking["promedio_espera"] = ranking["promedio_espera"].round(1)
    return ranking.head(8)


st.markdown(
    """
    <style>
        .block-container {
            padding-top: 0.5rem;
            padding-bottom: 1rem;
        }

        [data-testid="stSidebar"] {
            background: #edf1f7;
            border-right: 1px solid #d5dce6;
        }

        .sidebar-title {
            font-size: 2rem;
            font-weight: 300;
            color: #1f2d3d;
            margin: 0.5rem 0 1rem 0;
            letter-spacing: 0.02em;
        }

        .hero-banner {
            background: linear-gradient(90deg, #103c74 0%, #0b2f5b 60%, #103c74 100%);
            color: white;
            padding: 0.9rem 1.4rem 1rem 1.4rem;
            text-align: center;
            border-bottom: 3px solid #082442;
        }

        .hero-kicker {
            font-size: 0.8rem;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            opacity: 0.88;
            margin-bottom: 0.25rem;
        }

        .hero-title {
            font-size: 1.15rem;
            font-weight: 700;
            line-height: 1.25;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .hero-subtitle {
            margin-top: 0.25rem;
            font-size: 0.88rem;
            opacity: 0.9;
        }

        .kpi-row {
            margin-top: 0.35rem;
        }

        .metric-card {
            border: 1px solid #d8d8d8;
            background: white;
            min-height: 86px;
            padding: 0.45rem 0.7rem 0.55rem 0.7rem;
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .metric-title {
            font-size: 0.92rem;
            color: #29456f;
            text-transform: uppercase;
            font-weight: 700;
            line-height: 1.1;
            margin-bottom: 0.1rem;
        }

        .metric-value {
            font-size: 2rem;
            line-height: 1.05;
            font-weight: 500;
            color: #222;
            margin-top: 0.2rem;
        }

        .metric-subtitle {
            font-size: 0.9rem;
            color: #6c6c6c;
            margin-top: 0.15rem;
        }

        .footer-note {
            text-align: center;
            color: #888;
            font-size: 0.8rem;
            margin-top: 1rem;
            padding-top: 0.6rem;
            border-top: 1px solid #d5d5d5;
        }
    </style>
    """,
    unsafe_allow_html=True,
)


st.markdown(
    """
    <div class="hero-banner">
        <div class="hero-kicker">Dashboard Ejecutivo</div>
        <div class="hero-title">Plataforma Integral de Analítica Universitaria con BI, Big Data e IA Ética para la Predicción de Congestión de Trámites Administrativos</div>
        <div class="hero-subtitle">Seguimiento de trámites, personas en cola, tiempos de espera y distribución por distrito</div>
    </div>
    """,
    unsafe_allow_html=True,
)


data, data_source = load_dashboard_data()

if data.empty:
    st.error("No se pudieron cargar datos para el dashboard.")
    st.stop()


filtered_data = apply_filters(data)

if filtered_data.empty:
    st.warning("Los filtros actuales no devuelven registros. Ajusta los criterios o usa Limpiar filtros.")
    st.stop()


total_tramites = int(len(filtered_data))
personas_cola = int(filtered_data["personas_cola"].sum())
tiempo_prom_espera = float(filtered_data["tiempo_espera_min"].mean())
prom_atencion = float(filtered_data["promedio_atencion"].mean())
personas_por_ventanilla = float(filtered_data["personas_por_ventanilla"].mean())
nivel_congestion = float((filtered_data["nivel_congestion"].astype(str).str.lower() == "alta").mean() * 100)


st.markdown(
    f"<div style='margin-top:0.35rem;margin-bottom:0.2rem;color:#6b6b6b;font-size:0.85rem;'>Fuente de datos: <b>{data_source}</b> | Registros filtrados: <b>{total_tramites}</b></div>",
    unsafe_allow_html=True,
)


st.markdown("<div class='kpi-row'>", unsafe_allow_html=True)
kpi_cols = st.columns(6)
kpi_payload = [
    ("TOTAL TRÁMITES", format_short_number(total_tramites), "Total Tramites"),
    ("PERSONAS EN COLA", format_short_number(personas_cola), "Total Personas"),
    ("TIEMPO PROM. ESPERA", format_decimal(tiempo_prom_espera), "Promedio Espera"),
    ("PROM. ATENCIÓN", format_decimal(prom_atencion), "Promedio Atencion"),
    ("PERSONAS / VENTANILLA", format_decimal(personas_por_ventanilla), "Promedio Personas"),
    ("NIVEL CONGESTIÓN", f"{format_decimal(nivel_congestion)}%", "Nivel Congestion"),
]

for column, payload in zip(kpi_cols, kpi_payload):
    with column:
        st.markdown(render_metric_card(*payload), unsafe_allow_html=True)
st.markdown("</div>", unsafe_allow_html=True)


top_cols = st.columns([1.0, 1.05])

with top_cols[0]:
    with st.container(border=True):
        st.pyplot(build_line_chart(filtered_data), use_container_width=True)

with top_cols[1]:
    with st.container(border=True):
        st.pyplot(build_donut_chart(filtered_data), use_container_width=True)


bottom_cols = st.columns([1.15, 0.95])
ranking_df = prepare_ranking(filtered_data)

with bottom_cols[0]:
    with st.container(border=True):
        st.markdown("<div style='text-align:center;font-size:1.1rem;font-weight:700;color:#2f2f2f;margin:0.1rem 0 0.4rem 0;'>Ranking de Distritos más Congestionados</div>", unsafe_allow_html=True)
        st.dataframe(
            ranking_df,
            use_container_width=True,
            hide_index=True,
            column_config={
                "distrito": st.column_config.TextColumn("distrito"),
                "total_personas_cola": st.column_config.NumberColumn("Total Personas Cola", format="%d"),
                "promedio_espera": st.column_config.NumberColumn("Promedio Espera", format="%.1f"),
                "nivel_congestion_texto": st.column_config.TextColumn("Nivel Congestion Texto"),
            },
        )

with bottom_cols[1]:
    with st.container(border=True):
        st.pyplot(build_horizontal_bar(filtered_data), use_container_width=True)


st.markdown(
    "<div class='footer-note'>Sistema Inteligente BI - Universidad César Vallejo</div>",
    unsafe_allow_html=True,
)
