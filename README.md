# Prognosix — Bedienungsanleitung

> DSAI-Projektarbeit · 5CHIT · Multi-Horizont Ensemble-Kursvorhersage

---

## Inhaltsverzeichnis

1. [Überblick](#1-überblick)
2. [Systemvoraussetzungen](#2-systemvoraussetzungen)
3. [Installation](#3-installation)
4. [Modell trainieren](#4-modell-trainieren)
5. [Evaluation & Backtest](#5-evaluation--backtest)
6. [Web-App starten](#6-web-app-starten)
7. [Benutzeroberfläche](#7-benutzeroberfläche)
8. [API-Referenz](#8-api-referenz)
9. [Projektstruktur](#9-projektstruktur)
10. [Technische Details](#10-technische-details)
11. [Häufige Fehler](#11-häufige-fehler)

---

## 1. Überblick

**Prognosix** ist eine Webanwendung zur probabilistischen Kursvorhersage von US-Aktien. Sie basiert auf einem **Ensemble aus zwei Deep-Learning-Architekturen** (LSTM-v2 und PatchTST) und gibt für jeden Ticker **drei Zeithorizonte** (1 Tag, 1 Woche, 1 Monat) mit einem **Konfidenzband (P10/P50/P90)** aus.

### Was die App kann

| Feature | Beschreibung |
|---|---|
| Multi-Horizont-Prognose | 1-Tages-, 1-Wochen- und 1-Monats-Log-Return als P10/P50/P90-Quantile |
| Richtungsvorhersage | Kauf-/Verkaufssignal (Long/Short/Flat) mit Wahrscheinlichkeit |
| Konfidenzband | P10–P90 Preisbereich als Visualisierung |
| Interaktiver Chart | Candlestick-Chart mit Live-Kurs und Preisprognose-Linie |
| Watchlist | Persönliche Watchlist via Supabase (Login erforderlich) |
| Dashboard | Alle Watchlist-Titel auf einen Blick mit 1-Tages-Signal |
| Watchlist-Vorschau | Forecast-Graphen für alle Watchlist-Aktien (1T / 1W / 1M) |
| Market Heatmap | Farbige Kachelansicht des 1-Monats-Forecasts aller Watchlist-Aktien |
| Ticker-Band | Scrollendes Live-Kurs-Band mit 40 bekannten Aktien oben auf jeder Seite |

### Was die App nicht kann

- Keine garantierten Kursvorhersagen — **rein experimentell und zu Bildungszwecken**
- Keine Berücksichtigung von Nachrichten, Quartalszahlen oder makroökonomischen Ereignissen
- Kein Echtzeit-Trading oder Depotanbindung

---

## 2. Systemvoraussetzungen

### Minimum

| Komponente | Anforderung |
|---|---|
| Python | 3.10 oder neuer |
| RAM | 8 GB (16 GB empfohlen für Training) |
| Speicher | 5 GB frei (Daten + Modelle) |
| Internet | Für Marktdaten (Yahoo Finance API) |
| Node.js | 18 oder neuer |

### Für Training mit GPU (empfohlen)

| GPU | Hinweis |
|---|---|
| NVIDIA RTX 5070 (Blackwell, sm_120) | Primäre Zielplattform; bf16 AMP automatisch aktiv |
| NVIDIA RTX 3080 / andere Ampere+ | Funktioniert; fp16 oder bf16 je nach GPU |
| Apple MPS (M1/M2/M3) | Wird erkannt, kein AMP; Training langsamer |
| CPU only | Möglich, aber sehr langsam (Stunden statt Minuten) |

> **PyTorch-Version:** Für RTX 50xx (Blackwell) wird **PyTorch ≥ 2.6** benötigt.  
> `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128`

---

## 3. Installation

### 3.1 Python-Abhängigkeiten installieren

```bash
pip install -r requirements.txt
```

| Paket | Zweck |
|---|---|
| `torch` / `torchvision` / `torchaudio` | Deep Learning |
| `yfinance` | Marktdaten |
| `pandas` / `numpy` | Datenverarbeitung |
| `scikit-learn` | Preprocessing |
| `statsmodels` | ARIMA-Baseline |
| `matplotlib` | Trainingsplots |
| `fastapi` / `uvicorn` | Web-Backend |
| `pyarrow` | Schnelles Datei-Caching |
| `python-dotenv` | Umgebungsvariablen |

### 3.2 Frontend-Abhängigkeiten installieren

```bash
cd web/frontend
npm install
cd ../..
```

> **Hinweis:** Nach `npm install` müssen die Binaries in `node_modules/.bin/` ausführbar sein.  
> Falls Fehler wie `Permission denied` auftreten: `chmod +x web/frontend/node_modules/.bin/vite`

### 3.3 Umgebungsvariablen (für Login & Watchlist)

Datei `web/frontend/.env` anlegen:

```env
VITE_SUPABASE_URL=https://dein-projekt.supabase.co
VITE_SUPABASE_ANON_KEY=dein-anon-key
```

Ohne diese Variablen läuft die App normal — Login und Watchlist sind dann deaktiviert.

---

## 4. Modell trainieren

Das Ensemble besteht aus **6 Modellen**: 2 Architekturen × 3 zufällige Seeds.  
Training findet ausschließlich auf **historischen Daten bis 2023** statt.

### 4.1 Vollständiges Ensemble trainieren (empfohlen)

```bash
bash scripts/train_all.sh
```

Das Skript trainiert nacheinander:

1. `lstm_v2 seed=1` → `models/ensemble/lstm_v2_seed1.pth`
2. `lstm_v2 seed=2` → `models/ensemble/lstm_v2_seed2.pth`
3. `lstm_v2 seed=3` → `models/ensemble/lstm_v2_seed3.pth`
4. `patchtst seed=1` → `models/ensemble/patchtst_seed1.pth`
5. `patchtst seed=2` → `models/ensemble/patchtst_seed2.pth`
6. `patchtst seed=3` → `models/ensemble/patchtst_seed3.pth`

**Geschätzte Trainingszeit (RTX 5070):** 30–60 Minuten gesamt

### 4.2 Einzelnes Modell trainieren

```bash
python -m src.train --model lstm_v2 --seed 1
python -m src.train --model patchtst --seed 2
```

### 4.3 Trainings-Output

```
Device: cuda  (AMP=bf16)
── Training lstm_v2 seed=1 ──
  Epoch   1/200  train=0.04821  val=0.05103
  ...
  Early stop at epoch 147  (best val=0.03891)
  Checkpoint → models/ensemble/lstm_v2_seed1.pth
```

### 4.4 Daten-Split

| Split | Zeitraum | Verwendung |
|---|---|---|
| **Train** | 2010-01-01 – 2023-12-31 | Gradientenabstieg |
| **Validation** | 2024-01-01 – 2024-06-30 | Early-Stopping |
| **Test** | 2024-07-01 – 2025-12-31 | Finale Evaluation |
| **Holdout-Ticker** | KO, MA, WMT | Nie im Training gesehen |

---

## 5. Evaluation & Backtest

### 5.1 Modell evaluieren

```bash
python -m src.evaluate
```

**Output-Dateien:**

| Datei | Inhalt |
|---|---|
| `data/eval_report.json` | Alle Metriken als JSON |
| `data/eval_report.md` | Metriken als Markdown-Tabelle |
| `data/plots/band_h1d.png` | Prognoseband 1 Tag |
| `data/plots/band_h5d.png` | Prognoseband 1 Woche |
| `data/plots/band_h20d.png` | Prognoseband 1 Monat |
| `data/plots/calibration.png` | Quantil-Kalibrierungsplot |

### 5.2 Backtest

```bash
python -m src.backtest
```

Simuliert eine Long/Flat-Strategie auf Basis des 1-Tages-P50-Signals (5 Basispunkte Transaktionskosten).

```bash
python -m src.backtest --threshold 0.002   # Nur Long wenn P50 > 0.2%
python -m src.backtest --cost-bps 10       # Höhere Kosten
```

---

## 6. Web-App starten

### 6.1 Backend starten

```bash
cd web
python app.py
```

Alternativ mit uvicorn direkt:

```bash
uvicorn web.app:app --reload --port 8000
```

Das Backend lädt beim Start automatisch alle Ensemble-Modelle aus `models/ensemble/`.  
Wenn keine Modelle vorhanden sind, antwortet `/predict` mit Fehler 503.

### 6.2 Frontend im Entwicklungsmodus starten

In einem **zweiten Terminal:**

```bash
cd web/frontend
npm run dev
```

Frontend läuft standardmäßig auf `http://localhost:3000` (oder `3001` falls 3000 belegt).  
API-Anfragen werden automatisch an `http://localhost:8000` weitergeleitet (Vite-Proxy).

### 6.3 Frontend für Produktion bauen

```bash
cd web/frontend
npm run build
```

Der Build landet in `web/frontend/dist/`. Das Backend serviert diesen Ordner automatisch unter `/`.

```bash
# Nur Backend starten — kein separates Frontend nötig
uvicorn web.app:app --port 8000
# Browser: http://localhost:8000
```

---

## 7. Benutzeroberfläche

### 7.0 Globale Elemente

#### Ticker-Band (oben auf jeder Seite)
Ein scrollendes Band mit Live-Kursen von 40 bekannten US-Aktien (AAPL, MSFT, NVDA, GOOGL, AMZN, …). Links ist ein grün pulsierender **LIVE**-Indikator. Preise und Änderungen fliegen beim Laden von oben ein.

#### Navigation (TopNav)
- **prognosix** Logo — zurück zur Startseite
- **Dashboard** — Watchlist-Übersicht (nur eingeloggt)
- **Portfolio** — Watchlist-Vorschau mit Forecast-Graphen (nur eingeloggt)
- **Über das Modell** — Startseite mit Modellbeschreibung
- **Theme-Toggle** — Sonne/Mond-Icon, Hell/Dunkel (gespeichert im Browser)
- **Benutzer-Avatar** + **Abmelden**-Button wenn eingeloggt

---

### 7.1 Landing Page (`/`)

Die Startseite zeigt:
- **Animierter Headline** — „bevor sie passieren." tippt sich per Typewriter-Effekt ein
- **Schwebende Partikel** im Hintergrund mit Verbindungslinien (Canvas-Animation)
- **Animierte Licht-Blobs** (Mesh-Gradient) im Hero-Bereich
- **Suchfeld** für Ticker-Symbole (z.B. `AAPL`, `NVDA`, `TSLA`) → weiter zur Detailseite
- **Schnellauswahl** beliebter Ticker
- **Demo-Karten** mit statischen Beispielkursen
- **„Wie es funktioniert"**-Sektion mit den drei Schritten (Daten → LSTM → Prognose)

---

### 7.2 Detailseite (`/stock/:ticker`)

#### Kopfbereich
- **Ticker-Symbol** + Markt-Status-Pill: `● LIVE`, `◐ PRE`, `◑ POST`, `○ CLOSED`
- **Ensemble-Badge** — zeigt wie viele Modelle geladen sind
- **Watchlist-Button** — Stern-Icon (erfordert Login)

#### Live-Kurs-Karte
Aktueller Kurs, Tagesveränderung in % und USD, Vortags-Schlusskurs.

#### Drei Horizont-Karten

| Karte | Zeithorizont |
|---|---|
| **1 Day** | Nächster Handelstag |
| **1 Week** | ~5 Handelstage |
| **1 Month** | ~20 Handelstage |

```
┌─────────────────────────────────┐
│ 1 Day            [▲ LONG 71%]   │
│                                 │
│ +0.83%   → $197.42              │
│                                 │
│ [-0.45%]═══════●══════[+2.1%]   │  P10 – P50 – P90
│                                 │
│ Aufwärts-Wahrscheinlichkeit 71% │
│ [████████████░░░░░░]             │
└─────────────────────────────────┘
```

Signal-Badges für **LONG** und **SHORT** pulsieren mit einem Leuchtrand.  
Klick auf eine Karte → wählt diesen Horizont für den Chart.

#### Tabs

**Tab „Prognose & Chart":**
- Interaktiver Candlestick-Chart (Range-Buttons: 1W / 1M / 3M / 1Y / 5Y)
- Gestrichelte Preisprognose-Linie im Chart

**Tab „Kennzahlen":**
- Tabelle mit P10/P50/P90 für alle drei Horizonte
- Modell-Infos, Live-Kurs, Markt-Status

---

### 7.3 Dashboard (`/dashboard`)

Erfordert Login. Zeigt eine Tabelle aller Watchlist-Aktien:

| Spalte | Inhalt |
|---|---|
| Logo + Ticker | Firmenlogo, Ticker-Symbol |
| Kurs | Aktueller Live-Kurs in USD |
| Tagesänderung | % mit Richtungspfeil |
| 1-Tages-Prognose | P50-Rendite + Zielkurs |
| Signal | LONG / SHORT / FLAT Badge (pulsiert) |

- Klick auf eine Zeile → Detailseite
- **X-Button** → Ticker aus Watchlist entfernen
- Suchfeld oben → Aktie zur Watchlist hinzufügen
- Signal-Änderungen lösen **Browser-Benachrichtigungen** aus (wenn erlaubt)

---

### 7.4 Watchlist-Vorschau (`/portfolio`)

Erfordert Login. Zeigt für jede Watchlist-Aktie eine eigene Karte:

#### Summary-Karten (oben)
Vier Kacheln mit animiertem Hochzählen: **Aktien gesamt**, **Bullisch**, **Bärisch**, **Neutral**.

#### Market Heatmap
Farbige Kacheln für alle Watchlist-Aktien — Farbe und Intensität zeigen den 1-Monats-Forecast:
- **Grün** (intensiver = stärker) für positive Prognose
- **Rot** (intensiver = stärker) für negative Prognose
- LONG/SHORT-Kacheln leuchten mit einem farbigen Glow
- **3D-Tilt-Effekt** beim Hover (Kacheln kippen mit der Maus)
- Klick → Detailseite der Aktie

#### Forecast-Karten
Pro Aktie eine Karte mit:
- **Animiertem Linien-Chart** — zeichnet sich beim Laden von links nach rechts auf
- X-Achse: Heute → 1 Tag → 1 Woche → 1 Monat
- Y-Achse: Preis mit Gradient-Fill unter der Linie
- Grün bei Aufwärtstrend, Rot bei Abwärtstrend
- **3 Zusammenfassungs-Kacheln** darunter: %-Änderung + Richtungswahrscheinlichkeit

**Skeleton-Loading:** Während die Watchlist geladen wird, erscheinen animierte Platzhalter.

---

## 8. API-Referenz

Backend unter `http://localhost:8000`. Interaktive Doku: `http://localhost:8000/docs`

### `POST /predict`

```json
{ "ticker": "AAPL" }
```

**Response:**
```json
{
  "ticker": "AAPL",
  "last_close": 195.80,
  "model_count": 6,
  "signal": "long",
  "horizons": [
    {
      "label": "1 Day", "days": 1,
      "p10_ret": -0.00812, "p50_ret": 0.00391, "p90_ret": 0.01543,
      "p10_price": 194.21, "p50_price": 196.57, "p90_price": 198.82,
      "direction": "up", "direction_prob": 0.713
    },
    { "label": "1 Week", "days": 5, "..." : "..." },
    { "label": "1 Month", "days": 20, "...": "..." }
  ]
}
```

| Code | Bedeutung |
|---|---|
| 400 | Ticker ungültig oder Daten nicht verfügbar |
| 503 | Modelle nicht geladen (Training fehlt) |

### `GET /quote/{ticker}`

```json
{
  "ticker": "AAPL", "price": 195.80,
  "change": 1.23, "change_pct": 0.63,
  "prev_close": 194.57, "market_state": "REGULAR", "name": "Apple Inc."
}
```

### `GET /history/{ticker}?range=3m`

Range-Optionen: `1w`, `1m`, `3m`, `1y`, `5y`

```json
{
  "ticker": "AAPL", "range": "3m",
  "data": [
    { "time": "2024-09-01", "open": 193.2, "high": 196.5, "low": 192.8, "close": 195.8, "volume": 54321000 }
  ]
}
```

### `GET /health`

```json
{ "status": "ok", "models_loaded": 6, "normalizer_loaded": true }
```

---

## 9. Projektstruktur

```
moi_gugge/
│
├── src/                        # Python ML-Pipeline
│   ├── features.py             # Feature-Engineering (25 Features)
│   ├── dataset.py              # Multi-Ticker-Dataset, Splits
│   ├── losses.py               # Pinball-Loss
│   ├── train.py                # Training (--model, --seed)
│   ├── evaluate.py             # Evaluation vs. Baselines
│   ├── backtest.py             # Long/Flat-Strategie, Equity-Kurven
│   ├── baselines.py            # Persistence, EMA, ARIMA
│   ├── data_fetcher.py         # Yahoo Finance Download
│   └── models/
│       ├── lstm_v2.py          # LSTM + LayerNorm + Attention
│       └── patchtst.py         # PatchTST Transformer
│
├── web/
│   ├── app.py                  # FastAPI Backend
│   └── frontend/               # React + Vite SPA
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Landing.jsx         # Startseite (Typewriter, Partikel, Blobs)
│       │   │   ├── StockDetail.jsx     # Detailseite mit 3 Horizont-Karten
│       │   │   ├── Dashboard.jsx       # Watchlist-Tabelle mit Live-Signalen
│       │   │   └── Portfolio.jsx       # Watchlist-Vorschau + Heatmap + Charts
│       │   ├── components/
│       │   │   ├── TopNav.jsx          # Navigation
│       │   │   ├── TickerTape.jsx      # Scrollendes Live-Kurs-Band (40 Aktien)
│       │   │   ├── AuthModal.jsx       # Login/Registrierung
│       │   │   ├── CandlestickChart.jsx
│       │   │   └── ui.jsx              # Design-System (Button, Skeleton, SignalBadge, …)
│       │   ├── contexts/
│       │   │   └── AuthContext.jsx     # Supabase Auth
│       │   ├── lib/
│       │   │   └── supabase.js
│       │   └── App.jsx                 # Router + globale Komponenten
│       └── dist/               # Produktions-Build (nach npm run build)
│
├── models/
│   ├── ensemble/               # Trainierte Checkpoints (*.pth)
│   ├── feature_stats.json      # Normierungs-Statistiken
│   └── legacy/
│
├── data/
│   ├── eval_report.json
│   ├── backtest_report.json
│   └── plots/
│
├── scripts/
│   └── train_all.sh
│
└── requirements.txt
```

---

## 10. Technische Details

### Eingabe-Features (25 pro Zeitschritt)

| Kategorie | Features |
|---|---|
| **Renditen** | 1d / 2d / 3d / 5d / 10d log-Return |
| **Preis-Struktur** | High-Low-Range, Open-Close-Gap |
| **Volumen** | Log-Volumen, Volumen-Ratio (vs. 20d-EMA) |
| **Volatilität** | Realisierte Vola 10d / 20d, ATR(14) |
| **Momentum** | RSI(14), MACD-Histogramm, EMA-Differenz, Bollinger-Position |
| **Markt-Kontext** | SPY 1d/5d-Return, VIX-Level, VIX-Delta, Sektor-ETF-Return |
| **Kalender** | Wochentag (sin/cos), Monat (sin/cos) |

### Modell-Architekturen

**LSTM-v2** (~850.000 Parameter):
- 3 LSTM-Blöcke mit LayerNorm + Residual-Verbindungen
- Additive Attention über alle Zeitschritte
- Ticker-Embedding (16 dim), Hidden-Size 192, Dropout 0.25

**PatchTST** (~480.000 Parameter):
- Channel-independent Patch-Tokenization (Patch-Länge 10, Stride 5)
- Transformer-Encoder (4 Blöcke, 4 Heads, d_model 128)

### Training

| Parameter | Wert |
|---|---|
| Epochen | 200 (max) |
| Early Stopping | Patience 30 |
| Optimizer | AdamW (lr=3e-4, weight_decay=1e-4) |
| LR-Scheduler | CosineAnnealingLR |
| Batch-Größe | 1024 |
| Gradient Clipping | 1.0 |
| AMP | bf16 auf Blackwell/Ampere |

### Vorhersage

Pro Horizont (1d, 5d, 20d) werden 3 Quantile (P10, P50, P90) ausgegeben → 9 Ausgabe-Neuronen.  
Loss: **Pinball-Loss** (Quantil-Regression).  
Signal: **Long** wenn P50(1d) > τ_long, **Short** wenn P50(1d) < τ_short, sonst **Flat**.

---

## 11. Häufige Fehler

### `503 Ensemble not loaded`
Keine Checkpoints in `models/ensemble/`.  
→ `bash scripts/train_all.sh` ausführen.

---

### `FileNotFoundError: models/feature_stats.json`
Training noch nicht ausgeführt oder abgebrochen.  
→ `python -m src.train --model lstm_v2 --seed 1` einmal vollständig durchlaufen lassen.

---

### `Permission denied` beim Frontend-Start
Binaries in `node_modules/.bin/` nicht ausführbar (tritt nach `npm install` auf manchen Systemen auf).

```bash
chmod +x web/frontend/node_modules/.bin/vite
chmod +x web/frontend/node_modules/@esbuild/darwin-arm64/bin/esbuild
```

---

### Port 3000 bereits belegt
Vite startet dann automatisch auf Port 3001. Dies ist normal und kein Fehler.

---

### `Data fetch error` bei `/predict`
Yahoo Finance antwortet nicht (Rate-Limit oder unbekannter Ticker).  
→ Ticker prüfen (gültiges US-Symbol: `AAPL`, `MSFT`, …) und kurz warten.

---

### `torch.compile() skipped` beim Training
PyTorch-Version zu alt (RTX 5070 benötigt ≥ 2.6).

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu128
```

Training läuft auch ohne `torch.compile`, nur ~15–30% langsamer.

---

### Login/Watchlist funktioniert nicht
Supabase-Umgebungsvariablen fehlen.  
→ `web/frontend/.env` anlegen (siehe Abschnitt 3.3) und `npm run dev` neu starten.

---

## Haftungsausschluss

Dieses Projekt ist eine **Schularbeit im Rahmen des DSAI-Unterrichts** der 5CHIT.  
Alle Prognosen dienen ausschließlich Bildungs- und Forschungszwecken.  
**Keine Anlageberatung. Kein Aufruf zum Kauf oder Verkauf von Wertpapieren.**  
Vergangene Modellleistung ist kein Indikator für zukünftige Ergebnisse.
