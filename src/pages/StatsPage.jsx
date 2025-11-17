// src/pages/StatsPage.jsx
import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { Link } from "react-router-dom";
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  FormGroup,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import Chart from "chart.js/auto";
import * as XLSX from "xlsx";

/* ============================================================
   METRICS WE CARE ABOUT
   ============================================================ */

const METRICS = [
  "Area",
  "Perimeter",
  "Circularity",
  "AR",
  "Roundness",
  "Solidity",
];

// header → canonical metric name (for the 6 we care about)
const NAME_MAP = {
  // Area
  area: "Area",

  // Perimeter
  perimeter: "Perimeter",
  perim: "Perimeter",

  // Circularity
  circularity: "Circularity",
  circ: "Circularity",

  // Aspect ratio / AR
  ar: "AR",
  aspectratio: "AR",
  aspectrat: "AR",
  aspectrati: "AR",

  // Roundness
  roundness: "Roundness",
  round: "Roundness",

  // Solidity
  solidity: "Solidity",
};

/* ------------------------------------------------------------
   CSV parsing + header normalisation
   - We keep ALL columns, but normalize ONLY the 6 metrics
------------------------------------------------------------ */
function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const rawHeaders = lines[0].split(",").map((s) => s.trim());

  const headers = rawHeaders.map((h) => {
    const key = h.toLowerCase().replace(/[^a-z]/g, "");
    const mapped = NAME_MAP[key];
    return mapped || h; // use canonical name if recognized; otherwise keep original
  });

  const rows = lines
    .slice(1)
    .map((line) => line.split(",").map((v) => v.trim()));

  return { headers, rows };
}

/* ------------------------------------------------------------
   Detect numeric columns that are ALSO one of the 6 metrics
------------------------------------------------------------ */
function detectNumericColumns(headers, rows) {
  if (!rows.length) return headers.map(() => false);

  return headers.map((h, colIdx) => {
    if (!METRICS.includes(h)) return false; // ignore ROI, Min, Max, etc.

    for (let r = 0; r < rows.length; r++) {
      const val = rows[r][colIdx];
      if (val === "" || val == null) continue;
      const num = Number(val);
      if (Number.isNaN(num)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------
   Compute mean & SD for numeric columns
------------------------------------------------------------ */
function computeStats(rows, numericCols) {
  const count = rows.length;
  const colCount = numericCols.length;

  const means = new Array(colCount).fill(null);
  const sds = new Array(colCount).fill(null);

  if (count === 0) return { count, means, sds };

  const sums = new Array(colCount).fill(0);
  const sumsSq = new Array(colCount).fill(0);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < colCount; c++) {
      if (!numericCols[c]) continue;
      const x = Number(row[c]);
      if (Number.isNaN(x)) continue;
      sums[c] += x;
      sumsSq[c] += x * x;
    }
  }

  for (let c = 0; c < colCount; c++) {
    if (!numericCols[c]) continue;
    const n = count;
    const mean = sums[c] / n;
    const variance =
      n > 1 ? (sumsSq[c] - (sums[c] * sums[c]) / n) / (n - 1) : 0;
    means[c] = mean;
    sds[c] = Math.sqrt(Math.max(variance, 0));
  }

  return { count, means, sds };
}

/* ------------------------------------------------------------
   Build CSV with Mean & SD rows appended
------------------------------------------------------------ */
function buildCsvWithStats(dataset) {
  const { headers, rows, stats, numericCols } = dataset;
  const { means, sds } = stats;
  const lines = [];

  // header row
  lines.push(headers.join(","));

  // original data
  rows.forEach((r) => lines.push(r.join(",")));

  // Mean row
  const meanRow = headers.map((_, i) =>
    i === 0
      ? "Mean"
      : numericCols[i] && means[i] != null
      ? means[i].toFixed(6)
      : ""
  );

  // SD row
  const sdRow = headers.map((_, i) =>
    i === 0
      ? "SD"
      : numericCols[i] && sds[i] != null
      ? sds[i].toFixed(6)
      : ""
  );

  lines.push(meanRow.join(","));
  lines.push(sdRow.join(","));

  return lines.join("\n");
}

/* ============================================================
   MATH HELPERS FOR TESTS
   ============================================================ */

/* ---- Gamma / Beta / F-distribution (for ANOVA p-value) ---- */

// log-gamma via Lanczos approximation
function logGamma(z) {
  const g = 7;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  z -= 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) {
    x += p[i] / (z + i);
  }

  const t = z + g + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (z + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}

function betacf(a, b, x) {
  const MAX_ITER = 200;
  const EPS = 1e-10;

  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < EPS) d = EPS;
  d = 1 / d;
  let h = d;

  for (let m = 1, m2 = 2; m <= MAX_ITER; m++, m2 += 2) {
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < EPS) d = EPS;
    c = 1 + aa / c;
    if (Math.abs(c) < EPS) c = EPS;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < EPS) d = EPS;
    c = 1 + aa / c;
    if (Math.abs(c) < EPS) c = EPS;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < EPS) break;
  }

  return h;
}

