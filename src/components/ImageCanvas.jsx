// src/components/ImageCanvas.jsx
import { logout } from "../authService";
import { useNavigate } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import {
  Button,
  Stack,
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
  Box,
  Typography,
} from "@mui/material";

// 🔥 NEW IMPORTS (Firebase)
import { auth } from "../firebase";
import { db, storage } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc } from "firebase/firestore";

/* ---------------- Geometry / ImageJ helpers ---------------- */

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    s += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(s) / 2;
}

function polygonPerimeter(points) {
  if (!points || points.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    p += distance(points[i], points[j]);
  }
  return p;
}

function convexHull(points) {
  if (!points || points.length < 3) return points.slice();
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (let p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function pcaMajorMinor(points) {
  if (!points || points.length < 3) return { major: 0, minor: 0 };
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (let p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= points.length; sxy /= points.length; syy /= points.length;
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const term = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambda1 = trace / 2 + term;
  const lambda2 = trace / 2 - term;
  const major = 2 * Math.sqrt(Math.max(0, lambda1));
  const minor = 2 * Math.sqrt(Math.max(0, lambda2));
  return { major, minor };
}

function localToCanvasPoint(obj, localX, localY) {
  const p = new fabric.Point(localX, localY);
  return fabric.util.transformPoint(p, obj.calcTransformMatrix());
}

/* Robust contour extraction */
function getContourPoints(obj, ellipseSamples = 180) {
  if (!obj) return [];
  const type = obj.type;

  if (type === "rect") {
    if (obj.aCoords) {
      return ["tl", "tr", "br", "bl"].map((k) => ({ x: obj.aCoords[k].x, y: obj.aCoords[k].y }));
    }
    const b = obj.getBoundingRect();
    return [
      { x: b.left, y: b.top },
      { x: b.left + b.width, y: b.top },
      { x: b.left + b.width, y: b.top + b.height },
      { x: b.left, y: b.top + b.height },
    ];
  }

  if (type === "ellipse") {
    const pts = [];
    const rx = (obj.rx || obj.width / 2) * (obj.scaleX || 1);
    const ry = (obj.ry || obj.height / 2) * (obj.scaleY || 1);
    for (let i = 0; i < ellipseSamples; i++) {
      const t = (i / ellipseSamples) * Math.PI * 2;
      const lx = rx * Math.cos(t), ly = ry * Math.sin(t);
      const can = localToCanvasPoint(obj, lx, ly);
      pts.push({ x: can.x, y: can.y });
    }
    return pts;
  }

  if (type === "path") {
    const pts = [];
    const path = obj.path || [];
    for (let seg of path) {
      if (!Array.isArray(seg)) continue;
      const cmd = seg[0];
      if (cmd === "M" || cmd === "L") {
        const lx = seg[1], ly = seg[2];
        pts.push(localToCanvasPoint(obj, lx, ly));
      } else if (cmd === "Q" || cmd === "C") {
        const lx = seg[seg.length - 2], ly = seg[seg.length - 1];
        pts.push(localToCanvasPoint(obj, lx, ly));
      }
    }
    if (pts.length) return pts;
    const b = obj.getBoundingRect();
    return [
      { x: b.left, y: b.top },
      { x: b.left + b.width, y: b.top },
      { x: b.left + b.width, y: b.top + b.height },
      { x: b.left, y: b.top + b.height }
    ];
  }

  if (type === "polygon" || type === "polyline") {
    const pts = [];
    for (const p of obj.points || []) {
      const can = localToCanvasPoint(
        obj,
        p.x - (obj.pathOffset?.x || 0),
        p.y - (obj.pathOffset?.y || 0)
      );
      pts.push({ x: can.x, y: can.y });
    }
    if (pts.length) return pts;
  }

  const b = obj.getBoundingRect();
  return [
    { x: b.left, y: b.top },
    { x: b.left + b.width, y: b.top },
    { x: b.left + b.width, y: b.top + b.height },
    { x: b.left, y: b.top + b.height },
  ];
}

function measureFromContour(points) {
  if (!points || points.length < 3)
    return { area: 0, perimeter: 0, circularity: 0, aspectRatio: 0, roundness: 0, solidity: 0 };

  const area = polygonArea(points);
  const perimeter = polygonPerimeter(points);
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  const { major, minor } = pcaMajorMinor(points);
  const aspectRatio = minor > 0 ? major / minor : 0;
  const roundness = major > 0 ? (4 * area) / (Math.PI * major * major) : 0;
  const hull = convexHull(points);
  const convexArea = polygonArea(hull);
  const solidity = convexArea > 0 ? area / convexArea : 0;

  return { area, perimeter, circularity, aspectRatio, roundness, solidity };
}

/* ---------------- Component start ---------------- */
export default function ImageCanvas() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [roiManager, setRoiManager] = useState([]);
  const [measureResults, setMeasureResults] = useState([]);

  // 🔥 USER STATE
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const idCounter = useRef(0);
  const managerIdCounter = useRef(0);
  const undoStack = useRef([]);
  const bgDataURL = useRef(null);
  const freeDrawActive = useRef(false);

  useEffect(() => {
    const c = new fabric.Canvas(canvasRef.current, {
      preserveObjectStacking: true,
      selection: true,
    });

    fabricRef.current = c;
    // stable multi-select configuration
    c.selection = true;
    c.selectionKey = "ctrlKey";
    c.selectionFullyContained = false;
    c.preserveObjectStacking = true;
    c.subTargetCheck = true;
    c.targetFindTolerance = 5;
    c.skipTargetFind = false;

    // wheel zoom
    const wheelHandler = (opt) => {
      const e = opt.e;
      let delta = e.deltaY;
      let zoom = c.getZoom() || 1;
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.1, Math.min(20, zoom));
      const pointer = c.getPointer(e);
      c.zoomToPoint(pointer, zoom);
      e.preventDefault();
      e.stopPropagation();
    };
    c.on("mouse:wheel", wheelHandler);

    // always-on pan
    let isPanning = false;
    let lastPos = { x: 0, y: 0 };

    c.on("mouse:down", (opt) => {
      const e = opt.e;
      const target = opt.target;

      if (target && (e.ctrlKey || e.metaKey)) return;
      if (target) return;

      if (freeDrawActive.current) return;
      isPanning = true;
      lastPos.x = e.clientX;
      lastPos.y = e.clientY;
      c.discardActiveObject();
      c.requestRenderAll();
    });

    c.on("mouse:move", (opt) => {
      if (!isPanning) return;
      const e = opt.e;
      const vpt = c.viewportTransform;
      vpt[4] += e.clientX - lastPos.x;
      vpt[5] += e.clientY - lastPos.y;
      lastPos.x = e.clientX;
      lastPos.y = e.clientY;
      c.requestRenderAll();
    });

    c.on("mouse:up", () => {
      isPanning = false;
    });

    c.on("selection:created", () => {});
    c.on("selection:updated", () => {});
    c.on("selection:cleared", () => {});

    // object:added for undo
    c.on("object:added", (e) => {
      const obj = e.target;
      if (!obj) return;
      if (obj._isBackgroundImage) return;
      if (!obj.__canvasId) {
        obj.__canvasId = ++idCounter.current;
        undoStack.current.push(obj);
      }
      obj.hasControls = true;
      obj.hasBorders = true;
    });

    // T key → add to ROI Manager
    const keydown = (ev) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (ev.key.toLowerCase() === "t") {
        ev.preventDefault();
        addSelectedToManager();
      }
    };
    document.addEventListener("keydown", keydown);

    return () => {
      document.removeEventListener("keydown", keydown);
      c.off("mouse:wheel", wheelHandler);
      c.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* ---------------- Load Session if redirected from MyWorkPage ---------------- */
  useEffect(() => {
    const saved = localStorage.getItem("loadedSession");
    if (!saved) return;

    const session = JSON.parse(saved);
    localStorage.removeItem("loadedSession");

    restoreSession(session);
  }, []);


  /* ---------------- Upload background ---------------- */
  const handleUpload = (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    bgDataURL.current = url;

    const c = fabricRef.current;
    if (!c) return;

    fabric.Image.fromURL(
      url,
      (img) => {
        img._isBackgroundImage = true;
        img.selectable = false;
        img.evented = false;
        img.set({ originX: "left", originY: "top" });

        const viewportWidth = Math.max(300, window.innerWidth - 420);
        const scale = Math.min(1, viewportWidth / img.width);
        const scaledW = Math.round(img.width * scale);
        const scaledH = Math.round(img.height * scale);

        c.clear();
        c.setWidth(scaledW);
        c.setHeight(scaledH);

        c.setBackgroundImage(
          img,
          c.renderAll.bind(c),
          {
            originX: "left",
            originY: "top",
            scaleX: scale,
            scaleY: scale,
          }
        );

        c.__bgMeta = {
          originalWidth: img.width,
          originalHeight: img.height,
          scaledWidth: scaledW,
          scaledHeight: scaledH,
          scale,
        };

        setImageLoaded(true);
        setRoiManager([]);
        setMeasureResults([]);
        undoStack.current = [];
        idCounter.current = 0;
      },
      { crossOrigin: "anonymous" }
    );
  };

  /* ---------------- Convert to 8-bit ---------------- */
  const convertTo8bit = async () => {
    const c = fabricRef.current;
    if (!c || !c.backgroundImage) return alert("Upload an image first");

    const src = bgDataURL.current;
    if (!src) return alert("Background image not found");

    const img = new Image();
    img.src = src;
    img.crossOrigin = "anonymous";

    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });

    const w = c.getWidth();
    const h = c.getHeight();
    if (w <= 0 || h <= 0) return alert("Canvas not ready");

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");

    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      d[i] = d[i + 1] = d[i + 2] = gray;
    }

    ctx.putImageData(data, 0, 0);
    const grayURL = off.toDataURL("image/png");
    bgDataURL.current = grayURL;

    fabric.Image.fromURL(
      grayURL,
      (imgObj) => {
        imgObj._isBackgroundImage = true;
        imgObj.selectable = false;
        imgObj.evented = false;
        imgObj.set({ originX: "left", originY: "top" });

        c.setBackgroundImage(
          imgObj,
          c.renderAll.bind(c),
          { originX: "left", originY: "top", scaleX: 1, scaleY: 1 }
        );
      },
      { crossOrigin: "anonymous" }
    );
  };

  /* ---------------- Drawing Tools ---------------- */
  const addRectangle = () => {
    if (!imageLoaded) return alert("Upload an image first");
    const c = fabricRef.current;

    c.isDrawingMode = false;
    const rect = new fabric.Rect({
      left: 30,
      top: 30,
      width: 120,
      height: 80,
      fill: "rgba(255,255,0,0)",
      stroke: "yellow",
      strokeWidth: 2,
      selectable: true,
      evented: true,
    });

    c.add(rect);
    c.setActiveObject(rect);
    c.requestRenderAll();
  };

  const addEllipse = () => {
    if (!imageLoaded) return alert("Upload an image first");
    const c = fabricRef.current;

    c.isDrawingMode = false;
    const el = new fabric.Ellipse({
      left: 60,
      top: 60,
      rx: 60,
      ry: 40,
      fill: "rgba(0,255,255,0)",
      stroke: "cyan",
      strokeWidth: 2,
      selectable: true,
      originX: "center",
      originY: "center",
    });

    c.add(el);
    c.setActiveObject(el);
    c.requestRenderAll();
  };

  const enableFreeDraw = () => {
    if (!imageLoaded) return alert("Upload an image first");
    const c = fabricRef.current;

    freeDrawActive.current = true;
    if (!c.freeDrawingBrush)
      c.freeDrawingBrush = new fabric.PencilBrush(c);

    c.freeDrawingBrush.width = 2;
    c.freeDrawingBrush.color = "red";
    c.isDrawingMode = true;
  };

  const stopDraw = () => {
    const c = fabricRef.current;
    c.isDrawingMode = false;
    freeDrawActive.current = false;
  };

  /* ---------------- Delete / Undo ---------------- */
  const deleteSelected = () => {
    const c = fabricRef.current;
    const active = c.getActiveObjects();

    if (!active || active.length === 0) return;

    active.forEach((obj) => {
      if (!obj) return;
      c.remove(obj);

      setRoiManager((prev) =>
        prev.filter((r) => r.canvasRefId !== obj.__canvasId)
      );

      setMeasureResults((prev) =>
        prev.filter((m) => m.id !== obj.__canvasId)
      );
    });

    c.discardActiveObject();
    c.requestRenderAll();
  };

  const undoLast = () => {
    const c = fabricRef.current;
    const last = undoStack.current.pop();

    if (!last) return;
    if (last.canvas) {
      c.remove(last);

      setRoiManager((prev) =>
        prev.filter((r) => r.canvasRefId !== last.__canvasId)
      );

      setMeasureResults((prev) =>
        prev.filter((m) => m.id !== last.__canvasId)
      );
    }
  };

  /* ---------------- View Controls ---------------- */
  const resetView = () => {
    const c = fabricRef.current;
    if (!c) return;
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);
    c.requestRenderAll();
  };

  const fitToScreen = () => {
    const c = fabricRef.current;
    if (!c || !c.__bgMeta) return;

    const containerW = c.getWidth();
    const containerH = c.getHeight();
    const bgW = c.__bgMeta.scaledWidth;
    const bgH = c.__bgMeta.scaledHeight;

    const zoom = Math.min(containerW / bgW, containerH / bgH) || 1;
    const offsetX = (containerW - bgW * zoom) / 2;
    const offsetY = (containerH - bgH * zoom) / 2;

    c.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY]);
    c.requestRenderAll();
  };
  /* ---------------- ROI Manager Add / Restore ---------------- */
  const addSelectedToManager = () => {
    const c = fabricRef.current;
    if (!c) return;

    c.isDrawingMode = false;
    freeDrawActive.current = false;

    const active = c.getActiveObjects();
    if (!active || active.length === 0) return;

    const newEntries = [];

    for (const obj of active) {
      if (!obj) continue;

      const serialized = obj.toObject(["rx", "ry"]);
      const managerId = ++managerIdCounter.current;

      newEntries.push({
        id: managerId,
        serialized,
        createdAt: Date.now(),
        type: obj.type || "roi",
        canvasRefId: obj.__canvasId || null,
      });
    }

    setRoiManager((prev) => [...prev, ...newEntries]);
  };

  const restoreManagerEntryToCanvas = (entry) => {
    const c = fabricRef.current;
    if (!c) return;

    fabric.util.enlivenObjects([entry.serialized], (enlivened) => {
      if (!enlivened || enlivened.length === 0) return;

      const obj = enlivened[0];
      obj.__canvasId = ++idCounter.current;

      obj.set({
        selectable: true,
        evented: true,
      });

      c.add(obj);
      c.setActiveObject(obj);
      c.requestRenderAll();

      undoStack.current.push(obj);
    });
  };

  /* ---------------- Measurements ---------------- */
  const measureSelected = () => {
    const c = fabricRef.current;
    if (!c) return;

    c.isDrawingMode = false;
    freeDrawActive.current = false;

    const active = c.getActiveObjects();
    if (!active || active.length === 0) {
      alert("No ROI selected. Select one or more ROIs, then click Measure.");
      return;
    }

    const results = [];

    for (const obj of active) {
      if (!obj) continue;

      const pts = getContourPoints(obj);
      const m = measureFromContour(pts);

      results.push({
        id: obj.__canvasId || null,
        metrics: m,
      });
    }

    setMeasureResults(results);

    try {
      localStorage.setItem("measurements", JSON.stringify(results));
    } catch (err) {
      console.error("Failed to save measurements:", err);
    }
  };

  /* ---------------- Export CSV ---------------- */
  const exportCSV = () => {
    if (!measureResults || measureResults.length === 0) {
      alert("No measurements to export.");
      return;
    }

    const header = [
      "ROI",
      "Area",
      "Perimeter",
      "Circularity",
      "AspectRatio",
      "Roundness",
      "Solidity",
    ];
    const lines = [header.join(",")];

    for (let i = 0; i < measureResults.length; i++) {
      const r = measureResults[i];
      const m = r.metrics;

      const row = [
        `ROI ${i + 1}`,
        m.area.toFixed(4),
        m.perimeter.toFixed(4),
        m.circularity.toFixed(6),
        m.aspectRatio.toFixed(6),
        m.roundness.toFixed(6),
        m.solidity.toFixed(6),
      ];

      lines.push(row.join(","));
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "measurements.csv";
    link.click();
  };

// Restore all ROI objects from saved session onto canvas
const restoreROIsToCanvas = (roiList) => {
  const c = fabricRef.current;
  if (!c || !roiList) return;

  fabric.util.enlivenObjects(
    roiList.map(r => r.serialized),
    (objects) => {
      objects.forEach((obj, index) => {
        obj.__canvasId = ++idCounter.current;

        obj.set({
          selectable: true,
          evented: true
        });

        c.add(obj);
      });

      c.requestRenderAll();
    }
  );
};

  /* ---------------- Restore a saved session ---------------- */
const restoreSession = async (session) => {
  const c = fabricRef.current;
  if (!c) return;

  /* ---- 1) Restore background image ---- */
  const imgURL = session.imageURL;
  bgDataURL.current = imgURL;

  fabric.Image.fromURL(
    imgURL,
    (img) => {
      img._isBackgroundImage = true;
      img.selectable = false;
      img.evented = false;
      img.set({ originX: "left", originY: "top" });

      const viewportWidth = Math.max(300, window.innerWidth - 420);
      const scale = Math.min(1, viewportWidth / img.width);

      const scaledW = Math.round(img.width * scale);
      const scaledH = Math.round(img.height * scale);

      c.clear();
      c.setWidth(scaledW);
      c.setHeight(scaledH);

      c.setBackgroundImage(
        img,
        c.renderAll.bind(c),
        { originX: "left", originY: "top", scaleX: scale, scaleY: scale }
      );

      c.__bgMeta = {
        originalWidth: img.width,
        originalHeight: img.height,
        scaledWidth: scaledW,
        scaledHeight: scaledH,
        scale,
      };

      setImageLoaded(true);
    },
    { crossOrigin: "anonymous" }
  );

  /* ---- 2) Restore ROI Manager ---- */
  // Restore ROI Manager list
if (session.roiManager) {
  setRoiManager(session.roiManager);

  // Restore ROIs onto canvas
  restoreROIsToCanvas(session.roiManager);
}


  /* ---- 3) Restore Measurements ---- */
  if (session.measureResults) {
    setMeasureResults(session.measureResults);
    localStorage.setItem("measurements", JSON.stringify(session.measureResults));
  }
};




  /* ----------------🔥 SAVE SESSION ---------------- */
  const saveSession = async () => {
    if (!user) {
      alert("Please log in to save your session.");
      return;
    }
    if (!bgDataURL.current) {
      alert("Please upload an image first.");
      return;
    }

    try {
      const response = await fetch(bgDataURL.current);
      const blob = await response.blob();

      const imageRef = ref(
        storage,
        `sessions/${user.uid}/${Date.now()}_image.png`
      );

      await uploadBytes(imageRef, blob);
      const imageURL = await getDownloadURL(imageRef);

      await addDoc(collection(db, "sessions"), {
        userId: user.uid,
        createdAt: Date.now(),
        imageURL,
        roiManager,
        measureResults,
      });

      alert("Session saved!");
    } catch (err) {
      console.error(err);
      alert("Failed to save session.");
    }
  };

  /* ---------------- Right Panel ---------------- */
  const RightPanel = () => (
    <Paper
      elevation={2}
      sx={{
        width: 360,
        p: 1,
        ml: 2,
        height: "calc(100vh - 40px)",
        overflowY: "auto",
      }}
    >
      <Typography variant="h6" sx={{ mb: 1, px: 1 }}>
        ROI Manager
      </Typography>

      <List dense>
        {roiManager.length === 0 && (
          <ListItem>
            <ListItemText primary="No ROIs in manager. Select ROI and press 'T' to add." />
          </ListItem>
        )}

        {roiManager.map((e) => (
          <React.Fragment key={e.id}>
            <ListItem
              secondaryAction={
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => restoreManagerEntryToCanvas(e)}>
                    Select
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() =>
                      setRoiManager((prev) =>
                        prev.filter((x) => x.id !== e.id)
                      )
                    }
                  >
                    Delete
                  </Button>
                </Stack>
              }
            >
              <ListItemText primary={`ROI ${e.id}`} secondary={`${e.type}`} />
            </ListItem>
            <Divider />
          </React.Fragment>
        ))}
      </List>

      <Box sx={{ mt: 2, px: 1 }}>
        <Typography variant="h6">Measurements</Typography>

        {!measureResults.length && (
          <Typography color="text.secondary">
            Select one or more ROIs then click <b>Measure</b>.
          </Typography>
        )}

        {measureResults.map((res, idx) => (
          <Box key={idx} sx={{ borderTop: "1px solid #eee", mt: 1, pt: 1 }}>
            <Typography variant="subtitle2">Result {idx + 1}</Typography>
            <Typography variant="body2">
              Area: <b>{res.metrics.area.toFixed(2)}</b>
            </Typography>
            <Typography variant="body2">
              Perimeter: <b>{res.metrics.perimeter.toFixed(2)}</b>
            </Typography>
            <Typography variant="body2">
              Circularity: <b>{res.metrics.circularity.toFixed(4)}</b>
            </Typography>
            <Typography variant="body2">
              Aspect ratio: <b>{res.metrics.aspectRatio.toFixed(4)}</b>
            </Typography>
            <Typography variant="body2">
              Roundness: <b>{res.metrics.roundness.toFixed(4)}</b>
            </Typography>
            <Typography variant="body2">
              Solidity: <b>{res.metrics.solidity.toFixed(4)}</b>
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );

  /* ---------------- RENDER UI ---------------- */
  return (
    <Box sx={{ display: "flex", gap: 2, p: 2 }}>
      <Box sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          {/* Upload */}
          <label htmlFor="upload-file">
            <input
              id="upload-file"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleUpload}
            />
            <Button variant="contained" component="span">
              Upload Image
            </Button>
          </label>

          {/* 🔥 SAVE SESSION BUTTON */}
          <Button
            variant="contained"
            color="success"
            onClick={saveSession}
            sx={{ ml: 1 }}
          >
            Save Session
          </Button>

          {/* CONDITIONAL LOGIN/LOGOUT */}
          {!user && (
            <Button
              variant="outlined"
              onClick={() => navigate("/login")}
              sx={{ ml: 1 }}
            >
              Login
            </Button>
          )}

          {user && (
            <Button
              variant="outlined"
              color="error"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
              sx={{ ml: 1 }}
            >
              Logout
            </Button>
          )}

          {user && (
            <Button variant="contained" color="info" onClick={() => navigate("/mywork")}>
              My Work
            </Button>
          )}


          {/* Tools */}
          <Button variant="contained" onClick={convertTo8bit}>
            Convert to 8-bit
          </Button>

          <Button variant="contained" onClick={addRectangle}>
            Rectangle
          </Button>

          <Button variant="contained" onClick={addEllipse}>
            Circle
          </Button>

          <Button variant="contained" onClick={enableFreeDraw}>
            Free Draw
          </Button>

          <Button variant="outlined" onClick={stopDraw}>
            Stop Draw
          </Button>

          <Button variant="outlined" color="error" onClick={deleteSelected}>
            Delete ROI
          </Button>

          <Button variant="outlined" onClick={undoLast}>
            Undo
          </Button>

          <Button
            variant="contained"
            color="secondary"
            onClick={measureSelected}
          >
            Measure
          </Button>

          <Button variant="outlined" onClick={exportCSV}>
            Export CSV
          </Button>

          <Button variant="outlined" onClick={() => navigate("/stats")}>
            Go to Statistics
          </Button>

          <Button variant="outlined" onClick={resetView}>
            Reset View
          </Button>

          <Button variant="outlined" onClick={fitToScreen}>
            Fit to Screen
          </Button>
        </Stack>

        {/* Canvas */}
        <Paper sx={{ p: 1, width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
          <Box sx={{ display: "inline-block" }}>
            <canvas
              ref={canvasRef}
              style={{
                border: "1px solid #444",
                display: "block",
                maxWidth: "100%",
              }}
            />
          </Box>
        </Paper>

        <Typography
          variant="caption"
          sx={{ mt: 1, color: "#eee" }}
        >
          Pan: drag empty area — Zoom: mouse wheel — Multi-select: Ctrl/Cmd —
          Add to ROI Manager: press <b>T</b>
        </Typography>
      </Box>

      <RightPanel />
    </Box>
  );
}
