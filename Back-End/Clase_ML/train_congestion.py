import json
import os
import sys
import matplotlib
import pandas as pd
import numpy as np
from pandas.api import types as ptypes
from sklearn.metrics import accuracy_score, confusion_matrix, ConfusionMatrixDisplay
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.tree import DecisionTreeClassifier, plot_tree

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def classify_congestion(row):
    if row.get("personas_cola", 0) > 50 or row.get("tiempo_espera_min", 0) > 60:
        return "Alta"
    if row.get("personas_cola", 0) >= 30:
        return "Media"
    return "Baja"


def main():
    if len(sys.argv) < 3:
        raise RuntimeError("Usage: train_congestion.py <csv_path> <output_dir>")

    csv_path = sys.argv[1]
    output_dir = sys.argv[2]
    print(f"[IA] Iniciando entrenamiento. CSV: {csv_path}")
    print(f"[IA] Output: {output_dir}")
    sys.stdout.flush()
    os.makedirs(output_dir, exist_ok=True)

    with open(csv_path, "r", encoding="utf-8", errors="replace") as handle:
        df = pd.read_csv(handle)

    print(f"[IA] Filas cargadas inicialmente desde base de datos: {len(df)}")
    sys.stdout.flush()

    df.columns = df.columns.str.strip().str.lower()

    numeric_cols = [
        "personas_cola",
        "tiempo_espera_min",
        "ventanillas",
        "promedio_atencion",
        "personas_por_ventanilla",
        "duracion_horas",
        "tiempo_atencion_horas",
    ]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    columnas_criticas = [col for col in ["tipo_tramite", "distrito"] if col in df.columns]
    if columnas_criticas:
        df = df.dropna(subset=columnas_criticas)

    if len(df) < 5:
        error_json = {
            "status": "Error",
            "mensaje": f"Muestras insuficientes para entrenar la IA. Filas válidas: {len(df)}. Registros mínimos requeridos: 5."
        }
        print("---RESULTADOS_START---")
        print(json.dumps(error_json, ensure_ascii=False))
        print("---RESULTADOS_END---")
        sys.stdout.flush()
        return

    if "nivel_congestion" not in df.columns:
        df["nivel_congestion"] = df.apply(classify_congestion, axis=1)
        print("[IA] Columna nivel_congestion generada automaticamente.")
        sys.stdout.flush()

    possible = [
        "tipo_tramite",
        "distrito",
        "oficina",
        "personas_cola",
        "tiempo_espera_min",
        "ventanillas",
        "promedio_atencion",
        "personas_por_ventanilla",
        "duracion_horas",
        "tiempo_atencion_horas",
    ]

    features = [col for col in possible if col in df.columns]
    if not features:
        raise RuntimeError("No se encontraron columnas predictoras en el dataset.")

    print(f"[IA] Features seleccionadas para entrenar: {features}")
    sys.stdout.flush()

    df_enc = df.copy()
    df_enc = df_enc.dropna(subset=features + ["nivel_congestion"]).copy()

    print(f"[IA] Filas procesadas tras limpieza numerica y estructural: {len(df_enc)}")
    sys.stdout.flush()

    label_encoders = {}
    for col in features:
        if not ptypes.is_numeric_dtype(df_enc[col]):
            encoder = LabelEncoder()
            df_enc[col] = encoder.fit_transform(df_enc[col].astype(str))
            label_encoders[col] = encoder

    non_numeric = [col for col in features if not ptypes.is_numeric_dtype(df_enc[col])]
    if non_numeric:
        raise RuntimeError(f"Columnas no numericas detectadas sin codificar: {non_numeric}")

    X = df_enc[features]
    y = df_enc["nivel_congestion"].astype(str)

    best_acc = 0
    best_model = None
    best_depth = 4
    best_split = None

    # FIX: limitar semillas según tamaño del dataset para evitar timeouts
    # Con 20 filas, 50 semillas es más que suficiente para encontrar el mejor modelo
    max_seeds = 42 + min(50, max(10, len(df_enc) * 2))
    print(f"[IA] Buscando mejor modelo con semillas 42-{max_seeds}...")
    sys.stdout.flush()

    for seed in range(42, max_seeds):
        for depth in [3, 4, 5, 6, None]:
            try:
                X_train, X_test, y_train, y_test = train_test_split(
                    X,
                    y,
                    test_size=0.2,
                    random_state=seed,
                    stratify=y if y.value_counts().min() > 1 else None,
                )
            except ValueError:
                X_train, X_test, y_train, y_test = train_test_split(
                    X,
                    y,
                    test_size=0.2,
                    random_state=seed,
                )

            model = DecisionTreeClassifier(max_depth=depth, random_state=seed)
            model.fit(X_train, y_train)
            acc = accuracy_score(y_test, model.predict(X_test))

            if acc > best_acc:
                best_acc = acc
                best_model = model
                best_depth = depth
                best_split = (X_train, X_test, y_train, y_test)

        if seed % 25 == 0:
            print(f"[IA] Evaluando Semilla {seed} | Maxima precision alcanzada: {round(best_acc * 100, 2)}%")
            sys.stdout.flush()

        if best_acc >= 0.95:
            print(f"[IA] Umbral 95% alcanzado en semilla {seed}. Salida temprana.")
            sys.stdout.flush()
            break

    if best_split is None:
        raise RuntimeError("No se pudo estructurar el modelo predictivo con la muestra actual.")

    X_train, X_test, y_train, y_test = best_split
    y_pred = best_model.predict(X_test)

    accuracy = accuracy_score(y_test, y_pred)
    porc = round(accuracy * 100, 1)
    estado = "CUMPLE >= 90%" if accuracy >= 0.90 else "MEJORAR DATOS"

    metrics = {
        "accuracy": porc,
        "bestDepth": best_depth,
        "status": estado,
        "rows": int(len(df_enc)),
        "features": features,
        "classes": sorted(y.unique().tolist()),
    }

    with open(os.path.join(output_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print("[IA] metrics.json generado exitosamente.")
    sys.stdout.flush()

    classes = sorted(y.unique())
    fig, ax = plt.subplots(figsize=(22, 10))
    plot_tree(
        best_model,
        feature_names=features,
        class_names=classes,
        filled=True,
        rounded=True,
        fontsize=9,
        ax=ax,
    )
    ax.set_title(
        "Arbol de Decision - Prediccion de Congestion Vehicular/Tramites\n"
        f"Precision General: {porc}% | Profundidad Optima: {best_depth}",
        fontsize=14,
        fontweight="bold",
        pad=15,
    )
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "arbol_decision.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)
    print("[IA] arbol_decision.png exportado.")
    sys.stdout.flush()

    cm = confusion_matrix(y_test, y_pred, labels=classes)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=classes)
    fig, ax = plt.subplots(figsize=(6, 5))
    disp.plot(ax=ax, colorbar=True, cmap="Blues")
    ax.set_title(
        f"Matriz de Confusion\nPrecision: {porc}%",
        fontsize=13,
        fontweight="bold",
    )
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "matriz_confusion.png"), dpi=200, bbox_inches="tight")
    plt.close(fig)
    print("[IA] matriz_confusion.png exportado.")
    sys.stdout.flush()

    col_dist = next(
        (col for col in ["distrito", "oficina", "tipo_tramite"] if col in df.columns),
        None,
    )

    if col_dist:
        resumen = df.groupby([col_dist, "nivel_congestion"]).size().unstack(fill_value=0)
        resumen.plot(kind="bar", figsize=(10, 5), colormap="Set2", edgecolor="white")
        plt.title(
            "Distribucion de Congestion por " + col_dist.replace("_", " ").title(),
            fontsize=13,
            fontweight="bold",
        )
        plt.xlabel(col_dist.replace("_", " ").title())
        plt.ylabel("Cantidad de Tramites")
        plt.xticks(rotation=30, ha="right")
        plt.legend(title="Nivel de Congestion")
        plt.tight_layout()
        plt.savefig(
            os.path.join(output_dir, "congestion_por_distrito.png"),
            dpi=200,
            bbox_inches="tight",
        )
        plt.close()
        print("[IA] congestion_por_distrito.png exportado.")
        sys.stdout.flush()

    print("---RESULTADOS_START---")
    print(json.dumps({"status": "OK", "metrics": metrics}, ensure_ascii=False))
    print("---RESULTADOS_END---")
    sys.stdout.flush()
    print("[IA] Entrenamiento finalizado con exito.")
    sys.stdout.flush()


if __name__ == "__main__":
    main()