function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const bt =
    Math.exp(
      lnBeta + a * Math.log(x) + b * Math.log(1 - x)
    ) || 0;

  if (x < (a + 1) / (a + b + 2)) {
    return bt * betacf(a, b, x) / a;
  } else {
    return 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
}

// Upper tail of F distribution: P(F' >= F)
function fPValueUpper(F, df1, df2) {
  if (!isFinite(F) || F < 0 || df1 <= 0 || df2 <= 0) return 1;
  const x = (df1 * F) / (df1 * F + df2);
  const cdf = betai(df1 / 2, df2 / 2, x);
  const p = 1 - cdf;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/* ---- Normal CDF (for Mann–Whitney) ---- */

function normalCdf(z) {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) prob = 1 - prob;
  return prob;
}

/* ============================================================
   ANOVA helper
============================================================ */

function anovaForMetric(groups) {
  // groups = [ [x11,x12,...], [x21,...], ... ]
  const k = groups.length;
  const sizes = groups.map((g) => g.length);
  const N = sizes.reduce((s, n) => s + n, 0);
  if (k < 2 || N <= k) {
    return null;
  }

  const allValues = groups.flat();
  const grandMean =
    allValues.reduce((s, v) => s + v, 0) / allValues.length;

  const groupMeans = groups.map(
    (g) =>
      g.reduce((s, v) => s + v, 0) / g.length
  );

  // Between groups
  let ssBetween = 0;
  for (let i = 0; i < k; i++) {
    ssBetween +=
      sizes[i] * Math.pow(groupMeans[i] - grandMean, 2);
  }

  // Within groups
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    const mean = groupMeans[i];
    for (let j = 0; j < groups[i].length; j++) {
      const diff = groups[i][j] - mean;
      ssWithin += diff * diff;
    }
  }

  const dfBetween = k - 1;
  const dfWithin = N - k;

  if (dfWithin <= 0 || ssWithin === 0) {
    return {
      F: Infinity,
      p: 0,
    };
  }

  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const F = msBetween / msWithin;
  const p = fPValueUpper(F, dfBetween, dfWithin);

  return { F, p };
}

/* ============================================================
   Mann–Whitney U helper
============================================================ */

function mannWhitneyForTwoGroups(a, b) {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 1 || n2 < 1) return null;

  // combined values with group labels
  const combined = [];
  for (let i = 0; i < n1; i++) {
    combined.push({ v: a[i], g: 0 });
  }
  for (let j = 0; j < n2; j++) {
    combined.push({ v: b[j], g: 1 });
  }

  combined.sort((x, y) => x.v - y.v);

  let R1 = 0;
  let R2 = 0;
  const N = n1 + n2;
  let tieCorrection = 0;
  let i = 0;
  while (i < N) {
    let j = i + 1;
    while (j < N && combined[j].v === combined[i].v) j++;

    const rankStart = i + 1;
    const rankEnd = j;
    const avgRank = (rankStart + rankEnd) / 2;
    const tieCount = j - i;
    if (tieCount > 1) {
      tieCorrection += tieCount * tieCount * tieCount - tieCount;
    }

    for (let k = i; k < j; k++) {
      if (combined[k].g === 0) R1 += avgRank;
      else R2 += avgRank;
    }

    i = j;
  }

  const U1 = n1 * n2 + (n1 * (n1 + 1)) / 2 - R1;
  const U2 = n1 * n2 + (n2 * (n2 + 1)) / 2 - R2;
  const U = Math.min(U1, U2);

  const meanU = (n1 * n2) / 2;

  let varU = (n1 * n2 * (N + 1)) / 12;
  if (tieCorrection > 0) {
    varU -=
      (n1 * n2 * tieCorrection) /
      (12 * N * (N - 1));
  }

  if (varU <= 0) {
    return { U, p: 1 };
  }

  const z = (U - meanU) / Math.sqrt(varU);
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { U, p: Math.max(0, Math.min(1, p)) };
}

/* ============================================================
   MAIN COMPONENT
============================================================ */

export default function StatsPage() {
  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState(0);

  // Charts
  const [chartType, setChartType] = useState("barMean"); // "barMean" | "pieMean" | "histFull"
  const [selectedParam, setSelectedParam] = useState("");
  const [selectedDatasetIds, setSelectedDatasetIds] = useState([]);

  const chartCanvasRef = useRef(null);
  const chartInstanceRef = useRef(null);

  // Tests
  const [anovaResults, setAnovaResults] = useState([]); // [{metric,F,p}]
  const [mwResults, setMwResults] = useState([]); // [{pair,metric,U,p}]

  /* ---------------- Upload CSV ---------------- */
  const handleUploadCsv = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const { headers, rows } = parseCsv(text);

      if (!headers.length || !rows.length) {
        alert("CSV is empty or invalid.");
        return;
      }

      const numericCols = detectNumericColumns(headers, rows);
      const stats = computeStats(rows, numericCols);

      const newDataset = {
        id: Date.now() + Math.random(),
        name: file.name,
        headers,
        rows,
        numericCols,
        stats,
      };

      setDatasets((prev) => [...prev, newDataset]);
      setSelectedId(newDataset.id);
      setTab(1); // jump to summary
    };

    reader.readAsText(file);
    e.target.value = "";
  };

  const deleteDataset = (id) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    if (selectedId === id) setSelectedId(null);
    setSelectedDatasetIds((prev) => prev.filter((x) => x !== id));
  };

  const current = datasets.find((d) => d.id === selectedId) || null;

  const handleExportWithStats = (dataset) => {
    if (!dataset) return;
    const csv = buildCsvWithStats(dataset);
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = dataset.name.replace(/\.csv$/i, "") + "_with_stats.csv";
    link.click();
  };

  /* ---------------- Numeric metrics present in loaded data ---------------- */
  const numericParams = useMemo(() => {
    const set = new Set();
    datasets.forEach((d) => {
      d.headers.forEach((h, idx) => {
        if (d.numericCols[idx]) set.add(h);
      });
    });
    return Array.from(set);
  }, [datasets]);

  useEffect(() => {
    if (!selectedParam && numericParams.length > 0) {
      setSelectedParam(numericParams[0]);
    }
  }, [numericParams, selectedParam]);

  useEffect(() => {
    setSelectedDatasetIds(datasets.map((d) => d.id));
  }, [datasets]);

  /* ---------------- Chart.js rendering ---------------- */
  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    if (!datasets.length || !selectedParam || selectedDatasetIds.length === 0) {
      return;
    }

    const selectedDatasets = datasets.filter((d) =>
      selectedDatasetIds.includes(d.id)
    );
    if (!selectedDatasets.length) return;

    let config = null;

    // ---- Bar / Pie (Mean across datasets) ----
    if (chartType === "barMean" || chartType === "pieMean") {
      const labels = [];
      const dataValues = [];

      selectedDatasets.forEach((d) => {
        const idx = d.headers.findIndex((h) => h === selectedParam);
        if (idx === -1 || !d.numericCols[idx]) return;
        const mean = d.stats.means[idx];
        if (mean == null || Number.isNaN(mean)) return;
        labels.push(d.name);
        dataValues.push(mean);
      });

      if (!labels.length) return;

      config = {
        type: chartType === "barMean" ? "bar" : "pie",
        data: {
          labels,
          datasets: [
            {
              label: `Mean ${selectedParam}`,
              data: dataValues,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: "top" },
          },
        },
      };
    }

    // ---- Histogram (full data for one dataset) ----
    if (chartType === "histFull") {
      if (selectedDatasets.length !== 1) {
        // message is handled in JSX
      } else {
        const d = selectedDatasets[0];
        const idx = d.headers.findIndex((h) => h === selectedParam);
        if (idx !== -1 && d.numericCols[idx]) {
          const values = d.rows
            .map((row) => Number(row[idx]))
            .filter((v) => !Number.isNaN(v));

          if (values.length > 0) {
            const min = Math.min(...values);
            const max = Math.max(...values);
            if (isFinite(min) && isFinite(max) && min !== max) {
              const binCount = 10;
              const binWidth = (max - min) / binCount;
              const bins = new Array(binCount).fill(0);

              values.forEach((v) => {
                let b = Math.floor((v - min) / binWidth);
                if (b < 0) b = 0;
                if (b >= binCount) b = binCount - 1;
                bins[b]++;
              });

              const labels = [];
              for (let i = 0; i < binCount; i++) {
                const start = min + i * binWidth;
                const end = start + binWidth;
                labels.push(`${start.toFixed(1)}–${end.toFixed(1)}`);
              }

              config = {
                type: "bar",
                data: {
                  labels,
                  datasets: [
                    {
                      label: `Histogram of ${selectedParam} (${d.name})`,
                      data: bins,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  plugins: { legend: { position: "top" } },
                  scales: {
                    x: {
                      ticks: { maxRotation: 45, minRotation: 45 },
                    },
                  },
                },
              };
            }
          }
        }
      }
    }

    if (!config) return;

    const ctx = canvas.getContext("2d");
    chartInstanceRef.current = new Chart(ctx, config);

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartType, selectedParam, selectedDatasetIds, datasets]);

  /* ============================================================
     TESTS: ANOVA + Mann–Whitney
     ============================================================ */

  const handleRunAnova = () => {
    if (datasets.length < 2) {
      alert("Upload at least 2 CSV files for ANOVA.");
      return;
    }

    const results = [];

    METRICS.forEach((metric) => {
      // groups = array of number arrays (one per dataset)
      const groups = [];

      datasets.forEach((d) => {
        const idx = d.headers.findIndex((h) => h === metric);
        if (idx === -1 || !d.numericCols[idx]) return;
        const vals = d.rows
          .map((row) => Number(row[idx]))
          .filter((v) => !Number.isNaN(v));
        if (vals.length > 0) {
          groups.push(vals);
        }
      });

      if (groups.length < 2) return;

      const res = anovaForMetric(groups);
      if (!res) return;
      results.push({
        metric,
        F: res.F,
        p: res.p,
      });
    });

    setAnovaResults(results);
  };

  const handleRunMannWhitney = () => {
    if (datasets.length < 2) {
      alert("Upload at least 2 CSV files for Mann–Whitney.");
      return;
    }

    const results = [];

    for (let i = 0; i < datasets.length; i++) {
      for (let j = i + 1; j < datasets.length; j++) {
        const d1 = datasets[i];
        const d2 = datasets[j];
        const pairLabel = `${d1.name} vs ${d2.name}`;

        METRICS.forEach((metric) => {
          const idx1 = d1.headers.findIndex((h) => h === metric);
          const idx2 = d2.headers.findIndex((h) => h === metric);
          if (
            idx1 === -1 ||
            idx2 === -1 ||
            !d1.numericCols[idx1] ||
            !d2.numericCols[idx2]
          ) {
            return;
          }

          const a = d1.rows
            .map((row) => Number(row[idx1]))
            .filter((v) => !Number.isNaN(v));
          const b = d2.rows
            .map((row) => Number(row[idx2]))
            .filter((v) => !Number.isNaN(v));

          if (a.length === 0 || b.length === 0) return;

          const res = mannWhitneyForTwoGroups(a, b);
          if (!res) return;

          results.push({
            pair: pairLabel,
            metric,
            U: res.U,
            p: res.p,
          });
        });
      }
    }

    setMwResults(results);
  };

  /* ============================================================
     EXPORT HELPERS (CSV + EXCEL)
     ============================================================ */

  // Map dataset name -> "Dataset 1", "Dataset 2", ...
  const buildDatasetLabelMap = () => {
    const map = new Map();
    datasets.forEach((d, idx) => {
      map.set(d.name, `Dataset ${idx + 1}`);
    });
    return map;
  };

  const formatP = (p) => {
    if (p == null || !isFinite(p)) return "-";
    return p.toExponential(3);
  };

  // ---- Export tests as simple CSV (ANOVA + MW) ----
  const handleExportTestsCsv = () => {
    if (anovaResults.length === 0 && mwResults.length === 0) {
      alert("Run ANOVA and/or Mann–Whitney before exporting CSV.");
      return;
    }

    const labelMap = buildDatasetLabelMap();
    const lines = [];

    // ANOVA section
    if (anovaResults.length > 0) {
      lines.push("ANOVA Results");
      lines.push("Metric,F,p");
      anovaResults.forEach((r) => {
        const F = isFinite(r.F) ? r.F.toFixed(4) : "Infinity";
        const p = formatP(r.p);
        lines.push(`${r.metric},${F},${p}`);
      });
      lines.push(""); // blank line
    }

    // Mann–Whitney section
    if (mwResults.length > 0) {
      lines.push("Mann-Whitney Results");
      lines.push("Pair,Metric,U,p");

      mwResults.forEach((r) => {
        // Convert "file1.csv vs file2.csv" -> "Dataset 1 vs Dataset 2"
        let pairText = r.pair;
        const parts = r.pair.split(" vs ");
        if (parts.length === 2) {
          const a = labelMap.get(parts[0]) || parts[0];
          const b = labelMap.get(parts[1]) || parts[1];
          pairText = `${a} vs ${b}`;
        }
        const U = r.U.toFixed(2);
        const p = formatP(r.p);
        lines.push(`${pairText},${r.metric},${U},${p}`);
      });
      lines.push("");
    }

    lines.push(
      "Note: Dataset labels are generic (Dataset 1, Dataset 2, etc.). You can download this file and rename datasets as per your convenience."
    );

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "test_results.csv";
    link.click();
  };

  // ---- Export big formatted table as Excel ----
  const handleExportTestsExcel = () => {
    if (datasets.length < 2) {
      alert("Upload at least 2 CSV files to build the formatted table.");
      return;
    }

    const labelMap = buildDatasetLabelMap();
    const sheetData = [];
    const merges = [];

    let currentRowIndex = 0;

    // Header row
    const header = [
      "Nuclear Parameter",
      ...datasets.map((d, idx) => `Dataset ${idx + 1} (Mean ± SD)`),
      "Mann–Whitney Test",
      "p-value",
    ];
    sheetData.push(header);
    currentRowIndex++;

    // For each metric, add block: mean±SD row + all pairwise MW comparisons
    METRICS.forEach((metric) => {
      const metricStartIndex = currentRowIndex;

      // Mean ± SD for each dataset (if metric present)
      const meanSdPerDataset = datasets.map((d) => {
        const idx = d.headers.findIndex((h) => h === metric);
        if (idx === -1 || !d.numericCols[idx]) return "";
        const mean = d.stats.means[idx];
        const sd = d.stats.sds[idx];
        if (mean == null || sd == null) return "";
        return `${mean.toFixed(4)} ± ${sd.toFixed(4)}`;
      });

      // All pairwise MW comparisons for this metric
      const comparisons = [];
      for (let i = 0; i < datasets.length; i++) {
        for (let j = i + 1; j < datasets.length; j++) {
          const d1 = datasets[i];
          const d2 = datasets[j];

          const idx1 = d1.headers.findIndex((h) => h === metric);
          const idx2 = d2.headers.findIndex((h) => h === metric);
          if (
            idx1 === -1 ||
            idx2 === -1 ||
            !d1.numericCols[idx1] ||
            !d2.numericCols[idx2]
          ) {
            continue;
          }

          const a = d1.rows
            .map((row) => Number(row[idx1]))
            .filter((v) => !Number.isNaN(v));
          const b = d2.rows
            .map((row) => Number(row[idx2]))
            .filter((v) => !Number.isNaN(v));
          if (a.length === 0 || b.length === 0) continue;

          const res = mannWhitneyForTwoGroups(a, b);
          if (!res) continue;

          const labelA = labelMap.get(d1.name) || `Dataset ${i + 1}`;
          const labelB = labelMap.get(d2.name) || `Dataset ${j + 1}`;
          comparisons.push({
            label: `${labelA} vs ${labelB}`,
            p: res.p,
          });
        }
      }

      if (comparisons.length === 0) {
        // Only one row: metric + mean±SD
        const row = [
          metric,
          ...meanSdPerDataset,
          "",
          "",
        ];
        sheetData.push(row);
        currentRowIndex++;
      } else {
        // First row: metric + mean±SD + first comparison
        const first = comparisons[0];
        let row = [
          metric,
          ...meanSdPerDataset,
          first.label,
          formatP(first.p),
        ];
        sheetData.push(row);
        currentRowIndex++;

        // Remaining rows: empty metric + empty dataset cols + comparison rows
        for (let k = 1; k < comparisons.length; k++) {
          const c = comparisons[k];
          row = [
            "",
            ...new Array(datasets.length).fill(""),
            c.label,
            formatP(c.p),
          ];
          sheetData.push(row);
          currentRowIndex++;
        }
      }

      const metricEndIndex = currentRowIndex - 1;
      if (metricEndIndex > metricStartIndex) {
        // Merge the "Nuclear Parameter" column across this metric block
        merges.push({
          s: { r: metricStartIndex, c: 0 },
          e: { r: metricEndIndex, c: 0 },
        });
      }

      // Blank row between metrics (optional)
      sheetData.push(["", "", "", "", "", "", ""]);
      currentRowIndex++;
    });

    // Final note row
    sheetData.push([
      "Note: Dataset labels are generic (Dataset 1, Dataset 2, etc.). You can download this file and rename datasets as per your convenience.",
    ]);
    currentRowIndex++;

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    if (merges.length > 0) {
      ws["!merges"] = merges;
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tests");
    const wbout = XLSX.write(wb, {
      bookType: "xlsx",
      type: "array",
    });

    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "test_results_table.xlsx";
    link.click();
  };

  /* ============================================================
     RENDER
============================================================ */

  return (
    <Box sx={{ p: 2, width: "100%" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h5">
          Statistics &amp; Analysis
        </Typography>
        <Button
          variant="outlined"
          size="small"
          component={Link}
          to="/"
        >
          ⟵ Back to Image Analysis
        </Button>
      </Stack>

      {/* Upload */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <label htmlFor="upload-csv">
          <input
            id="upload-csv"
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleUploadCsv}
          />
          <Button variant="contained" component="span">
            Upload CSV
          </Button>
        </label>

        <Typography variant="body2" color="text.secondary">
          Datasets loaded: <b>{datasets.length}</b>
        </Typography>
      </Stack>

      <Paper elevation={2}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
        >
          <Tab label="Datasets" />
          <Tab label="Summary (Mean & SD)" />
          <Tab label="Charts" />
          <Tab label="Tests" />
        </Tabs>

        <Box sx={{ p: 2 }}>
          {/* ---------- TAB 0: DATASETS ---------- */}
          {tab === 0 && (
            <Box>
              {datasets.length === 0 ? (
                <Typography color="text.secondary">
                  No datasets uploaded yet.
                </Typography>
              ) : (
                <List dense>
                  {datasets.map((d) => (
                    <React.Fragment key={d.id}>
                      <ListItem
                        button
                        selected={d.id === selectedId}
                        onClick={() => setSelectedId(d.id)}
                      >
                        <ListItemText
                          primary={d.name}
                          secondary={`Rows: ${d.rows.length}`}
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            title="Export CSV with Mean & SD"
                            onClick={() => handleExportWithStats(d)}
                          >
                            <Typography variant="caption">
                              DL
                            </Typography>
                          </IconButton>
                          <IconButton
                            color="error"
                            title="Delete dataset"
                            onClick={() => deleteDataset(d.id)}
                          >
                            <Typography variant="caption">X</Typography>
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                      <Divider />
                    </React.Fragment>
                  ))}
                </List>
              )}
            </Box>
          )}

          {/* ---------- TAB 1: SUMMARY ---------- */}
          {tab === 1 && (
            <Box>
              {!current ? (
                <Typography color="text.secondary">
                  Select a dataset from the{" "}
                  <b>Datasets</b> tab.
                </Typography>
              ) : (
                <>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    sx={{ mb: 1 }}
                  >
                    <Typography variant="subtitle1">
                      Dataset: <b>{current.name}</b>
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        handleExportWithStats(current)
                      }
                    >
                      Export CSV with Mean &amp; SD
                    </Button>
                  </Stack>

                  <Typography sx={{ mb: 1 }}>
                    Count: <b>{current.stats.count}</b>
                  </Typography>

                  <Paper variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Metric</TableCell>
                          <TableCell align="right">
                            Mean
                          </TableCell>
                          <TableCell align="right">SD</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {current.headers.map((h, i) => {
                          if (!current.numericCols[i]) return null;
                          const mean = current.stats.means[i];
                          const sd = current.stats.sds[i];
                          return (
                            <TableRow key={i}>
                              <TableCell>{h}</TableCell>
                              <TableCell align="right">
                                {mean == null
                                  ? "-"
                                  : mean.toFixed(6)}
                              </TableCell>
                              <TableCell align="right">
                                {sd == null
                                  ? "-"
                                  : sd.toFixed(6)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Paper>
                </>
              )}
            </Box>
          )}

          {/* ---------- TAB 2: CHARTS ---------- */}
          {tab === 2 && (
            <Box>
              {datasets.length === 0 ? (
                <Typography color="text.secondary">
                  Upload one or more CSVs first.
                </Typography>
              ) : numericParams.length === 0 ? (
                <Typography color="text.secondary">
                  No numeric metrics (Area, Perimeter,
                  Circularity, AR, Roundness, Solidity)
                  detected.
                </Typography>
              ) : (
                <>
                  {/* Parameter selector */}
                  <Box sx={{ mb: 2 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ mb: 0.5 }}
                    >
                      Parameter
                    </Typography>
                    <select
                      value={selectedParam}
                      onChange={(e) =>
                        setSelectedParam(e.target.value)
                      }
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: "1px solid #ccc",
                        minWidth: 160,
                      }}
                    >
                      {numericParams.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </Box>

                  {/* Chart type */}
                  <Box sx={{ mb: 2 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ mb: 0.5 }}
                    >
                      Chart type
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant={
                          chartType === "barMean"
                            ? "contained"
                            : "outlined"
                        }
                        onClick={() => setChartType("barMean")}
                      >
                        Bar (Mean)
                      </Button>
                      <Button
                        size="small"
                        variant={
                          chartType === "pieMean"
                            ? "contained"
                            : "outlined"
                        }
                        onClick={() => setChartType("pieMean")}
                      >
                        Pie (Mean)
                      </Button>
                      <Button
                        size="small"
                        variant={
                          chartType === "histFull"
                            ? "contained"
                            : "outlined"
                        }
                        onClick={() => setChartType("histFull")}
                      >
                        Histogram (Full data)
                      </Button>
                    </Stack>
                  </Box>

                  {/* Dataset selection */}
                  <Box sx={{ mb: 2 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ mb: 0.5 }}
                    >
                      Datasets to include
                    </Typography>
                    <FormGroup>
                      {datasets.map((d) => (
                        <FormControlLabel
                          key={d.id}
                          control={
                            <Checkbox
                              size="small"
                              checked={selectedDatasetIds.includes(
                                d.id
                              )}
                              onChange={(e) => {
                                const checked =
                                  e.target.checked;
                                setSelectedDatasetIds(
                                  (prev) =>
                                    checked
                                      ? [...prev, d.id]
                                      : prev.filter(
                                          (x) => x !== d.id
                                        )
                                );
                              }}
                            />
                          }
                          label={d.name}
                        />
                      ))}
                    </FormGroup>
                    {chartType === "histFull" &&
                      selectedDatasetIds.length !== 1 && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          Histogram uses full ROI data for{" "}
                          <b>one</b> dataset. Select exactly
                          one dataset.
                        </Typography>
                      )}
                  </Box>

                  {/* Chart canvas */}
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    {!selectedParam ||
                    selectedDatasetIds.length === 0 ? (
                      <Typography color="text.secondary">
                        Choose a parameter and at least one
                        dataset.
                      </Typography>
                    ) : (
                      <Box sx={{ height: 360 }}>
                        <canvas
                          ref={chartCanvasRef}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            display: "block",
                            margin: "0 auto",
                          }}
                        />
                      </Box>
                    )}
                  </Paper>
                </>
              )}
            </Box>
          )}

          {/* ---------- TAB 3: TESTS ---------- */}
          {tab === 3 && (
            <Box
              sx={{
                display: "flex",
                flexDirection: {
                  xs: "column",
                  md: "row",
                },
                gap: 2,
              }}
            >
              {/* Left: controls */}
              <Box sx={{ flex: 1, minWidth: 260 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Statistical Tests
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2 }}
                >
                  Uses ROI values from each CSV. For ANOVA:
                  groups = each dataset. For Mann–Whitney:
                  all pairwise dataset comparisons.
                </Typography>

                <Typography sx={{ mb: 1 }}>
                  Datasets available:{" "}
                  <b>{datasets.length}</b>
                </Typography>

                <Stack spacing={1} sx={{ mb: 2 }}>
                  <Button
                    variant="contained"
                    disabled={datasets.length < 2}
                    onClick={handleRunAnova}
                  >
                    Run ANOVA (all metrics)
                  </Button>
                  <Button
                    variant="contained"
                    disabled={datasets.length < 2}
                    onClick={handleRunMannWhitney}
                  >
                    Run Mann–Whitney (all pairs)
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={
                      anovaResults.length === 0 &&
                      mwResults.length === 0
                    }
                    onClick={handleExportTestsCsv}
                  >
                    Download Test Results (CSV)
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={datasets.length < 2}
                    onClick={handleExportTestsExcel}
                  >
                    Download Formatted Table (Excel)
                  </Button>
                </Stack>

                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  After download, you can freely rename the
                  exported file and datasets in Excel or any
                  spreadsheet editor as per your convenience.
                </Typography>
              </Box>

              {/* Right: results */}
              <Box sx={{ flex: 2 }}>
                {/* ANOVA Results */}
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  ANOVA Results
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{ mb: 2, maxHeight: 260, overflow: "auto" }}
                >
                  {anovaResults.length === 0 ? (
                    <Box sx={{ p: 1.5 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                      >
                        No ANOVA results yet. Click{" "}
                        <b>Run ANOVA</b>.
                      </Typography>
                    </Box>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Metric</TableCell>
                          <TableCell align="right">
                            F
                          </TableCell>
                          <TableCell align="right">
                            p
                          </TableCell>
                          <TableCell align="right">
                            p &lt; 0.05
                          </TableCell>
                          <TableCell align="right">
                            p &lt; 0.01
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {anovaResults.map((r, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{r.metric}</TableCell>
                            <TableCell align="right">
                              {isFinite(r.F)
                                ? r.F.toFixed(4)
                                : "∞"}
                            </TableCell>
                            <TableCell align="right">
                              {r.p != null
                                ? r.p.toExponential(3)
                                : "-"}
                            </TableCell>
                            <TableCell align="right">
                              {r.p < 0.05 ? "Yes" : "No"}
                            </TableCell>
                            <TableCell align="right">
                              {r.p < 0.01 ? "Yes" : "No"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Paper>

                {/* Mann–Whitney Results */}
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Mann–Whitney Results
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{ maxHeight: 260, overflow: "auto" }}
                >
                  {mwResults.length === 0 ? (
                    <Box sx={{ p: 1.5 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                      >
                        No Mann–Whitney results yet. Click{" "}
                        <b>Run Mann–Whitney</b>.
                      </Typography>
                    </Box>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Pair</TableCell>
                          <TableCell>Metric</TableCell>
                          <TableCell align="right">
                            U
                          </TableCell>
                          <TableCell align="right">
                            p
                          </TableCell>
                          <TableCell align="right">
                            p &lt; 0.05
                          </TableCell>
                          <TableCell align="right">
                            p &lt; 0.01
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {mwResults.map((r, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{r.pair}</TableCell>
                            <TableCell>{r.metric}</TableCell>
                            <TableCell align="right">
                              {r.U.toFixed(2)}
                            </TableCell>
                            <TableCell align="right">
                              {r.p != null
                                ? r.p.toExponential(3)
                                : "-"}
                            </TableCell>
                            <TableCell align="right">
                              {r.p < 0.05 ? "Yes" : "No"}
                            </TableCell>
                            <TableCell align="right">
                              {r.p < 0.01 ? "Yes" : "No"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Paper>
              </Box>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
